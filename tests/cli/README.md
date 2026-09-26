# Aceite caixa-preta do CLI

Testes `node --test` (Node 24, sem dependências) que rodam o script do CLI como processo contra o
app real e conferem, por fora, o que chega ao "app local" e o que o CLI imprime. Ninguém edita estes
testes para o CLI passar: o formato das linhas é contrato.

## Como rodar

Pré-requisitos: Node 24+, o app no ar (`docker compose up -d --build` na raiz, porta 8084) e o CLI
instalado.

```bash
cd cli && ./gradlew installDist && cd ..
node --test tests/cli/*.test.mjs        # ou: cd tests/cli && node --test
```

O Node 24 não expande diretório no `--test` (`node --test tests/cli/` procura um módulo com esse
nome); use o glob acima ou rode de dentro da pasta.

| Variável | Padrão | Uso |
|---|---|---|
| `WEBHOOK_CLI` | `cli/build/install/webhook/bin/webhook` (relativo à raiz do repo) | Script do CLI sob teste |
| `WEBHOOK_SERVER` | `http://localhost:8084` | App real (só `http://`); também herdado pelo CLI |

Sem o CLI, cada teste falha com `CLI não encontrado em …; rode ./gradlew installDist`; sem o app,
com `servidor webhook.site não responde em …`.

Cada teste cria os próprios tokens e os apaga ao fim, passe ou falhe (`DELETE /token/{id}/request`
e depois `DELETE /token/{id}`), inclusive a URL que o `listen` sem `--token` cria: todo uuid que esse
CLI imprimiu atrás de uma barra é apagado. Os arquivos de regras de `regras.test.mjs` ficam numa pasta
temporária do sistema, apagada ao fim de cada teste.

## Infra (`support/`)

- `cli.mjs`: o CLI como processo filho, stdout e stderr linha a linha, espera por regex com prazo
  (a falha traz a saída do CLI), SIGINT/SIGKILL ao fim; regex das linhas da especificação.
- `capturador.mjs`: o app local, servidor HTTP que guarda método, caminho+query, cabeçalhos crus,
  corpo em bytes e hora de chegada (`em`, ms); `responder(requisicao, indice)` opcional devolve
  `{ status, cabecalhos, atraso }` por requisição (503 duas vezes e depois 200, `Retry-After`,
  resposta lenta); leitor de multipart.
- `proxy.mjs`: proxy TCP entre o CLI e o app real; `derrubar()` corta as conexões e fecha a porta,
  `religar()` volta na mesma porta. Ganchos opcionais: `aoEvento(evento)` roda depois de cada evento
  `request.created` entregue ao CLI, com o SSE parado até ele terminar (derrubar ali corta logo depois
  daquele evento); `antesDaResposta(linha)` pode devolver uma função que roda quando a resposta de
  uma requisição da API já saiu do servidor e ainda não chegou ao CLI.
- `servidor.mjs`: API de tokens e mensagens, webhook por HTTP cru (cabeçalho repetido, underscore,
  hop-by-hop, chunked) e assinatura do SSE; `rajada` (N POSTs com no máximo P em voo) e
  `mensagensPorSeq` (todas as mensagens por `after=<seq>` a partir de 0, a ordem que o reenvio deve
  seguir; falha se a API não devolve `seq`).
- `conferencia.mjs`: a regra de reenvio conferida contra a mensagem gravada, lida pela API.

## O que cobre

