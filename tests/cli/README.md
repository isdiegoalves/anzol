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
| `WEBHOOK_CLI` | `cli/build/install/anzol/bin/anzol` (relativo à raiz do repo) | Script do CLI sob teste |
| `WEBHOOK_SERVER` | `http://localhost:8084` | App real (só `http://`); também herdado pelo CLI |

Sem o CLI, cada teste falha com `CLI não encontrado em …; rode ./gradlew installDist`; sem o app,
com `servidor Anzol não responde em …`.

Cada teste cria os próprios tokens e os apaga ao fim, passe ou falhe (`DELETE /token/{id}/request`
e depois `DELETE /token/{id}`), inclusive a URL que o `listen` e o `test` sem `--token` criam: todo uuid que esse
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
  seguir; falha se a API não devolve `seq`); `criarTokenProtegido(segredo)` cria uma URL com `read_secret` e a
  apaga ao fim com o header `X-Webhook-Secret` (`apagarToken` aceita os cabeçalhos).
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
| `regras.test.mjs` `--dry-run` (UX de Regras, E-07) | `rules push <token> --dry-run <arquivo>` com uma regra igual, duas alteradas (`response.status`, `priority`), uma removida e uma nova: saída 0, sem `Pushed`, regras intactas, e o resumo do `diff_rules` (JSON conferido item a item, ou texto com cada alterada numa linha com o campo e cada removida e nova citada); o arquivo do `pull` sem mudança → tudo igual; token inexistente → `Token not found` e saída 1, sem criar o token |
| `cursor.test.mjs` cursor (patamar D1, DX-14) | `cursor <token>`: stdout é só o `seq` da mensagem mais nova (uma linha de dígitos; `0` numa URL vazia), igual ao da API, saída 0, e nada é gravado; token inexistente → `Token not found` no stderr, stdout vazio, saída ≠ 0; URL protegida → o número com `--read-secret`, e sem ele saída ≠ 0, stdout vazio e nenhum segredo na saída |
| `cursor.test.mjs` roteiro (patamar D1, DX-14) | `cursor` → disparo → `wait-for --after <cursor>`, com o disparo **antes** de o `wait-for` começar: saída 0 em menos de 10 s só com a mensagem nova (a antiga que casa fica de fora); na mesma situação `--new --timeout 0` sai com 1 e `[]`; cursor `0` de URL vazia acha a primeira mensagem |
| `test.test.mjs` URL criada (patamar C1, CA-11) | `test --method --path --json-path -- <gatilho> {url}`: o gatilho (o Node do teste, sem curl) manda o POST para a URL que recebeu; saída 0 antes do prazo, stdout só com essa mensagem (`token_id` e `url` da URL criada) e a URL apagada no fim (410); `--rules` com uma regra que responde 202: `--status 202` sai com 0 e `--status 201` com 1, o 201 citado no stderr e a URL apagada também na falha; prazo sem casar → saída 1, `[]`, `timed out after …` e `closest: #<seq>`; gatilho que sai com 5 → saída 3 sem esperar o prazo, stdout vazio; `match` que o servidor recusa (regex inválida) → saída 2, `match.path.regex: …` no stderr, o gatilho não roda; sem gatilho, a URL impressa recebe o POST de fora e o comando sai com 0 |
| `test.test.mjs` `--token` (patamar C1, CA-11) | numa URL com uma mensagem antiga que casa, o gatilho manda outra: só a nova sai no stdout (o cursor foi lido antes do gatilho) e a URL continua (200); token inexistente → saída 2, `Token not found`, o gatilho não roda |
| `bytecode.test.mjs` (patamar D1, DX-05) | toda classe dos `.jar` de `<instalação>/lib` tem bytecode de Java 21 ou anterior (`major` ≤ 65), lido do próprio arquivo, sem rodar Java; a falha lista o maior `major` de cada `.jar` |
| `send.test.mjs` CA-1 | `send --method PUT` com query, 4 `--header` e `--data`: chega método, caminho+query, cabeçalhos e o corpo byte a byte com `{{uuid}}` (igual no cabeçalho e no corpo), `{{now}}` ISO-8601 UTC e `{{timestamp}}` na janela do envio, `{{seq}}` = 1, `{{random 1\|16\|256}}` alfanuméricos, `{{{{` → `{{`; `--data-file` com UTF-8 e CRLF, POST por padrão; linhas `#1 attempt 1/1 -> 201 (…)` e `#1 delivered after 1 attempt(s)`, saída 0 |
| `send.test.mjs` CA-2 | stripe, github, shopify, slack e generic (padrões sha256/hex; sha512/base64/`hmac=`; sha1/hex): o receptor confere a assinatura com `node:crypto` sobre os bytes recebidos (timestamps a ≤ 5 s da chegada); prova cruzada: URL da 8084 com a mesma `signature` grava `{provider, valid: true, reason: null}` |
| `send.test.mjs` CA-3 | 503, 503, 200 com `--retries 3 --initial-delay 1100` (exponencial padrão): linhas `1/4 -> 503 …, retrying in 1100 ms`, `2/4 … 2200 ms`, `3/4 -> 200`, `delivered after 3`, saída 0; intervalos medidos no receptor entre −30 e +2500 ms da espera; corpo e `Idempotency-Key: {{uuid}}` idênticos nas 3; Stripe reassinado com `t` crescente e sempre válido. Fixo (400, 400); exponencial com teto (300, 500, 500), 4 × 503 → `gave up after 4`, saída 1 |
| `send.test.mjs` CA-4 | 429 + `Retry-After: 1` → `retrying in 1000 ms (Retry-After)` e ≥ 1 s medido; `Retry-After: 5` com `--max-delay 400` → 400 ms; `Retry-After` em data HTTP (~3 s) → espera entre 1 e 3 s com `(Retry-After)`; 400 → uma tentativa, `gave up after 1 attempt(s)`, saída 1; porta recusando → `-> error: …, retrying in 3000 ms`, o receptor sobe na porta e a 2ª tentativa entrega (~3 s depois da linha); `--timeout 500` estourado → erro e retenta |
| `send.test.mjs` CA-5 | `--repeat 3 --interval 300`: `{{seq}}` 1..3 no corpo e no cabeçalho, `{{uuid}}` distintos, intervalos ≥ 300 ms, três `delivered`, saída 0; com o 2º recusado (500, sem retentativa): os três saem, `#2 gave up after 1 attempt(s)`, saída 1 |
| `send.test.mjs` não-ASCII | `--header` com valor fora do ASCII: saída ≠ 0, mensagem cita o cabeçalho, nada chega ao receptor (o cliente HTTP do JDK trocaria o caractere por `?`; decisão do dono: recusar) |
| `send.test.mjs` segredo | toda execução com `--secret` falha se o segredo aparece em qualquer linha do stdout ou do stderr |
| `wait-for.test.mjs` atalhos (CA-6) | conferidos pelo efeito, com `--timeout 0` sobre mensagens gravadas que só o `match` certo separa: `--method PUT --method GET --count 2` → as duas (lista, não a última); `--path /pedidos` → `/pedidos/1` e `/pedidos`, não `/x/pedidos` (prefixo); `--header "x-evento: pago" --header "X-Conta: 7"` → só a que tem os dois exatos (igualdade, nome sem caixa, em E); `--body-contains`; `--json-path '$.status'` (existe); `'$.valor=10'` casa `10`, não `"10"` (JSON); `'$.status=pago'` e `'$.status="pago"'` (texto); `'$.expr=a=b'` (corta no primeiro `=`); dois `--json-path` e `--body-contains` em E |
| `wait-for.test.mjs` `--match` (CA-6) | `--match <json>` e `--match-file` com método e query; `--match '{"method":["POST"],"path":{"equals":"/a"}}' --path /b` → só `POST /b/2` (o atalho substitui o `path` e o `method` do `--match` fica) |
| `wait-for.test.mjs` saída (CA-6) | stdout inteiro é um array JSON com as mensagens que casaram, cada uma igual ao `GET /token/{id}/request/{id}`; stderr `matched <n>/<count> in <ms> ms`; prazo de 1500 sem casar → saída 1, `[]`, `timed out after <ms ≥ 1400> ms: 0/1 matched`, `closest: #<seq> <uuid>` da mensagem e uma linha `  - method … POST … PUT`; 2 de 3 → saída 1, as 2 no stdout, `2/3`, sem `closest`; `--count 3` com 4 → as 3 de menor `seq`; URL vazia com `--timeout 2500` → espera ≥ 2400 ms e sai com 1 (o prazo HTTP do CLI tem folga), sem `closest` |
| `wait-for.test.mjs` código 2 (CA-6) | sem `--token`; `--after` com `--new`; `--match` e `--match-file` que não são JSON; arquivo inexistente; `--count` 0 e 101; 422 da API (regex inválida); token inexistente; servidor fora (`--server http://127.0.0.1:9`): saída 2 com mensagem no stderr |
| `wait-for.test.mjs` `--new` e `--after` (CA-6) | `--new --timeout 0` com só uma antiga que casa → saída 1 e `[]`; `--new` com uma nova a cada 400 ms → saída 0 com uma das novas (nunca a antiga), antes do prazo; `--after <seq da 1ª> --count 2` → 2ª e 3ª; `--after <seq da mais nova>` → saída 1 |
| `privacidade.test.mjs` com segredo (item 12, CA-5) | numa URL protegida (pré-condição: `GET /token/{id}` sem o header dá 401), com `--read-secret` e, em outro teste, com `WEBHOOK_READ_SECRET`: `listen` imprime `Listening on …` e entrega o POST (linha com o status do app); `replay` entrega a mensagem e sai com 0; `wait-for --path --timeout 0` sai com 0 e o stdout é a mensagem igual à da API; `rules push` grava (`Pushed 1 rule(s)`, conferido pela API) e `rules pull` devolve o que a API tem. Em toda execução o segredo não aparece no stdout nem no stderr |
| `privacidade.test.mjs` sem segredo | `listen`, `replay`, `wait-for` e `rules pull` sem o segredo e com `--read-secret` errado: saída ≠ 0, nada chega ao app local, nenhum dos dois segredos na saída, a mensagem continua na URL |

