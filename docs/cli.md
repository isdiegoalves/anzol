# CLI

Entrega os webhooks que chegam na URL direto no app que você está desenvolvendo, como o
`stripe listen`: sem aba aberta e sem CORS.
Também baixa e sobe as [regras de resposta](api.md#regras-de-resposta) da URL como arquivo JSON.
Com o `send`, faz o papel do provedor: dispara webhooks assinados, com retentativas, para o seu app.
Com o `wait-for`, um teste automatizado espera o webhook chegar, sem `sleep`; com o `test`, o teste de CI inteiro
cabe num comando.

## Instalar

Roda em Java 21 ou mais novo. Para construir, o JDK 25 (o Gradle o usa como toolchain e gera classes do Java 21).

```bash
cd cli && ./gradlew installDist
# o script fica em cli/build/install/anzol/bin/anzol; ponha a pasta bin no PATH ou chame pelo caminho
```

## `anzol listen`

```bash
anzol listen --forward http://localhost:3000             # cria uma URL nova e a mostra
anzol listen --forward http://localhost:3000 --token <uuid>   # usa uma URL que já existe
```

```
Listening on http://localhost:8084/9f3c…e21a (forwarding to http://localhost:3000)
14:02:07 POST /pedidos/42?origem=stripe -> 200 (12 ms)
14:02:09 POST /upload -> 201 (8 ms) [files were not forwarded: not stored by the server]
14:02:15 POST /pedidos/43 -> error: connection refused
Reconnected; forwarding 2 missed request(s)
```

Cada mensagem gravada é reenviada para `<forward>` + o caminho depois do token + a query, uma de
cada vez, na ordem em que o servidor as gravou (`seq`); a linha traz o status que o app local
respondeu e o tempo. Quem
mandou o webhook já recebeu a resposta configurada na URL: a resposta do app local só aparece na linha.

- App local fora do ar ou com erro de rede: linha `error:` e o CLI continua ouvindo (a mensagem
  não é reenviada de novo; use `replay`).
- Queda da conexão com o servidor: reconecta sozinho (espera 1 s, 2 s, 4 s… até 30 s) e reenvia,
  em ordem e sem repetir, as mensagens que chegaram durante a queda. Conexão que para de entregar
  sem fechar é dada como caída depois de 45 s sem nenhuma linha (o servidor manda heartbeat a cada 15 s).
- O evento SSE é só o aviso de que chegou mensagem: o CLI lê as mensagens pela listagem
  `after=<seq da última tratada>`, que as traz inteiras e em ordem (mesmo as acima de 1 MB, cujo
  evento chega truncado, e as de rajadas simultâneas, cujos eventos saem fora de ordem). Mensagem
  apagada antes de ser lida não é reenviada; as demais não se perdem. Precisa de um servidor com
  `seq` e `after` (esta versão).
- Só as mensagens que chegam depois que o `listen` começa são reenviadas.
- Token inexistente (ou apagado durante uma queda): `Token not found` no stderr e saída 1. Ctrl+C sai com 0.

## `anzol replay`

```bash
anzol replay <token> <requestId> --to http://localhost:3000
anzol replay <token> <id1> <id2> <id3> --to http://localhost:3000   # várias, na ordem dada
```

Reenvia mensagens gravadas, igual ao `listen`, e imprime a mesma linha para cada uma. Sai com 0 quando o app
local respondeu (qualquer status) e com 1 em `error:`, `Token not found` ou `Request not found` (nesse caso nada é
entregue).

## Falhas na entrega (`listen` e `replay`)

Para ver o que o seu app faz quando o webhook chega mal, o `listen --forward` e o `replay` injetam falhas na entrega
ao app local: mensagem que some, que chega duas vezes, atrasada, fora de ordem, cortada no meio do corpo, aos
pingos, ou que o "provedor" desiste de esperar e tenta de novo. Sem nenhuma dessas opções, nada muda.

```bash
# metade das mensagens chega duas vezes; a mesma semente repete as mesmas duplicatas
anzol listen --forward http://localhost:3000 --chaos-duplicate 50 --chaos-seed 7

# atraso, corpo cortado e retentativa com backoff, como um provedor faria
anzol listen --forward http://localhost:3000 --chaos-delay 200..800 --chaos-abort 20 --retries 3

# três mensagens gravadas, entregues fora de ordem
anzol replay <token> <id1> <id2> <id3> --to http://localhost:3000 --chaos-reorder 3
```

Com um app que responde 409 ao `X-Request-Id` repetido:

```
Listening on http://localhost:8084/9daa…7c10 (forwarding to http://localhost:3000)
Chaos: duplicate 50%; seed 7
12:56:58 POST /pedidos/1 -> 200 (5 ms)
12:56:59 POST /pedidos/2 -> 200 (1 ms)
12:56:59 POST /pedidos/2 -> 409 (0 ms) [chaos: duplicate]
12:56:59 POST /pedidos/3 -> 200 (1 ms)
12:56:59 POST /pedidos/3 -> 409 (0 ms) [chaos: duplicate]
12:56:59 POST /pedidos/4 -> 200 (1 ms)
```

E o segundo exemplo, com `--chaos-seed 7` e um app que pede `Retry-After: 1` uma vez:

```
Chaos: delay 200..800 ms, abort 20%, retries 3; seed 7
12:58:49 POST /pedidos/1 attempt 1/4 -> 200 (5 ms) [chaos: delay 625 ms]
12:58:50 POST /pedidos/2 attempt 1/4 -> 503 (1 ms), retrying in 1000 ms (Retry-After) [chaos: delay 313 ms]
12:58:51 POST /pedidos/2 attempt 2/4 -> 200 (1 ms)
12:58:53 POST /pedidos/7 attempt 1/4 -> cut after 17 of 34 bytes, retrying in 991 ms [chaos: delay 307 ms, abort]
12:58:54 POST /pedidos/7 attempt 2/4 -> cut after 17 of 34 bytes, retrying in 1447 ms [chaos: abort]
12:58:56 POST /pedidos/7 attempt 3/4 -> 200 (1 ms)
```

| Opção | O que faz |
|---|---|
| `--chaos-drop P` | Com chance de P % (0 a 100, com ou sem `%`), a mensagem não é entregue: `-> dropped [chaos: drop]` |
| `--chaos-duplicate P` | Com chance de P %, a mensagem é entregue duas vezes seguidas; a segunda linha leva `[chaos: duplicate]` |
| `--chaos-delay MIN..MAX` | Espera um tempo sorteado na faixa antes de cada entrega: `200..800`, `1s..3s`, ou um valor só (`500`); `[chaos: delay 312 ms]` |
| `--chaos-reorder N` | Segura N entregas (2 a 100), `-> held 1 of 3`, e as manda embaralhadas, nunca na ordem de chegada: `[chaos: reordered (arrived 3 of 3)]`. A leva incompleta sai 2 s depois da última (`listen`) ou no fim (`replay`); Ctrl+C a descarta |
| `--chaos-abort P` | Com chance de P % a cada tentativa, manda os cabeçalhos (com o `Content-Length` do corpo inteiro) e metade do corpo e fecha a conexão, sem esperar resposta: `-> cut after 500 of 1000 bytes [chaos: abort]`. Só com alvo `http://` |
| `--chaos-slow B` | Manda o corpo a B bytes por segundo, um pedaço a cada décimo de segundo: `[chaos: slow 50 B/s]` |
| `--chaos-timeout T` | Desiste de esperar a resposta do app T depois de mandar o corpo (`500`, `2s`; padrão 30 s): `-> error: timed out after 500 ms [chaos: timeout]` |
| `--retries N` | Retenta (0 a 10) depois de erro de conexão, prazo, corte, 5xx e 429. Espera 1 s, 2 s, 4 s… até 30 s, com jitter (entre a metade e o valor da vez), ou o `Retry-After` do app (segundos ou data HTTP, até 30 s). A linha ganha `attempt n/total` e `, retrying in <ms> ms` |
| `--chaos-seed N` | Semente dos sorteios: a mesma semente repete as mesmas falhas nas mesmas mensagens (a n-ésima mensagem sorteia igual, faça o app o que fizer com as anteriores). Sem ela, uma é sorteada e aparece na linha `Chaos:` |

Tempo sem unidade é ms, como nas outras opções do CLI. A retentativa e a duplicata repetem os cabeçalhos e o corpo
gravados byte a byte (o `X-Request-Id`, o `Idempotency-Key` ou o `X-GitHub-Delivery` do provedor chegam iguais),
para o app mostrar que é idempotente. As entregas continuam uma de cada vez: enquanto uma espera (atraso,
retentativa), as seguintes aguardam, sem que o `listen` dê a conexão com o servidor como caída.

A linha de cada tentativa é `HH:mm:ss MÉTODO caminho[ attempt n/total] -> resultado[, retrying in <ms> ms[ (Retry-After)]][ [chaos: …]]`,
com resultado `<status> (<ms> ms)`, `error: <motivo>`, `cut after <n> of <total> bytes` ou `dropped`. A linha
`Chaos: …; seed <n>` sai depois do `Listening on` (no `replay`, antes das entregas).

Opção de caos com valor inválido sai com 2, o motivo no stderr, sem entregar nada. O `replay` sai com 1 quando alguma
entrega terminou sem resposta do app (erro, prazo ou corte), mesmo depois das retentativas; mensagem descartada pelo
`--chaos-drop` não conta.

## `anzol rules pull` e `anzol rules push`

```bash
anzol rules pull <token>                     # a lista de regras no stdout
anzol rules pull <token> --file regras.json  # no arquivo (o stdout fica vazio)
anzol rules push <token> regras.json         # troca a lista inteira da URL pela do arquivo
anzol rules push <token> --dry-run regras.json   # só mostra o que o push mudaria; não grava
```

O `pull` escreve a lista como o `GET /token/{id}/rules` a devolve, em JSON indentado com 2 espaços,
UTF-8 e quebra de linha final, o mesmo formato do Export da tela. O `push` manda o arquivo no
`PUT /token/{id}/rules` (a lista inteira: regra que não está no arquivo deixa de existir, e `[]`
apaga todas) e imprime `Pushed <n> rule(s)`. Regra com `id` o mantém; sem `id`, o servidor gera um.
Ida e volta `pull` → `push` → `pull` dá o mesmo arquivo.

Com `--dry-run`, o `push` compara o arquivo com as regras salvas, por `id`, e imprime no stdout o resumo em JSON
`{"equal": [id…], "changed": [{"id", "name", "fields"}], "removed": [{"id", "name"}], "added": [{"id"?, "name"}]}`
(regra sem `id`, ou com um que a URL não tem, é nova), sem gravar, com saída 0. Ele não valida as regras (uma nota no
stderr lembra disso): quem valida é o servidor, no push de verdade. Arquivo com `id` repetido sai com 1.

```
$ anzol rules push 9f3c…e21a regras.json
0.match.path.regex: The regex is invalid.
1.priority: The priority must be at least 1.
```

| Situação | Saída |
|---|---|
| Regras recusadas pelo servidor (422) | cada `chave: mensagem` numa linha do stderr (chave em notação de ponto a partir da lista; `rules` quando o arquivo não é uma lista); nada muda na URL; saída 1 |
| Token inexistente | `Token not found` no stderr, saída 1 |
| Arquivo do `push` inexistente | `File not found: <arquivo>`, saída 1, sem chamar o servidor |
| Arquivo do `push` que não é JSON | `Invalid JSON in <arquivo>: <motivo>`, saída 1, sem chamar o servidor |
| Pasta do `--file` inexistente | `Could not write <arquivo>: no such directory`, saída 1 |

## `anzol send`

Simula o provedor: dispara webhooks assinados como o Stripe, o GitHub, o Shopify ou o Slack
assinariam, direto para o receptor do seu app, e tenta de novo quando ele falha. Serve para testar a
verificação de assinatura, a idempotência e o que o app faz com a retentativa, sem depender do
provedor de verdade. Entrega direto no `--to`, sem passar pela API do Anzol (não usa `--server`); o `--to` pode ser
o receptor do seu app ou uma URL do Anzol.

```bash
# Stripe: 3 retentativas com backoff exponencial (1 s, 2 s, 4 s), Idempotency-Key igual em todas
anzol send --to http://localhost:3000/webhooks/stripe \
  --provider stripe --secret whsec_teste \
  --header "Content-Type: application/json" --header "Idempotency-Key: {{uuid}}" \
  --data '{"id":"evt_{{random 24}}","type":"payment_intent.succeeded","created":{{timestamp}}}' \
  --retries 3

# GitHub: corpo de um arquivo, 5 eventos com meio segundo entre eles
anzol send --to http://localhost:3000/webhooks/github \
  --provider github --secret segredo-do-webhook \
  --header "Content-Type: application/json" --header "X-GitHub-Event: push" \
  --header "X-GitHub-Delivery: {{uuid}}" \
  --data-file push.json --repeat 5 --interval 500
```

```
14:02:07 #1 attempt 1/4 -> 503 (12 ms), retrying in 1000 ms
14:02:08 #1 attempt 2/4 -> 429 (3 ms), retrying in 5000 ms (Retry-After)
14:02:13 #1 attempt 3/4 -> 200 (9 ms)
#1 delivered after 3 attempt(s)
```

| Opção | Padrão | O que faz |
|---|---|---|
| `--to <url>` | obrigatória | Receptor (`http://` ou `https://`), com caminho e query |
| `--method`, `-X` | `POST` | Método |
| `--header`, `-H "Nome: valor"` | — | Repetível; placeholders no valor. `Host`, `Content-Length`, `Connection`, `Expect` e `Upgrade` não são aceitos (o cliente HTTP os controla); valor fora do ASCII é recusado |
| `--data`, `-d <texto>` / `--data-file <arquivo>` | sem corpo | Corpo (arquivo lido em UTF-8, byte a byte); placeholders valem nos dois; um ou outro. Sem `Content-Type` automático: mande `--header "Content-Type: application/json"` |
| `--provider stripe\|github\|shopify\|slack\|generic` | sem assinatura | Assina como o provedor; exige `--secret` |
| `--secret <s>` | — | Segredo do HMAC; nunca aparece na saída |
| `--sig-header H`, `--algorithm sha1\|sha256\|sha512`, `--encoding hex\|base64`, `--prefix P` | —, `sha256`, `hex`, sem prefixo | Só no `generic`; `--sig-header` é obrigatório nele |
| `--retries N` | `0` | Retentativas depois da primeira tentativa, de 0 a 10 |
| `--backoff fixed\|exponential` | `exponential` | Espera `initial` (fixo) ou `initial × 2^(n-1)` antes da tentativa n+1, sem jitter |
| `--initial-delay ms` / `--max-delay ms` | `1000` / `30000` | Primeira espera e teto de toda espera, `Retry-After` incluído |
| `--timeout ms` | `10000` | Prazo de cada tentativa (conexão e resposta) |
| `--repeat N` / `--interval ms` | `1` / `0` | Quantos eventos e a pausa entre o fim de um e o início do próximo |

**Assinatura.** As mesmas fórmulas da [verificação de assinatura](api.md#verificação-de-assinatura) do
servidor: uma URL do Anzol configurada com o mesmo provedor e segredo grava `valid: true`.

| Provedor | Header | Conteúdo assinado (HMAC) |
|---|---|---|
| `stripe` | `Stripe-Signature: t=<agora>,v1=<hex>` | SHA-256 de `"{t}.{corpo}"` |
| `github` | `X-Hub-Signature-256: sha256=<hex>` | SHA-256 do corpo |
| `shopify` | `X-Shopify-Hmac-Sha256: <base64>` | SHA-256 do corpo |
| `slack` | `X-Slack-Signature: v0=<hex>` e `X-Slack-Request-Timestamp: <agora>` | SHA-256 de `"v0:{ts}:{corpo}"` |
| `generic` | `<--sig-header>: <--prefix><hex ou base64>` | `--algorithm` do corpo |

A assinatura é refeita a cada tentativa (timestamp novo, como o Stripe faz) e substitui um `--header`
com o mesmo nome.

**Atributo cifrado (E2EE).** Aqui, E2EE quer dizer cifrado do remetente até a URL do Anzol: a ponta que abre é o
servidor do Anzol, que decifra na chegada e grava o valor decifrado na mensagem. A CLI não cifra, não gera chave nem
lê JWKS: `anzol send` só assina com HMAC. Para mandar um JWE, monte-o fora (com uma biblioteca JOSE, no formato da
[decifra de atributo](api.md#decifra-de-atributo-e2ee): um JWS ES256 dentro de um JWE ECDH-ES/A256GCM para a chave
pública do JWKS da URL) e entregue o corpo pronto com `--data-file`. Para só ver a decifra funcionando, use o
[laboratório](api.md#laboratório-e2ee): pela API (`POST /e2ee-lab` e `POST /token/{id}/e2ee-lab/run`), pela tela
ou pelo MCP, não pela CLI. Ele gera e entrega as mensagens pelo próprio servidor; o remetente de teste dele não
serve para assinar um JWE montado fora, porque a chave privada fica no Redis da URL e nenhuma rota a devolve.

Do outro lado: `listen` e `replay` entregam o corpo como chegou, com o JWE; `wait-for` imprime a mensagem completa
no stdout, **com o atributo decifrado** (`decrypted`: a URL com decifra é sempre protegida, e o `--read-secret` que a
abre também mostra o valor), que vai para o log do CI. O `test` faz o mesmo quando aponta com `--token` para uma URL
que decifra; a URL que ele mesmo cria não decifra. Numa URL com decifra, `--match '{"decryption": "valid"}'` espera só
as decifradas.

**Placeholders** no corpo e nos valores de `--header`, resolvidos uma vez por envio: as retentativas
são o mesmo evento e levam os mesmos valores (só a assinatura muda).

| Placeholder | Valor |
|---|---|
| `{{uuid}}` | UUID novo a cada envio; o mesmo em todas as ocorrências do envio |
| `{{now}}` | Instante do envio em ISO-8601 UTC, em segundos (`2026-09-26T14:02:07Z`) |
| `{{timestamp}}` | O mesmo instante em segundos Unix |
| `{{seq}}` | Número do envio no `--repeat`: 1, 2, 3… |
| `{{random N}}` | N letras e dígitos aleatórios, N de 1 a 256; cada ocorrência sorteia a sua |
| `{{{{` | `{{` literal (`{{{{uuid}}` chega como `{{uuid}}`) |

Outro `{{…}}`, ou `{{` sem fechar, é recusado antes de enviar (`Invalid template in --data: unknown
placeholder {{foo}}`, saída 1).

**Retentativa** em erro de conexão, timeout, 5xx e 429; nunca em 2xx, 3xx e nos outros 4xx. Quando a
resposta traz `Retry-After` (segundos ou data HTTP), ele substitui o backoff e a linha termina em
` (Retry-After)`; a espera nunca passa de `--max-delay`.

**Saída.** Uma linha por tentativa, `HH:mm:ss #<seq> attempt <n>/<total> -> <status> (<ms> ms)` ou
`-> error: <motivo>`, com `, retrying in <ms> ms` quando vai tentar de novo; e uma por envio,
`#<seq> delivered after <n> attempt(s)` (2xx) ou `#<seq> gave up after <n> attempt(s)`. Um envio que
desiste não interrompe o `--repeat`. Sai com 0 se todos os envios entregaram e com 1 se algum
desistiu ou se as opções são inválidas (motivo no stderr, nada é enviado). Ctrl+C sai com 130 sem
reenviar.

## `anzol wait-for`

Para o teste de integração ou E2E do seu app: depois de disparar a ação que gera o webhook, espera
(com prazo) até a URL receber a requisição esperada, e diz por que não chegou quando falha. Usa o
[`requests/wait`](api.md#esperar-por-mensagens) da API.

```bash
# um POST em /pedidos… com status "pago" no corpo JSON, em até 10 s; as mensagens vão para o jq
anzol wait-for --token <uuid> --method POST --path /pedidos --json-path '$.status="pago"' --timeout 10000 | jq '.[0].content'

# 3 webhooks que casam o match de uma regra (inline ou de arquivo), só os que chegarem daqui em diante
anzol wait-for --token <uuid> --match-file match.json --count 3 --new

# num teste: lê a posição da fila ANTES de disparar e espera a partir dela (sem corrida)
CURSOR=$(anzol cursor <uuid>)
curl -s -X POST http://localhost:8084/<uuid>/pedidos -d '{"status":"pago"}'
anzol wait-for --token <uuid> --after "$CURSOR" --path /pedidos --timeout 10000
```

```
$ anzol wait-for --token 9f3c…e21a --method DELETE --path /evento/2 --timeout 1500
[]
timed out after 1506 ms: 0/1 matched
closest: #1790438428567114 bbe0928d-1e7f-4684-961c-9a2e86c4980d
  - method: expected DELETE, got POST
```

| Opção | Padrão | O que faz |
|---|---|---|
| `--token <uuid>` | obrigatória | A URL observada |
| `--match <json>` / `--match-file <arquivo>` | `{}` (casa qualquer mensagem) | O objeto `match` de uma [regra de resposta](api.md#regras-de-resposta); um ou outro |
| `--method M` | — | Repetível: casa qualquer um deles (`match.method`) |
| `--path <prefixo>` | — | O caminho depois do token começa com o prefixo (`match.path.prefix`) |
| `--header "Nome: valor"` | — | Repetível: o cabeçalho tem exatamente o valor (`match.headers`, nome sem caixa) |
| `--body-contains <texto>` | — | O corpo contém o texto |
| `--json-path '<caminho>[=<json>]'` | — | Repetível: sem `=`, o caminho existe no corpo JSON; com `=`, o valor nele é igual ao que vem depois do primeiro `=`, lido como JSON (`$.valor=10` é o número) ou, se não for JSON, como texto (`$.status=pago`) |
| `--count N` | `1` | Quantas mensagens que casam são necessárias (1 a 100) |
| `--timeout ms` | `30000` | Quanto esperar por mensagens novas (0 a 300000; `0` só olha o histórico) |
| `--after <seq>` / `--new` | todo o histórico | Só mensagens com `seq` maior; `--new` usa o `seq` da mais nova no momento em que o comando começa. Um ou outro |

`anzol cursor <token>` imprime no stdout só o `seq` da mensagem mais nova da URL (`0` sem mensagens), com saída 0;
token inexistente dá `Token not found` no stderr e saída 1. Num teste, o `--new` perde o disparo que chega antes de o
`wait-for` começar; ler o cursor antes de disparar e esperar com `--after` não tem essa corrida.

Os atalhos montam o `match` e se somam ao `--match`: atalho de mesma chave de topo substitui a do
`--match` (`--method` troca `method`; `--body-contains` e `--json-path` juntos formam o `body`), e todas as
condições valem em E.

**Saída.** O stdout é só o JSON das mensagens que casaram, um array numa linha (completas, como o
`GET /token/{id}/request/{requestId}`, em ordem de `seq`), pronto para o `jq`; no prazo sem casar,
as que casaram até ali (ou `[]`). O resumo vai para o stderr: `matched <n>/<count> in <ms> ms`, ou
`timed out after <ms> ms: <n>/<count> matched` seguido de `closest: #<seq> <uuid>` e uma linha
`  - <frase>` por condição que falhou na mensagem que chegou mais perto (sem essas linhas se nenhuma
mensagem foi avaliada).

| Situação | Saída |
|---|---|
| Casou | 0 |
| Prazo acabou sem casar (ou a URL foi apagada durante a espera) | 1 |
| Uso inválido (opção desconhecida ou com valor errado, `--after` com `--new`, `--match` que não é objeto JSON, arquivo inexistente), `match` recusado pelo servidor (422, cada `chave: mensagem` numa linha do stderr), `Token not found` ou servidor fora do ar | 2, stdout vazio |

Quem corta a espera é o servidor: o prazo HTTP do CLI é o `--timeout` mais 10 s.

## `anzol test`

O teste de CI num comando só: cria uma URL, roda o comando que faz o seu app mandar o webhook (o gatilho, depois do
`--`), espera a requisição chegar com as condições do [`wait-for`](#anzol-wait-for), confere o status que a URL
respondeu e apaga a URL, passe ou falhe. Usa as rotas de sempre da API, sem `curl` nem `jq`.

```bash
# {url} no gatilho vira a URL criada; a regra do arquivo responde 202 ao POST em /pedidos
anzol test --rules regras.json --method POST --path /pedidos --json-path '$.status=pago' --status 202 \
  -- ./dispara-pedido.sh {url}

# sem gatilho: mostra a URL e espera o webhook mandado de fora (outro job, um provedor de verdade)
anzol test --path /pedidos --timeout 120000

# numa URL que já existe (não é apagada no fim)
anzol test --token <uuid> --path /pedidos -- ./dispara-pedido.sh {url}
```

```
$ anzol test --rules regras.json --method POST --path /pedidos --json-path '$.status=pago' --status 202 -- ./dispara-pedido.sh {url}
url: http://localhost:8084/31c2…f633 (created; deleted at the end)
rules: pushed 1 rule(s) from regras.json
cursor: 0
trigger: ./dispara-pedido.sh exited with 0 after 202 ms
[{"uuid":"7951…c91b","token_id":"31c2…f633","method":"POST",…,"rule":{"id":"9191…8ab6","name":"Pedido aceito"},…,"response":{"status":202},"seq":1790640792929422}]
matched 1/1 in 5 ms
status: 1/1 answered 202
url: deleted
```

Na ordem, o que ele faz:

1. Cria a URL, ou usa a do `--token`.
2. Com `--rules`, troca as regras da URL pelas do arquivo, como o `rules push` (o 422 sai como no `rules push`).
3. Lê o cursor (o mesmo número do `anzol cursor`) **antes** do gatilho: só conta o que chegar depois dele, e o webhook
   que chega antes de a espera começar não se perde. Numa URL criada ali, o cursor é `0`.
4. Pede ao servidor que confira o `match` e o `--count` (um `requests/wait` com `timeout` 0, que responde na hora):
   recusados, o gatilho nem roda.
5. Roda o gatilho até ele sair. `{url}`, em qualquer argumento, vira a URL; o ambiente dele ganha `ANZOL_URL` e
   `ANZOL_TOKEN`. O stdout e o stderr do gatilho vão para o stderr, e só o nome do programa é impresso (os argumentos
   podem ter segredo). Sem gatilho, imprime `waiting: send the requests to <url>`.
6. Espera como o `wait-for --after <cursor>`.
7. Com `--status`, confere que cada mensagem que casou foi respondida com esse status (o `response.status` gravado:
   o da regra que respondeu ou o padrão da URL).
8. Apaga a URL que criou, também quando falha, no Ctrl+C e no SIGTERM de um job cancelado.

| Opção | Padrão | O que faz |
|---|---|---|
| `-- <gatilho> [argumentos]` | nenhum | O comando que faz o seu app mandar o webhook |
| `--token <uuid>` | cria uma URL | Usa uma URL que já existe e não a apaga no fim |
| `--rules <arquivo>` | — | Arquivo JSON com a lista de regras, no formato do `rules pull` |
| `--status N` | — | Toda mensagem que casou tem de ter sido respondida com `N` |
| `--match`, `--match-file`, `--method`, `--path`, `--header`, `--body-contains`, `--json-path`, `--count`, `--timeout` | os do `wait-for` | As condições e o prazo, [como no `wait-for`](#anzol-wait-for) |

A URL do `{url}` é o `--server` mais o token: o app que manda o webhook precisa alcançar o servidor por esse endereço.
No zsh, `{url}` logo antes de um redirecionamento (`… {url} > saida.json`) vira descritor de arquivo e some da linha;
ponha entre aspas (`'{url}'`) ou leia a URL de `ANZOL_URL`.

**Saída.** O stdout é o do `wait-for`: só o array JSON das mensagens que casaram. O stderr tem uma linha por passo
(`url:`, `rules:`, `cursor:`, `trigger:`, o resumo do `wait-for`, `status:`), a saída do gatilho e, na falha, o
`closest` do `wait-for`, que diz qual condição a mensagem mais perto não cumpriu:

```
timed out after 2009 ms: 0/1 matched
closest: #1790640756737566 a47f…6a0
  - body $.status: expected "cancelado", got "pago"
url: deleted
```

| Situação | Saída |
|---|---|
| As mensagens chegaram (e o `--status` bateu) | 0 |
| O prazo acabou sem casar, ou alguma que casou foi respondida com outro status | 1 |
| Uso inválido, `--rules` ou `match` recusados pelo servidor (422), `Token not found` ou servidor fora do ar | 2 |
| O gatilho não subiu ou saiu com código diferente de 0 (a espera não começa) | 3 |

No GitHub Actions, o servidor sobe como serviço com a [imagem publicada](../README.md#início-rápido), e o CLI é construído do
fonte da mesma versão:

```yaml
jobs:
  webhook:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:8.10.2-alpine
      anzol:
        image: ghcr.io/isdiegoalves/anzol:0.5.0
        ports: ["8084:8080"]
        env:
          REDIS_HOST: redis
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          repository: isdiegoalves/anzol
          ref: v0.5.0
          path: .anzol
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "25"
      - name: CLI do Anzol
        run: |
          (cd .anzol/cli && ./gradlew --no-daemon -q installDist)
          echo "$PWD/.anzol/cli/build/install/anzol/bin" >> "$GITHUB_PATH"
      # a imagem não tem curl para um health-cmd: o passo espera a tela responder
      - name: Anzol no ar
        run: timeout 60 sh -c 'until curl -sf -o /dev/null http://localhost:8084/; do sleep 1; done'
      - run: anzol test --rules regras.json --method POST --path /pedidos --status 202 -- ./dispara-pedido.sh {url}
```

Os serviços se acham pelo nome (`REDIS_HOST: redis`), e o CLI e o gatilho, que rodam no runner, falam com o Anzol em
`localhost:8084`, o padrão do `--server`.

## Servidor

`--server <url>`, senão a variável `ANZOL_SERVER`, senão `http://localhost:8084`. Vale para `listen`,
`replay`, `rules`, `wait-for`, `cursor` e `test` (o `send` fala direto com o `--to`) e vem depois do subcomando: `anzol listen --server https://hooks.exemplo --forward …`,
`anzol rules pull <token> --server https://hooks.exemplo`. URL protegida: `--read-secret`, na mesma posição, ou
`ANZOL_READ_SECRET` (ver [Privacidade](privacidade.md#cli-e-mcp)).

## O que é reenviado

| Parte | Reenvio |
|---|---|
| Método | O gravado (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) |
| URL | `<forward>` sem a barra final + caminho depois do token + query como está na `url` gravada (o servidor grava a query com os pares em ordem alfabética) |
| Cabeçalhos | Os gravados, cada valor da lista, **menos** `connection`, `keep-alive`, `transfer-encoding`, `te`, `trailer`, `upgrade`, `proxy-*` (valem só para a conexão original), `host` (vira o do `--forward`), `content-length` (recalculado) e `expect` |
| Corpo | O `content` gravado, em UTF-8 |
| Multipart | Os campos de texto gravados, remontados com um boundary novo (que não aparece em nenhum campo) no `Content-Type` reenviado; nome escapado como o navegador faz (`"` CR LF → `%22` `%0D` `%0A`); arrays do PHP viram `campo[0]`, `campo[chave]` |

## Limitações

- **Corpo binário chega diferente:** o servidor grava o corpo como texto, e bytes que não são UTF-8
  viram U+FFFD (`�`). Imagem, protobuf ou gzip cru não chegam iguais ao original.
- **Arquivos de multipart não são reenviados:** o servidor não guarda arquivos nem o corpo cru do
  multipart, só os campos de texto. A linha avisa com `[files were not forwarded: not stored by the server]`.
- **Como o servidor grava, não como chegou:** cabeçalho repetido chega com o último valor, `_` no
  nome vira `-`, nomes em minúsculas, e `content-type` vazio aparece nas mensagens sem corpo
  (o servidor grava assim).
- **Cabeçalho com valor fora do ASCII** chega com `?` no lugar desses caracteres (limite do
  cliente HTTP do Java).
- **Caminho com caractere que não é válido numa URI** (ex.: `"` cru) não é reenviado: sai uma linha
  `error:` com o motivo.
- **Queda longa com limpeza automática:** mensagens que a limpeza apagou durante a queda não
  existem mais no servidor e não são reenviadas.
- Reenvio com prazo de 30 s por mensagem; sem `--json`, filtros, túnel para a internet ou
  reenvio em paralelo.