| Teste | Critério |
|---|---|
| `listen.test.mjs` CA-1 | `listen` sem `--token` imprime URL nova que existe no servidor; POST chunked com query e caminho extra chega com o mesmo método, `<forward>` + caminho após o token + query crua da `url` gravada, corpo idêntico e cabeçalhos gravados, menos `connection`, `keep-alive`, `te`, `trailer`, `upgrade`, `proxy-*` (não chegam com o valor gravado), `host` (vira o do `--forward`) e `content-length` (recalculado, sem `transfer-encoding`); linha com o status do app (201) e ms ≥ o atraso do app |
| `listen.test.mjs` CA-2 | `--token` usa a URL existente; token inexistente → `Token not found` no stderr e saída 1 |
| `robustez.test.mjs` CA-3 | ~1 MB com `/` e não-ASCII (o evento SSE vem `truncated`, conferido): o app recebe o corpo inteiro, byte a byte |
| `robustez.test.mjs` CA-4 | app local fora (porta recusando) → linha `error:`, o CLI segue vivo e a mensagem seguinte chega |
| `reconexao.test.mjs` CA-5 | o proxy cai, 3 mensagens chegam ao servidor na queda, o proxy volta: `Reconnected; forwarding 3 missed request(s)` e o app recebe exatamente `antes, faltou-1..3, depois`, em ordem, sem duplicar |
| `replay.test.mjs` CA-6 | `replay <token> <id> --to <url>` entrega a mesma requisição que o `listen` entregou (e a regra de reenvio), imprime a linha e sai com 0 |
| `robustez.test.mjs` CA-7 | multipart com arquivo → multipart com os campos de texto gravados (boundary coerente), sem arquivo, e o sufixo ` [files were not forwarded: not stored by the server]` |
| `listen.test.mjs` CA-8 | GET, PUT, PATCH, DELETE e HEAD com o método certo; `X-Dup: a` + `X-Dup: b` chega como o servidor grava (`b`), `X_Custom_Under` chega como `x-custom-under` |
| `listen.test.mjs` Ctrl+C | SIGINT no processo → saída 0 (parte observável do CA-9) |
| `ordem.test.mjs` CA-10 | rajada de 60 POSTs com 30 em paralelo; o proxy corta logo depois do primeiro evento SSE que chega antes de outro mais antigo ainda não entregue (ou do 25º, se nada inverter) e volta 1 s depois: o app recebe as 60 exatamente uma vez, na ordem de `seq` |
| `ordem.test.mjs` CA-11 | rajada de 60 com 30 em paralelo, sem queda: o app recebe as 60 uma vez, na ordem de `seq` (não na do SSE) |
| `ordem.test.mjs` CA-12 | 120 mensagens na queda; na primeira listagem da recuperação (resposta já montada, ainda não entregue) as 3 mais novas são apagadas: as outras 117 chegam todas, uma vez, na ordem de `seq` |
| `ordem.test.mjs` CA-13 | 3 mensagens antes do `listen`, no mesmo segundo; na queda a mais nova (o cursor) é apagada e chega `/depois`: o app recebe só `/depois` e a linha diz `forwarding 1` |
| `regras.test.mjs` pull | `rules pull <token>`: stdout é JSON formatado (com recuo) igual ao `GET /token/{id}/rules`, saída 0; com `--file`, o arquivo tem esse JSON e nenhum `id` da lista sai no stdout |
| `regras.test.mjs` push | `rules push <token> <arquivo>` com 3 regras sobre um token que tinha outra: `Pushed 3 rule(s)`, saída 0; o `GET` devolve só as 3, com `id` uuid, iguais (sem os `id`s) ao que a API grava num PUT direto do mesmo arquivo |
| `regras.test.mjs` ida e volta | pull `--file` → a lista do servidor é esvaziada → push do arquivo → pull `--file`: os dois arquivos são idênticos byte a byte e o `GET` volta ao original, com os mesmos `id`s (regras com todos os campos das fases A e B) |
| `regras.test.mjs` 422 | push com regras inválidas (3 chaves): saída 1, sem `Pushed`, cada par chave/mensagem do 422 que a API dá para o mesmo arquivo numa linha do stderr, regras salvas intactas |
| `regras.test.mjs` erros | token inexistente → `Token not found` no stderr e saída 1 (pull e push; o push não cria o token); arquivo inexistente e JSON inválido → saída 1, mensagem no stderr, regras intactas |
| `send.test.mjs` CA-1 | `send --method PUT` com query, 4 `--header` e `--data`: chega método, caminho+query, cabeçalhos e o corpo byte a byte com `{{uuid}}` (igual no cabeçalho e no corpo), `{{now}}` ISO-8601 UTC e `{{timestamp}}` na janela do envio, `{{seq}}` = 1, `{{random 1\|16\|256}}` alfanuméricos, `{{{{` → `{{`; `--data-file` com UTF-8 e CRLF, POST por padrão; linhas `#1 attempt 1/1 -> 201 (…)` e `#1 delivered after 1 attempt(s)`, saída 0 |
| `send.test.mjs` CA-2 | stripe, github, shopify, slack e generic (padrões sha256/hex; sha512/base64/`hmac=`; sha1/hex): o receptor confere a assinatura com `node:crypto` sobre os bytes recebidos (timestamps a ≤ 5 s da chegada); prova cruzada: URL da 8084 com a mesma `signature` grava `{provider, valid: true, reason: null}` |
| `send.test.mjs` CA-3 | 503, 503, 200 com `--retries 3 --initial-delay 1100` (exponencial padrão): linhas `1/4 -> 503 …, retrying in 1100 ms`, `2/4 … 2200 ms`, `3/4 -> 200`, `delivered after 3`, saída 0; intervalos medidos no receptor entre −30 e +2500 ms da espera; corpo e `Idempotency-Key: {{uuid}}` idênticos nas 3; Stripe reassinado com `t` crescente e sempre válido. Fixo (400, 400); exponencial com teto (300, 500, 500), 4 × 503 → `gave up after 4`, saída 1 |
| `send.test.mjs` CA-4 | 429 + `Retry-After: 1` → `retrying in 1000 ms (Retry-After)` e ≥ 1 s medido; `Retry-After: 5` com `--max-delay 400` → 400 ms; `Retry-After` em data HTTP (~3 s) → espera entre 1 e 3 s com `(Retry-After)`; 400 → uma tentativa, `gave up after 1 attempt(s)`, saída 1; porta recusando → `-> error: …, retrying in 3000 ms`, o receptor sobe na porta e a 2ª tentativa entrega (~3 s depois da linha); `--timeout 500` estourado → erro e retenta |
| `send.test.mjs` CA-5 | `--repeat 3 --interval 300`: `{{seq}}` 1..3 no corpo e no cabeçalho, `{{uuid}}` distintos, intervalos ≥ 300 ms, três `delivered`, saída 0; com o 2º recusado (500, sem retentativa): os três saem, `#2 gave up after 1 attempt(s)`, saída 1 |
| `send.test.mjs` segredo | toda execução com `--secret` falha se o segredo aparece em qualquer linha do stdout ou do stderr |