## Leituras da especificação assumidas

- `--server` vem depois do subcomando (`anzol listen --server … --forward …`).
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
- `rules pull|push`: `--server` depois dos argumentos (`anzol rules pull <token> --server …`, a ordem
  do Anexo C). O CLI herda `WEBHOOK_SERVER` apontando para uma porta fechada (`127.0.0.1:9`): só o
  `--server` leva ao app.
- `rules pull` "formatado" = JSON com uma linha por campo e recuo; o conteúdo é comparado como JSON
  com o `GET` (a ordem das chaves não conta), mas a ida e volta compara os dois arquivos byte a byte.
- `rules pull --file`: o que sai no stdout é livre, desde que não traga a lista.
- `Pushed <n> rule(s)` casada por inteiro, no stdout ou no stderr; `n` = regras gravadas.
- 422 do push: cada par chave/mensagem numa mesma linha do stderr (ex.: `1.match.path.regex: The regex is
  invalid.`), em qualquer formato; as chaves e mensagens esperadas vêm da própria API.
- `rules push --dry-run` (E-07): o token segue como primeiro argumento (o api-contrato escreve só `push --dry-run
  <arquivo>`) e `--dry-run` vai antes do arquivo. "O mesmo resumo" do `diff_rules` não tem formato fixado: vale o
  JSON `{equal, changed, removed, added}` no stdout ou texto em que cada alterada aparece numa linha com o nome ou o
  `id` e o campo, e cada removida e cada nova numa linha com o nome ou o `id` (a igual não aparece numa linha com um
  campo alterado). Token inexistente responde como o push de hoje.