## Leituras da especificação assumidas

- `--server` vem depois do subcomando (`webhook listen --server … --forward …`).
- `Listening on …` só aparece com a assinatura do SSE pronta: o teste manda o webhook logo depois.
- Linhas casadas por inteiro (`^…$`), sem prefixo. Em `<caminho?query>` vale qualquer texto sem
  espaço que termine no caminho após o token + query gravada (o CLI pode imprimir o token ou a URL
  inteira). Linhas de mensagem podem sair no stdout ou no stderr; `Token not found`, só no stderr.
- `Reconnected; forwarding <n> …` conta as mensagens gravadas durante a queda.
- `replay` com sucesso sai com 0.
- Ordem de reenvio = ordem de `seq` da API (`after=0` depois da rajada), não a ordem de disparo nem
  a do SSE. Os testes de `ordem.test.mjs` exigem a API com `seq` e `after` (ver
  `tests/contract/README.md`); contra um app sem isso falham em `mensagensPorSeq`.
- CA-12: as mensagens apagadas durante a recuperação podem chegar ou não (o CLI pode já tê-las lido);
  se chegarem, é uma vez e no lugar delas na ordem de `seq`. A recuperação precisa passar por
  `GET /token/{id}/requests` (é onde o proxy apaga).
- CA-13: o cursor apagado não conta como perdido: `Reconnected; forwarding 1 missed request(s)`.
- `rules pull|push`: `--server` depois dos argumentos (`webhook rules pull <token> --server …`, a ordem
  do Anexo C). O CLI herda `WEBHOOK_SERVER` apontando para uma porta fechada (`127.0.0.1:9`): só o
  `--server` leva ao app.
- `rules pull` "formatado" = JSON com uma linha por campo e recuo; o conteúdo é comparado como JSON
  com o `GET` (a ordem das chaves não conta), mas a ida e volta compara os dois arquivos byte a byte.
- `rules pull --file`: o que sai no stdout é livre, desde que não traga a lista.
- `Pushed <n> rule(s)` casada por inteiro, no stdout ou no stderr; `n` = regras gravadas.
- 422 do push: cada par chave/mensagem numa mesma linha do stderr (ex.: `1.match.path.regex: The regex is
  invalid.`), em qualquer formato; as chaves e mensagens esperadas vêm da própria API.
- `send`: `--to` é o alvo; não usa `--server` nem `WEBHOOK_SERVER`. Linhas casadas por inteiro, no stdout
  ou no stderr; `HH:mm:ss` é a hora local e o `(<ms> ms)` da tentativa não é conferido. Outras linhas
  são livres, mas toda linha com ` attempt ` ou ` attempt(s)` tem de seguir o formato da §1.
- `send`: `<total>` = `--retries` + 1; a espera impressa é exata: `initial × 2^(n-1)` (sem jitter) ou
  `initial` no fixo, cortada por `--max-delay`; o `Retry-After` substitui o backoff (mesmo se menor) e
  também é cortado pelo teto. Com a espera do `Retry-After` cortada pelo teto, o sufixo ` (Retry-After)`
  é livre. A linha da tentativa sai antes da espera.
- `send`: `{{uuid}}` é um valor por envio (o mesmo em todas as ocorrências do corpo e dos cabeçalhos); todos
  os placeholders (inclusive `{{random N}}`, `{{now}}` e `{{timestamp}}`) ficam iguais entre as tentativas;
  a assinatura Stripe/Slack usa o relógio da tentativa. `{{{{` vira `{{` literal (o texto que segue não é
  placeholder: `{{{{uuid}}` → `{{uuid}}`). Placeholders valem também no `--data-file`.
- `send`: timeout e erro de conexão saem como `-> error: <motivo>` (motivo livre). Com `--repeat`, um envio que
  desiste não interrompe os seguintes; o código de saída é 1 se algum desistiu. `--repeat`/`--interval`
  espaçam o início dos envios em ≥ `--interval`.
- `send`: sem o comando (ou sem uma opção dele), cada teste falha com `o CLI em … recusou a linha de comando
  (erro de uso); falta \`webhook send\` ou alguma opção dele?`.
- Arquivo inexistente e JSON inválido: a mensagem é livre, mas não pode ser erro de uso do CLI
  (`Usage:`, `unexpected extra argument`, `no such subcommand`…). Esse erro de uso falha qualquer teste
  de `regras.test.mjs` com `o CLI em … recusou a linha de comando; falta webhook rules …?`, para os casos
  de erro não passarem contra um CLI sem os comandos.