- `cursor` (patamar D1): o token é posicional, como em `rules` e `replay`, e `--server` e `--read-secret` vêm depois
  dele. O código de saída do erro fica livre, desde que não seja 0. Sem o comando, cada teste falha com `falta
  \`anzol cursor\` ou alguma opção dele?`.
- `test` (patamar C1): o gatilho vem depois do `--`, `{url}` num argumento vira a URL; `--server` vem depois do
  subcomando, e o CLI herda `WEBHOOK_SERVER` numa porta fechada. A URL criada é lida da primeira `<servidor>/<uuid>`
  que o CLI imprime, no stdout ou no stderr. Códigos: 0 casou, 1 não casou ou `--status` diferente, 2 erro, 3 o gatilho
  falhou; o texto das linhas é livre, menos o resumo do `wait-for` (`timed out after <ms> ms: <n>/<count> matched` e
  `closest: #<seq> …`) e a chave do 422 (`match.path.regex: …`). Sem o comando, cada teste falha com `falta \`anzol
  test\` ou alguma opção dele?`.
- `bytecode.test.mjs`: a pasta `lib` é a irmã da pasta do script (`<WEBHOOK_CLI>/../../lib`). Classes em
  `META-INF/versions/N/` com N > 21 são ignoradas (o Java 21 não as carrega). O teste não prova que o CLI roda num
  Java 21 de verdade, só que o bytecode permite: rodar fica com a matriz de JDK do CI.
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
  (erro de uso); falta \`anzol send\` ou alguma opção dele?`.
- Arquivo inexistente e JSON inválido: a mensagem é livre, mas não pode ser erro de uso do CLI
  (`Usage:`, `unexpected extra argument`, `no such subcommand`…). Esse erro de uso falha qualquer teste
  de `regras.test.mjs` com `o CLI em … recusou a linha de comando; falta anzol rules …?`, para os casos
  de erro não passarem contra um CLI sem os comandos.
- `wait-for`: `--server` depois do subcomando; o CLI herda `WEBHOOK_SERVER` numa porta fechada. Os testes
  exigem o app com `POST /token/{id}/requests/wait` (ver `tests/contract/README.md`).
- `wait-for`: o resumo são linhas do stderr casadas por inteiro: `matched <n>/<count> in <ms> ms`, ou
  `timed out after <ms> ms: <n>/<count> matched` seguida de `closest: #<seq> <uuid>` e de uma linha
  `  - <frase>` (dois espaços) por condição, estas só quando a API devolve `near_miss`. Outras linhas no
  stderr são livres; o stdout é só o array JSON (formatação livre).
- `wait-for`: com o prazo esgotado, o stdout traz as que casaram (menos que `--count`, possivelmente `[]`) e
  `<n>` é quantas; o `<ms>` do prazo é ≥ `--timeout` − 100.
- `wait-for`: "atalho de mesma chave substitui a do `--match`" é lido por chave de topo do `match` (`path`, `method`); a
  mistura de `--header` com `headers` do `--match`, e de `--body-contains`/`--json-path` com `body` do
  `--match`, fica fora. `--body-contains` e `--json-path` juntos somam condições de corpo (E).
- `wait-for`: o texto das mensagens de erro (código 2) é livre; `--count` fora de 1..100 pode ser recusado
  pelo CLI ou pelo 422 da API. Sem o comando (ou sem uma opção dele), cada teste falha com `o CLI em …
  recusou a linha de comando; falta \`anzol wait-for\` ou alguma opção dele (…)?`.
- `wait-for --new`: sem sinal de "pronto" no CLI, o teste manda uma mensagem nova a cada 400 ms até o CLI
  sair; qualquer uma delas vale, a do histórico não.
- Segredo de leitura (item 12): "opção global" é lida como a opção aceita por `listen`, `replay`, `wait-for`,
  `rules pull` e `rules push` depois do subcomando e dos argumentos, na posição do `--server`
  (`anzol listen --server … --read-secret …`); o CLI que só a aceite antes do subcomando falha com `falta
  --read-secret (depois do subcomando)`. Os testes exigem o app com o item 12 (ver `tests/contract/README.md`).
- Sem o segredo, ou com ele errado, a mensagem e o código de saída são livres, desde que o código não seja 0 e nada
  seja entregue: a §1 não fixa a mensagem do CLI para o 401.
