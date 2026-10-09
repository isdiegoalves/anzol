# Contrato de paridade caixa-preta

Testes Playwright (TypeScript) que falam HTTP com uma URL base e descrevem o comportamento
observável do Anzol: a API de tokens e mensagens, o webhook e o evento
`request.created`. Foram gravados verdes contra o app Laravel 5.4 original e serviram de juiz
para a reescrita (Kotlin + Spring Boot no backend, Angular no front); o legado saiu do
repositório e o contrato continua sendo o juiz do app: ninguém edita os testes para o código
passar.

Nenhum teste lê código ou chaves do Redis: tudo passa pela API.

## Como rodar

Pré-requisitos: Node 24+ e o app no ar (`docker compose up -d --build` na raiz, porta 8084).

```bash
cd tests/contract
npm ci

npx playwright test                  # tudo: api + event
npx playwright test --project=api    # tokens, webhook, mensagens, listagem, busca, reenvio, IA/MCP, privacidade, erros, limpeza, volume
npx playwright test --project=event  # evento request.created (SSE)

BASE_URL=http://localhost:8087 npx playwright test   # outra instância

npm run typecheck
```

| Variável | Padrão | Uso |
|---|---|---|
| `BASE_URL` | `http://localhost:8084` | App sob teste |
| `EVENT_ADAPTER` | `sse` | Transporte do evento; `sse` é o único (o adaptador `redis` do app Laravel saiu com ele) |
| `CONTRATO_ALVO` | `novo` | `novo` exige o comportamento corrigido nos defeitos do legado (abaixo); `legado` os marca `test.fail`, como quando o app Laravel era o alvo |
| `TETO_PADRAO` | `10000` | O `ANZOL_MAX_REQUESTS` com que o app sob teste foi iniciado (limite das URLs sem `auto_cleanup`). O contrato não descobre esse valor pela API: rodar contra um app com outro teto exige declarar aqui (ex.: app com `ANZOL_MAX_REQUESTS=50` e `TETO_PADRAO=50` deixa o teste do teto rápido) |
| `ANZOL_FAULT_HOLD_MAX` | `300` | O teto (s) de conexão presa com que o app sob teste foi iniciado. O teste do teto em `regras-falhas-conexao.spec.ts` espera por ele; o `./ci.sh` usa 30 (app e contrato). Abaixo de 30 o arquivo recusa rodar: os outros testes dele conferem conexões presas por até ~20 s |
| `CONTRATO_IA` | `falso` | `falso`: o app sob teste usa o LLM falso (`ANZOL_AI_BASE_URL=http://host.docker.internal:18099`); `desligada`: stack com a IA desligada, onde só rodam os testes do 503. Sem a variável e com `BASE_URL` na 8084 (ligada ao oMLX real), os testes que chamam o LLM são pulados |
| `CONTRATO_MCP` | `ligado` | `desligado`: stack com o MCP desligado, onde só roda o teste do 404 em `/mcp` |
| `LLM_FALSO_PORTA` | `18099` | Porta do host onde o `globalSetup` sobe o LLM falso |
| `IA_MODELO_JSON` / `IA_MODELO_TEXTO` | os padrões da §1 | O `ANZOL_AI_MODEL_JSON` / `ANZOL_AI_MODEL_TEXT` do app sob teste, se o stack os mudou |

Os testes de volume (`limpeza.spec.ts`, `volume.spec.ts`) mandam de 500 a ~10.000 webhooks por teste;
o de volume grava ~150 MB no Redis do app sob teste e apaga tudo ao fim. Contra um app com dados
reais, rodar com o Redis com folga de memória.

Cada teste cria os próprios tokens e, ao terminar, apaga as mensagens (`DELETE
/token/{id}/request`) e depois o token (`DELETE /token/{id}`). A ordem importa para rodar contra o
app Laravel, cujo DELETE do token não apagava a hash de mensagens (ficava até expirar). No app
novo o DELETE do token apaga também as mensagens, o índice e o `seq`; isso não é observável pela
API (depois dele tudo responde 410) e é coberto pelo teste do backend (`TokenApiTest`).

## O que cobre

- **Token** (`specs/api/token.spec.ts`): criação sem campos e com todos (JSON, formulário e
  query string), coerção de números em string, campos ignorados (`uuid`, `cors`,
  desconhecidos), leitura (inclusive `retry_after` e `auto_cleanup` nulos por padrão), edição por `PUT` (campo ausente volta ao padrão; `cors`, `ip`,
  `user_agent`, `created_at` e `updated_at` ficam), exclusão (204 sem corpo e 410 em toda a API
  depois), validação 422 com as mensagens exatas, `PUT /token/{id}/cors/toggle`.
- **Webhook** (`specs/api/webhook.spec.ts`): GET, POST, PUT, PATCH, DELETE, OPTIONS e HEAD
  gravam e respondem com o padrão do token; `X-Request-Id` e `X-Token-Id`; Content-Type
  comparado pelo significado (tipo + parâmetros, sem caixa e sem depender de espaço), inclusive
  o `; charset=UTF-8` acrescentado a `text/*` e aos `charset_types` do nginx
  (`application/javascript`, `application/rss+xml`); Content-Type vazio some da resposta; 204
  sem corpo; `timeout` (a resposta e a gravação esperam); status pelo caminho (`/404`,
  `/404/extra`, `/500/`; `/600`, `/20`, `/0/404`, `/0/0/404` e caminhos livres usam o padrão);
  CORS desligado e
  ligado (os 4 cabeçalhos de `Controller::corsHeaders`); token inexistente → 410; corpo de
  1 MiB aceito e 1 MiB + 1 byte → 413.
- **Mensagem** (`specs/api/mensagem.spec.ts`): chaves e tipos; `request` só existe quando o
  Content-Type não é JSON (`/json` ou `+json` em qualquer lugar do tipo); formulário e
  multipart (arquivos descartados, `content` vazio); query no estilo PHP (último repetido
  vence, `+` é espaço, `a[]`, `a[k]`); `url` com a query normalizada (pares ordenados pela
  chave e re-codificados); barra final some da `url`; underscore em nome de cabeçalho vira hífen
  (#160); cabeçalho repetido fica com o último valor; `content-type` e `content-length` vazios
  presentes em toda mensagem sem corpo; `user_agent` null sem User-Agent; `X-Forwarded-*`
  ignorados; `GET` de uma mensagem; `raw` (`application/json` só para Content-Type exatamente
  `application/json`, senão `text/plain; charset=UTF-8`); apagar uma e todas. Entradas grandes e
  incomuns: 3 cabeçalhos de 3000 bytes e 150 cabeçalhos; multipart com 51 e 200 campos e com nome
  de 1000 caracteres; multipart sem `boundary` (corpo cru em `content`); aspas cruas na query e
  no caminho; `Transfer-Encoding: chunked` grava `content-length` com o tamanho real.
- **Listagem** (`specs/api/listagem.spec.ts`): `data, total, per_page, current_page,
  is_last_page, from, to`, padrões (página 1, 50 por página, `oldest`), página além do fim
  (`from` > `to`), ordenação `oldest`/`newest` com mensagens em segundos distintos e **no mesmo
  segundo** (ordem de chegada, inclusive entre páginas).
- **Seq e `after`** (`specs/api/seq.spec.ts`, `specs/event/seq.spec.ts`): toda mensagem traz `seq`,
  inteiro ≥ 1, estritamente crescente por URL na ordem de gravação e **nunca reaproveitado** (apagar a
  mais nova, ou todas, não faz a seguinte repetir um `seq`). É o mesmo na listagem, no `GET` de uma
  mensagem e no `request` do evento (inclusive o evento `truncated`). 100 POSTs com 20 em paralelo:
  os `seq` são únicos, crescem na ordem `oldest` e batem com os dos 100 eventos.
  `GET /token/{id}/requests?after=<seq>&per_page=N` devolve as mensagens com `seq` > `after`, em
  ordem crescente de `seq`, no máximo N (padrão 50), com o envelope de sempre; `page` e `sorting` são
  ignorados; `is_last_page` é true quando nada vem depois das devolvidas (inclusive quando restam
  exatamente N); `total` é o da URL; `current_page`, `from` e `to` são números sem valor definido.
  `after=0` → todas; `after` = último `seq` ou acima → `data` vazio e `is_last_page` true; `after`
  de mensagem apagada continua valendo (no meio e a mais nova). `after` que não é inteiro (`abc`,
  `1.5`) → 422 `{"after": ["The after must be an integer."]}`; negativo → 422
  `{"after": ["The after must be at least 0."]}` (as mensagens das regras `integer` e `min` do
  Laravel).
- **Volume** (`specs/api/volume.spec.ts`): 10.000 mensagens de ~15 KB numa URL com `auto_cleanup`
  10000; a primeira página (`oldest` e `newest`), uma do meio e a última respondem 200 com 50 itens e
  `total` 10000, **cada uma em até 2 s** medidos no cliente. O prazo é generoso de propósito: pega o
  custo O(total) por página (o app Laravel dava 500 com corpo vazio nesse volume) sem ficar sensível a
  máquina lenta.
- **Retry-After** (`specs/api/retry-after.spec.ts`): campo `retry_after` do token — `null`, segundos
  (inteiro ≥ 0, número ou string de dígitos; volta como número) ou data HTTP IMF-fixdate (RFC 9110
  §5.6.7; volta como foi enviada). `""` vale como ausente. Inválido (texto, negativo, fracionário,
  booleano, lista, ISO 8601, fuso diferente de `GMT`, formato obsoleto RFC 850, dia inexistente, dia da
  semana errado) → 422 `{"retry_after": ["The retry after must be a number of seconds or an HTTP
  date."]}`. `PUT` troca; `PUT` sem o campo volta a `null`. Preenchido, **toda** resposta do webhook
  leva `Retry-After: <valor>`: todos os métodos, status do token e pelo caminho (429, 503, 301, 204,
  304, 404), CORS ligado e preflight `OPTIONS`. Sem o campo, nenhuma resposta leva o cabeçalho.
- **Limpeza automática** (`specs/api/limpeza.spec.ts`): campo `auto_cleanup` — `null`, 500, 1000,
  5000 ou 10000 (número ou string; volta como número; `""` vale como ausente). Outro valor → 422
  `{"auto_cleanup": ["The selected auto cleanup is invalid."]}` (a mensagem da regra `in` do Laravel).
  `PUT` sem o campo volta a `null`. A URL **nunca** responde 410 por volume: guarda as N mais recentes
  (janela FIFO), com N = `auto_cleanup ?? ANZOL_MAX_REQUESTS` (`TETO_PADRAO`). Casos: 510
  mensagens com 500 → `total` 500, as 10 primeiras dão 404, a última é a mais nova; reduzir de 1000
  para 500 pelo `PUT` com 600 gravadas corta na hora, sem mensagem nova; 600 requisições com 20 em
  paralelo numa URL com 500 → exatamente 500 na listagem e no `total`; sem `auto_cleanup`, a 501ª
  entra e `TETO_PADRAO` + 10 mensagens deixam `TETO_PADRAO`.
- **Erros** (`specs/api/erros.spec.ts`): para cliente JSON (`Accept: application/json`, o
  Accept do AngularJS, `X-Requested-With: XMLHttpRequest` ou corpo `application/json`), o
  envelope `{success: false, error: {message, id: null}}` com 410 `Token not found`, 404
  `Request not found`, 404 e 405 de rota com mensagem vazia (405 em toda rota da API); para
  cliente comum, só o status. 413 de corpo grande numa rota da API é só status: a página vem do
  servidor web (nginx no app Laravel) em HTML, sem envelope, mesmo para cliente JSON.
- **Evento** (`specs/event/request-created.spec.ts`): payload `{request, total, truncated,
  removed}`; `request` igual à mensagem gravada; `total` é a contagem do token depois de gravar (e
  do corte); `removed` é a lista dos uuids que a limpeza automática apagou ao gravar esta mensagem
  (vazia quando nada saiu; com `auto_cleanup` 500 cheio, a 501ª traz `[a primeira]`); o evento
  só vai para o canal do próprio token; `truncated` fica true quando o JSON da mensagem passa de
  1.000.000 caracteres **contados como o `json_encode` do PHP** (`/` vira `\/`, não-ASCII vira
  `\uXXXX`): 990.000 letras não cortam, 600.000 barras e 200.000 `ç` cortam.
- **Regras de resposta, fase A** (`specs/api/regras-*.spec.ts`, helpers em `support/regras.ts`).
  Formato da regra e da API fixado no Anexo A do plano da feature (fatias 01 + 02):
  - *API* (`regras-api.spec.ts`, CA-9): `GET /token/{id}/rules` → `[]` numa URL nova; `PUT` (lista
    inteira, é o import) devolve a lista salva e o `GET` devolve a mesma, sem perda nem acréscimo;
    `id` ausente vira uuid gerado (distinto por regra), `id` enviado fica; reimportar o exportado não
    muda nada; a ordem é a enviada (não a da prioridade); `[]` apaga todas; padrões `enabled` true,
    `priority` 5, `status` 200, `body` `""`, `template` false, `scenario`/`delay`/`dribble`/`fault`
    nulos; 100 regras aceitas. Token inexistente ou apagado → 410 `Token not found` em `GET`, `PUT` e
    `rules/test`. Validação → 422 com a chave em notação de ponto a partir do índice na lista
    (`0.name`, `0.priority`, `0.match.path`, `0.match.{path|query.<nome>|headers.<nome>|body.<i>}.regex`
    com `["The regex is invalid."]`, `0.match.body.<i>`, `0.match.body.<i>.jsonPath.path`,
    `0.response.status`; `1.response.status` quando a inválida é a segunda); 101 regras
    → exatamente `{"rules": ["The rules may not have more than 100 items."]}`; um 422 não mexe nas
    regras salvas. Fora as duas mensagens exatas do Anexo A, o texto só precisa ter a forma do
    Laravel (maiúscula no início, ponto no fim).
  - *Webhook* (`regras-webhook.spec.ts`, CA-1, CA-2, CA-3): a regra que casa responde com o status, os
    cabeçalhos e o corpo dela, com `X-Request-Id` e `X-Token-Id` e a mensagem gravada como sempre;
    o status da regra vale inclusive em `/404`; regra sem `match` casa tudo. Prioridade: menor vence
    em qualquer posição, empate fica com a primeira da lista, regra melhor que não casa não
    atrapalha, desativada não responde. Nenhuma casando (ou só desativadas, ou `PUT []`): a resposta
    padrão de hoje, conferida com status, corpo, Content-Type, `timeout`, `Retry-After`, CORS e
    status pelo caminho. Cada condição casa e deixa de casar: método (lista; vazia = qualquer),
    caminho `equals` (ignora a query; `"/"` é a URL sem caminho), `prefix` e `regex`; query e
    cabeçalho com `equals`, `contains`, `regex`, `present: true|false` (nome de cabeçalho sem
    caixa); corpo com `equals`, `contains`, `regex`, `jsonPath` existe e igual (corpo não JSON não
    casa), `equalToJson` (ordem de chaves e espaçamento não importam; valor diferente, chave a mais
    ou corpo não JSON não casam); todas as condições em E.
  - *Mensagem* (`regras-mensagem.spec.ts`, CA-4): `rule` e `near_miss` sempre presentes (entraram em
    `CHAVES_MENSAGEM`). URL sem regras → os dois `null`; regra casou → `rule` = `{id, name}` da que
    respondeu (a vencedora, não outra que também casaria) e `near_miss` null, no `GET` e na
    listagem; nenhuma casou → `near_miss` = `{id, name, failed}` da regra ativa com menos condições
    falhando (vence mesmo com prioridade pior; empate → menor `priority`), uma frase por condição
    que falhou; só desativadas → `near_miss` null. As frases são casadas pelo conteúdo com regex
    tolerante: começam pelo alvo (`method`, `path`, `query <nome>`, `header <nome em minúsculas>`,
    `body <jsonpath>`) e trazem o esperado e o recebido (`method: expected POST, got PUT`,
    `header x-signature: absent`, `body $.status: expected "pago", got "pendente"`).
  - *`POST /token/{id}/rules/test`* (`regras-teste.spec.ts`, CA-8): uma regra no corpo →
    `{matches: [{uuid, seq}], misses: [{uuid, seq, failed}]}` sobre as mensagens gravadas, com
    método, caminho, query, cabeçalho e JSONPath; ordem das listas fora do contrato; não salva a
    regra nem grava mensagem; URL vazia → listas vazias; com 501 mensagens considera as 500 mais
    recentes; regra inválida → 422 com a chave da condição (o prefixo de índice não é exigido).

  Decisões onde o Anexo A deixava folga, alinhadas com o backend da fase A: os testes usam regex
  ancorada (`^…$`), então não dependem de a regex casar o valor inteiro ou só um trecho; `match` e
  `response` são opcionais (sem `match` casa tudo); o que a regra não define (Content-Type sem
  cabeçalho na regra, `Retry-After`, `timeout` e CORS quando uma regra responde) fica fora do contrato.

- **Regras de resposta, fase B** (fatias 03, 04, 05; Anexo B do plano da feature). Os testes da fase A
  que exigiam "not supported yet" para `template: true`, `scenario`, `delay`, `dribble` e `fault` saíram
  de `regras-api.spec.ts`: a fase B os aceita, e a validação deles mora nos arquivos abaixo.
  - *Templating* (`regras-template.spec.ts`, CA-5): cada teste dispara a mesma regra com `template: false`
    (o texto sai literal, `{{…}}` incluído) e com `template: true`. Contexto: `request.method`,
    `request.path` (depois do token, sem a query), `request.url` (igual à `url` gravada na mensagem),
    `request.query.<nome>` (ausente → vazio), `request.headers.<nome em minúsculas>`, `request.body` cru e
    **sem escape HTML**, `seq` (o da mensagem gravada). Helpers: `jsonPath` (texto e número como valor;
    objeto e lista como JSON, comparados pelo significado), `now` (ISO-8601 UTC a até 15 s do relógio do
    cliente) e `now format='yyyy-MM-dd'`, `randomValue` (`UUID`, `ALPHANUMERIC`, `NUMERIC`, `HEX`;
    tamanho pedido e padrão 16, por regex; duas chamadas dão UUIDs distintos), `math` (`+ - *` de inteiros
    dão inteiros; `12 / 4` aceita `3` ou `3.0`; subexpressão `(jsonPath …)`). Cabeçalhos da resposta
    templados junto com o corpo. `jsonPath` em corpo que não é JSON → o trecho vira vazio. Sintaxe
    inválida (bloco ou chaves sem fechar) e helper desconhecido (`file`, `env`) → 422 com exatamente
    `0.response.body` (`1.response.body` se a inválida é a segunda) e mensagem começando por
    `The template is invalid`; o mesmo texto com `template: false` é aceito e sai literal. Template
    inválido em cabeçalho → 422 numa chave sob `0.response.headers` (o nome exato fica fora).
  - *Cenários* (`regras-cenarios.spec.ts`, CA-6): "falha 3×, depois 200" — três regras 503 com
    `Retry-After` 1, 2 e 3 encadeando `Started → falhou-1 → falhou-2 → ok` e uma 200 em `ok` sem
    `newState` (fica), conferido pelo status, `Retry-After`, corpo e `rule` de cada mensagem; o `DELETE`
    faz tudo de novo. `GET /token/{id}/scenarios` → `[]` sem regras; cada cenário citado pelas regras
    aparece em `Started` antes da primeira requisição, com `{name, state, states}` e `states` = os
    estados citados (ordem fora). `PUT /token/{id}/scenarios/{nome}` `{state}` define o estado e a
    próxima requisição segue dele; `DELETE` volta todos a `Started` (status de sucesso: qualquer 2xx,
    o Anexo B não fixa). Só a regra que responde transiciona (outra que casaria no mesmo estado, mas
    perdeu na prioridade, não); `requiredState` ausente casa em qualquer estado; `newState` ausente
    mantém; o estado é por URL. Near miss: frase exata `scenario <nome>: expected state "X", got "Y"`
    (sozinha quando só o estado falha). **Concorrência:** 5 passos (status 230–234) e 20 requisições
    simultâneas → cada status exatamente uma vez, 15 com a resposta padrão, estado final `fim`, 20
    mensagens e cada passo em exatamente uma `rule`. Scenario sem nome, vazio ou com 101 caracteres →
    422 em `0.scenario.name` (100 aceito). Apagada a URL, `GET`/`PUT`/`DELETE` de cenários → 410.
  - *Atrasos, dribble e falhas* (`regras-falhas.spec.ts`, CA-7), medidos no cliente com margens
    generosas: piso = atraso − 20 ms, teto = atraso + 5 s. `fixed` 1500; `uniform` 800–1600 (6
    amostras, dispersão ≥ 80 ms: um atraso fixo não alcança); `lognormal` mediana 1000 e sigma 0,25
    (5 amostras entre 300 ms e 7,6 s, dispersão ≥ 50 ms); `lognormal` mediana 60 000 e sigma 3 termina
    em menos de 65 s (**teste lento, até ~60 s**; só metade das amostras passaria do teto sem o corte,
    então pega um servidor sem corte em ~50% das rodadas). 60 000 aceito em `fixed`, `uniform` e
    `lognormal`; 60 001 e negativo → 422 sob `0.response.delay`. `dribble` `{chunks: 10, durationMs:
    2000}` lido em streaming (`node:http`): corpo íntegro, `Transfer-Encoding: chunked`, primeiro pedaço
    antes de 1 s, último depois de 80% da duração, ≥ 4 separações de ≥ 100 ms entre pedaços; `chunks`
    fora de 1..100 e `durationMs` fora de 0..60000 → 422 sob `0.response.dribble`. As quatro falhas por
    socket cru (`node:net`), com a regra pedindo também status, corpo e `delay` de 5 s, que têm de ser
    ignorados (tudo termina em menos de 4 s): `connection_reset` → erro `ECONNRESET` sem resposta HTTP;
    `empty_response` → fecha limpo, zero bytes; `malformed_chunk` → linha de status e cabeçalhos válidos
    com `Transfer-Encoding: chunked` e corpo que não é chunked completo e bem formado;
    `random_data_then_close` → bytes que não começam por `HTTP/` e a conexão fecha. Em todas, a mensagem
    está gravada (listagem logo depois, sem espera) com a `rule` da falha. `fault` desconhecido → 422 em
    `0.response.fault`.

  Decisões onde o Anexo B deixava folga: `request.path` sem a query (como o `match.path`); `request.url` é
  a `url` da mensagem; o cenário aparece no `GET` assim que uma regra o cita; `PUT`/`DELETE` de cenários
  aceitam qualquer 2xx; a chave do 422 de delay/dribble só precisa começar por `0.response.delay` /
  `0.response.dribble` (o subcampo fica livre, mas "not supported yet" não vale mais); o status da linha
  de `malformed_chunk` fica livre (qualquer 1xx–5xx válido).

- **Regras de resposta: falhas de conexão, sorteio e janela** (`specs/api/regras-falhas-conexao.spec.ts`,
  `regras-chance.spec.ts`, `regras-janela.spec.ts`, helpers em `support/regras.ts`).
  - *Falhas de conexão* (`regras-falhas-conexao.spec.ts`), por socket cru (`node:net`) e por um cliente `node:http` com
    prazo: `hang` grava a mensagem antes e não manda nenhum byte em 6 s; o cliente com prazo de 2 s desiste sem
    resposta. `stall_after_headers` com status 202 e corpo de 10 bytes: linha de status, cabeçalhos da regra,
    `X-Request-Id`, `Content-Length: 10`, sem `Transfer-Encoding`, nenhum byte do corpo e a conexão aberta; o cliente vê
    o 202 e o corpo nunca termina. `truncated_body` com corpo de 20 bytes: `Content-Length: 20`, os 10 primeiros bytes e
    o servidor fecha em menos de 4 s (o `delay` da regra é ignorado); com template, a metade do corpo renderizado; o
    cliente vê o corpo acabar antes do `Content-Length`. As sete falhas vão e voltam no `PUT`/`GET`; `hang` aceita corpo
    vazio; `stall_after_headers` e `truncated_body` sem corpo (ou `""`) → 422 exato em `0.response.body`. **Teto:** 16
    presas numa URL (8 `hang` e 8 `stall`) → a 17ª recebe 503 com `X-Fault-Limit: 16 held connections on this URL` e é
    gravada com a regra e `response: {status: 503}`, enquanto outra URL ainda prende; 200 `hang` simultâneos em 20 URLs
    → de 120 a 128 presas, o resto 503 com `128 held connections on this server`, e uma URL sem regra responde em menos
    de 2 s; a vaga volta depois que o cliente fecha. Sem o cliente desistir, `hang` e `stall_after_headers` fecham no
    teto (`ANZOL_FAULT_HOLD_MAX`, de −5 s a +30 s), o `hang` sem nenhum byte (**teste lento**: espera o teto inteiro,
    300 s no padrão e 30 s no `./ci.sh`). Todo teste que prende conexão fica neste arquivo, que roda em sequência num
    worker: nenhuma outra spec pode mandar requisição a uma regra `hang` ou `stall_after_headers`.
  - *Sorteio* (`regras-chance.spec.ts`): `chance` 1, 50 e 100 vão e voltam; ausente ou `null`, a chave não aparece; 0,
    101 e −5 → `The chance must be between 1 and 100.`, 1.5, `"20"`, `true` e `{}` → `The chance must be an integer.`,
    em `0.chance` (`chance` no `rules/test`). Chance 30 em 400 requisições → aplica entre 23% e 37%; cada não aplicada
    tem `near_miss` só com `chance 30%: rolled N, not applied` (N de 31 a 100) e `conditions: ["chance"]`. O trace
    repete o sorteio da captura, igual a cada leitura, e o `rules/test` com a regra salva separa as mesmas mensagens com
    as mesmas frases. A parte não aplicada segue para a próxima regra; a regra pulada não muda o estado do cenário; sem
    as outras condições casando, não há sorteio. Regra sem os campos novos volta sem as chaves e responde sempre; `null`
    em `chance`, `active_from` e `active_until` vale como ausente. MCP: `set_rules` aceita `chance`, a janela e as
    falhas novas, `get_rules` devolve igual, `chance: 0` é `isError` com o texto do 422 e a descrição de `set_rules`
    cita os seis nomes.
  - *Janela* (`regras-janela.spec.ts`): `active_from` e `active_until` voltam em UTC, cortados no segundo, com `Z`
    (fração, `-03:00` e `+00:00` aceitos); sem fuso, só a data, texto livre, vazio, número ou booleano → 422 com
    `The active from must be an ISO-8601 date-time with a time zone, like 2026-09-29T12:00:00Z.` (e o mesmo para
    `active until`); `active_until` igual ou antes de `active_from`, depois do corte no segundo →
    `The active until must be a date after active from.` Uma janela de 6 s que abre em 5 s: antes, pulada com
    `window: opens at {de}, received at {created_at}`; dentro, responde; depois, pulada com
    `window: closed at {até}, received at …`; o trace diz o mesmo. Só `active_from` no passado vale; só `active_until`
    no passado nunca vale. O trace e o `rules/test` julgam pela hora de chegada da mensagem, não pela de agora. Ordem
    das frases: as condições do `match`, depois a janela; com algo falhando, sem sorteio.

- **Verificação de assinatura HMAC** (`specs/api/assinatura-*.spec.ts`, helpers em `support/assinatura.ts`;
  §1 do plano "assinatura-hmac"). O teste assina com `node:crypto` a partir do segredo e dos mesmos bytes
  que envia. `signature` entrou em `CHAVES_TOKEN` e em `CHAVES_MENSAGEM`, então os testes de forma de
  `token.spec.ts` e `mensagem.spec.ts` também a exigem.
  - *Provedores* (`assinatura-provedores.spec.ts`, CA-1 a CA-4): para `stripe`, `github`, `shopify`, `slack`
    e `generic` (só `header`: sha256 hex), assinatura válida → `{provider, valid: true, reason: null}` no
    `GET` e na listagem, com a resposta padrão do token; corpo alterado e segredo errado → `signature
    mismatch`; header ausente → `header <Nome> absent`; header malformado (Stripe sem `t`/`v1`, GitHub e
    Slack sem `sha256=`/`v0=`, base64 ou hex inválido) → `malformed header`. Stripe e Slack com timestamp
    412 s atrás → `timestamp outside tolerance (N s)` com N a ±30 s de 412; `toleranceSeconds` 600 aceita o
    mesmo timestamp. Stripe com vários `v1`: basta um conferir; nenhum conferindo (com o `v1` certo só no
    `v0`) → mismatch. Genérico: sha1/sha256/sha512 × hex/base64 × com e sem `prefix` (válida e corpo
    alterado); com `prefix` configurado e header sem ele → malformado; header configurado procurado sem
    caixa. Bytes crus: corpo com UTF-8 inválido (GitHub e Stripe), JSON com espaços, escapes e CRLF
    (Slack), multipart com arquivo binário (GitHub, e `request` com o campo), formulário urlencoded
    (Shopify) e `Transfer-Encoding: chunked` por socket cru (assinatura sobre o corpo sem o enquadramento).
  - *Configuração* (`assinatura-config.spec.ts`, CA-5 e CA-8): `POST`, `GET` e `PUT` devolvem o segredo
    como `"••••"` + 4 últimos e nenhum deles (nem a mensagem) contém o segredo inteiro; campos do genérico
    e `toleranceSeconds` voltam como enviados; 256 caracteres aceito. `PUT` com `signature` sem `secret`,
    ou com o mascarado (mesmo trocando de provedor), mantém o segredo e a assinatura seguinte confere; segredo
    novo troca (o antigo passa a dar mismatch); `signature: null` e `PUT` sem o campo removem (como os outros
    campos do `PUT`). 422 com chave `signature` ou `signature.*` (subcampo livre) para provedor
    desconhecido ou ausente, generic sem header, algoritmo ou encoding fora da lista, segredo vazio, ausente
    na criação ou com 257 caracteres e `signature` que não é objeto; no `PUT`, o 422 não mexe na configuração
    salva. URL sem configuração: `signature: null` no token e na mensagem (mesmo com header de assinatura),
    resposta e gravação como antes.
  - *Regras* (`assinatura-regras.spec.ts`, CA-6): `match.signature` `invalid` → 401 (divergente e
    malformada), `valid` → 202, `absent` → 428, com a `rule` certa; combina em E com as outras condições;
    volta no `GET` das regras; valor fora da lista → 422 em `0.match.signature`. Near miss:
    `signature: expected valid, got invalid (signature mismatch)` (sozinha quando só a assinatura falha) e,
    com header ausente, `expected valid, got absent` citando o header.

  Decisões onde a §1 deixava folga: os três estados da condição são disjuntos (`absent` = header ausente;
  `invalid` = header presente que não confere, inclusive malformado ou timestamp vencido), testado com a
  regra `invalid` na melhor prioridade; `POST` e `PUT` também mascaram (a §1 só cita o `GET`); `PUT` sem
  `signature` volta a `null`, como `retry_after` e `auto_cleanup`; segredo vazio no `PUT` fica fora (o
  backend o trata como "mantém"); a idade citada no motivo tem folga de ±30 s de relógio. Ficam fora:
  timestamp no futuro, header de timestamp do Slack ausente sozinho, condição `signature` numa URL sem
  configuração e `rules/test` com `match.signature`.

- **Espera por requisições** (`specs/api/wait-for*.spec.ts`, helpers em `support/espera.ts`; §1 do plano
  "wait-for"). `POST /token/{id}/requests/wait` `{match, after, count, timeout}` responde 200 com exatamente
  `{matched, count, requests, near_miss}`; `requests` tem `count` itens em ordem crescente de `seq`, cada um
  igual ao `GET /token/{id}/request/{id}`; `near_miss` é `{uuid, seq, failed}` ou `null`, e sempre `null` com
  `matched=true`.
  - *Histórico* (CA-1): mensagem gravada que casa → `matched=true` em menos de 3 s com `timeout` 20 000; sem
    `match` e com `match: {}` casa qualquer uma (a de menor `seq`); com mais que `count` casando, as `count` de
    menor `seq`.
  - *Durante a espera* (CA-2): mensagem que casa enviada 1 s depois da chamada → a resposta chega a menos de
    3 s do envio (prazo de 20 s), trazendo só ela (uma que não casa chega antes). Corrida: 15 rodadas com a
    espera e o webhook disparados juntos (0 a 40 ms de defasagem) → todas `matched=true`; pega a mensagem
    perdida entre assinar as novas e varrer o histórico.
  - *`count` e `after`* (CA-3): `count` 3 e `after` = `seq` de uma que casaria → não responde depois da 1ª e
    da 2ª (com uma que não casa no meio), responde a menos de 3 s da 3ª com as três em ordem; `after` = `seq`
    da mais nova → `{matched: false, count: 0, requests: [], near_miss: null}`; `after` 0 = todo o histórico;
    2 de 3 casando com `timeout` 0 → `matched=false`, `count` 2, as duas em `requests`, `near_miss` null.
  - *Prazo e near miss* (CA-4): `timeout` 2000 sem casar → resposta entre 1950 ms e 7 s, `near_miss` = a
    mensagem com menos condições falhando (1 falha, mesmo mais antiga que uma de 2) e só a frase do corpo;
    `timeout` 0 responde em menos de 1,5 s; as frases são as das regras (`method … POST … PUT`,
    `header x-signature … absent`, `body $.status … pago … pendente`, `path`, `query tipo`); empate → a mais
    nova; mensagem que chega durante a espera e não casa também vira `near_miss`; URL vazia → `near_miss` null.
  - *URL apagada durante a espera*: `DELETE /token/{id}` 1 s depois da chamada → 200 (não 410) a menos de 5 s
    do `DELETE`, `matched=false`; com 1 de 2 já casada, `count` 1 e ela em `requests`.
  - *Validação* (CA-5, `wait-for-validacao.spec.ts`): regex inválida → exatamente
    `{"match.path.regex": ["The regex is invalid."]}`; `method` que não é lista, condição de cabeçalho sem
    operador ou com dois, regex inválida na query ou no corpo, `body` que não é lista, `signature` fora da
    lista, `match` texto ou número → 422 com uma chave `match…` do campo; `count` 0, 101, −1, 1.5, `"abc"`,
    `true` → `count`; `timeout` −1, 300 001, 1.5, `"abc"`, `true` → `timeout`; `after` −1, 1.5, `"abc"`,
    `true` → `after`. Todo 422 é JSON, `{chave: [mensagem]}` com a forma do Laravel, e volta em menos de 5 s
    com `timeout` 20 000. Aceitos: `count` 1 e 100, `timeout` 0 e 300 000 (com histórico casando, responde
    na hora), `after` 0. Token que nunca existiu e token apagado → 410 `Token not found` no envelope JSON.

  Leituras assumidas onde a §1 deixava folga: sem sucesso, `requests` traz as que casaram (menos que
  `count`) e `count` = quantas; "avaliadas" para o `near_miss` inclui as que chegam durante a espera; com
  todas as avaliadas casando, `near_miss` é `null`; "bem antes do prazo" = até 3 s depois da mensagem; "perto
  do timeout" = de `timeout` − 50 ms a `timeout` + 5 s medidos no cliente; o 422 de `match` usa a chave sem
  prefixo de índice (`match.path.regex`), e só a regex tem mensagem exata (as outras só a forma do Laravel);
  valor não inteiro (texto, fração, booleano) é inválido como fora dos limites. Ficam fora: corpo da
  requisição ausente ou que não é objeto, mensagem apagada durante a espera, `timeout` padrão (30 s) e as
  10 000 mensagens do histórico retido.

- **Validação de schema por URL** (`specs/api/schema-*.spec.ts`, `specs/event/schema.spec.ts`, helpers em
  `support/schema.ts`; §1 do plano "validacao-schema"). `schema` entrou em `CHAVES_TOKEN` e em
  `CHAVES_MENSAGEM`, então os testes de forma de `token.spec.ts`, `mensagem.spec.ts` e
  `assinatura-config.spec.ts` também o exigem.
  - *Validação na captura* (`schema-validacao.spec.ts`, CA-1): corpo válido → `{valid: true, errors: []}` no
    `GET` e na listagem, com a resposta padrão do token (schema sem regra não muda a resposta); inválido →
    `valid: false` e `errors` = `[{path, message}]` (chaves exatas, `message` string não vazia), com o
    conjunto de `path` conferido: `/id`, `/status`, `/itens/1/qtd`; obrigatória ausente → o `path` do objeto
    (`""` na raiz, `/itens/0` no item); escape RFC 6901 (`a/b` → `/a~1b`, `m~n` → `/m~0n`). Array com 30 itens
    inválidos → exatamente 20 erros, de itens distintos entre `/0` e `/29`, e o mesmo corpo de novo dá a mesma
    lista na mesma ordem; com 5 inválidos vêm os 5. Corpo que não é JSON (texto, JSON quebrado com
    Content-Type JSON, formulário, XML) e corpo vazio (`GET`, `POST` JSON sem bytes) → exatamente
    `{valid: false, errors: [{path: "", message: "body is not JSON"}]}`. JSON escalar (`42`, `"42"`) é
    validado. `schema: {}` aceita todo JSON. Draft 2020-12 por padrão (`prefixItems` sem `$schema`); `$schema`
    draft-07 e 2019-09 valem (`items` em lista com `additionalItems: false`). URL sem schema → `schema: null`
    para todo corpo. O resultado é o da captura: mensagem gravada antes de ligar, depois de trocar ou depois
    de tirar o schema mantém o que tinha.
  - *Configuração* (`schema-config.spec.ts`, CA-2): `POST` e `PUT` devolvem o schema como enviado e o `GET`
    também; sem o campo, `null` e `PUT` sem o campo → `null` (como a `signature`); `{}` é configuração, não
    `null`; `$ref` interno (`#/$defs/…`) aceito e usado; 60.000 bytes aceito. 422 com exatamente
    `{"schema": ["The schema is invalid: <motivo>."]}` para: não é objeto (texto, número, lista, `true`,
    `false`); não compila (`type` desconhecido, `required` que não é lista, `minLength` negativo,
    `properties` que não é objeto, `pattern` com regex inválida); `$ref` remoto (`https`, `http` aninhado,
    relativo a outro documento, `file:`). 65.537 bytes → 422 só com a chave `schema` e a forma do Laravel.
    No `PUT`, todo 422 deixa a configuração salva como estava.
  - *Regras e wait-for* (`schema-regras.spec.ts`, CA-3): `match.schema` `invalid` → 400 (corpo inválido,
    texto e `GET` sem corpo), `valid` → 202, com a `rule` certa; combina em E; volta no `GET` das regras;
    `absent`, `talvez`, `true`, `1` → 422 em `0.match.schema`. URL sem schema: nem `valid` nem `invalid`
    casam, near miss `schema: expected <valid|invalid>, got not configured`. Com schema: `schema: expected
    valid, got invalid (<n> errors)` com n = número de erros gravados na mensagem (1 para corpo não-JSON) e
    `schema: expected invalid, got valid`, sozinhas quando só o schema falha. `rules/test` com `match.schema`.
    `wait-for`: `valid`/`invalid` escolhem a mensagem do histórico; a válida que chega durante a espera
    responde a menos de 3 s; near miss com as três frases; valor fora da lista → 422 em `match.schema`.
  - *Evento* (`specs/event/schema.spec.ts`, CA-4): `request.schema` no evento igual ao da mensagem gravada
    (válido, inválido com os mesmos erros, `body is not JSON`), `null` sem schema (a chave existe) e presente
    também no evento `truncated`.

  Leituras assumidas onde a §1 deixava folga: "não compila" inclui schema que viola o meta-schema do draft
  (`type: "banana"`, `required: "id"`, `minLength: -1`), não só o que a biblioteca recusa ao carregar; `true`
  e `false` (schemas booleanos) são "não é objeto"; `$ref` "interno" é só o que começa por `#` (relativo a
  outro documento e `file:` também são remotos); 64 KB lido como 65.536 bytes do JSON compacto, com folga
  para quem conta 64.000 (o teste aceito tem 60.000, o recusado 65.537); o texto do 422 de tamanho não é
  fixado; obrigatória ausente aponta para o objeto, não para a chave que falta; os `path` são conferidos
  como conjunto (a biblioteca pode dar mais de um erro por instância) e o texto de `message` é livre, salvo
  `body is not JSON`; "corpo que não é JSON" é decidido pelo conteúdo, não pelo Content-Type (JSON quebrado
  com `application/json` é não-JSON); o `n` da frase é o número de erros gravados; o evento `truncated`
  mantém `schema`. Ficam fora: corpo JSON com Content-Type que não é JSON, `$schema` de outro draft
  (draft-04, desconhecido), mais de 20 erros na frase do near miss, falha interna da biblioteca (não há
  como provocá-la pela API), confirmação de que nenhuma requisição de rede sai no `$ref` e o `POST /token`
  por formulário ou query com `schema`.

  **Formato antigo:** o contrato não lê o Redis. O que a API permite está coberto (token criado sem o campo
  lê `schema: null`; mensagem gravada antes do schema continua com `null`). A leitura de tokens e mensagens
  gravados no Redis sem o campo (app Laravel e versões anteriores) fica com os testes do backend.

- **Decifra de atributo (E2EE)** (`specs/api/e2ee-*.spec.ts`, `specs/event/e2ee.spec.ts`, helpers em
  `support/e2ee.ts`). O teste assina (JWS ES256) e cifra (JWE ECDH-ES + A256GCM) com o pacote `jose`, outra
  implementação que não a do servidor; os vetores que o `jose` se recusa a gerar (`zip`, `epk` fora da curva, JWS
  `alg=none`) são montados à mão. `e2ee` e `e2ee_keys` entraram em `CHAVES_TOKEN` e `decryption` em
  `CHAVES_MENSAGEM`.
  - *Configuração* (`e2ee-config.spec.ts`): o bloco volta com os padrões e só chaves públicas; exige segredo de
    leitura; JWK com `d`, fora da curva, de outra curva, sem `kid`, com `alg`/`use` errados ou `kid` repetido → 422
    na chave em pontos; a JWK de um remetente externo é aceita como vem.
  - *Chaves* (`e2ee-chaves.spec.ts`): gerar (até duas), apagar, JWKS público mesmo na URL protegida, 401 sem
    segredo para gerar e apagar, `PUT` mantém as chaves.
  - *Receptor* (`e2ee-receptor.spec.ts`): ida e volta com acento e emoji, rotação, reentrega com `duplicate_of`,
    caixa divergente no `app`, e cada falha com o motivo: forja do canal, troca de ciphertext, downgrade, HMAC com
    1 byte alterado, `kid` desconhecido, `alg`/`enc`/`zip`, `epk` fora da curva, JWE grande, JWS `none` e `HS256`,
    `iat` e `aud`. Chave apagada: a cifrada para ela dá `unknown_kid` com `kid_deleted_at` (data no formato de
    `created_at`); apagada e recriada com o mesmo `kid`, `decrypt_failed` com `kid_deleted_at`, e a cifrada para a
    nova abre; `kid` que a URL nunca teve, ou cuja exclusão saiu do registro (as 20 mais novas), dá `null`.
  - *Regras* (`e2ee-regras.spec.ts`): `match.decryption` com as regras do laboratório dá 200, 500, 400 e 400, e
    nunca 503; `near_miss` com o estado e o motivo; URL sem `e2ee` não casa; valor desconhecido → 422.
  - *Privacidade* (`e2ee-privacidade.spec.ts`, `specs/event/e2ee.spec.ts`): `decrypted` no `GET` e na listagem
    com o segredo, 401 sem ele; o link só-leitura e o evento levam `decryption` e nunca `decrypted`.
    `e2ee-privacidade-segredo.spec.ts`: remover o segredo com mensagem decifrada é 422 em `read_secret`, num `PUT` ou
    depois de desligar a decifra num anterior; a URL segue protegida (GET, listagem, busca e wait 401 sem segredo;
    quem só tem o UUID não põe segredo próprio); apagadas as mensagens, o segredo sai.
  - *Laboratório* (`e2ee-lab-criar.spec.ts`, `e2ee-lab-cenarios.spec.ts`, `e2ee-lab-mcp.spec.ts`): `POST /e2ee-lab`
    devolve a URL pronta (segredos só ali, chaves, remetente de teste, HMAC e regras do laboratório) e `lab` entrou em
    `CHAVES_TOKEN`; a marca não muda pelo `PUT`; a rodada de todos os cenários dá 27 de 27, sem texto aberto; URL
    comum e código desconhecido são 422; pelo MCP, o mesmo, e `create_url`/`update_url` ainda ignoram `e2ee`. O teto
    de 20 URLs de laboratório fica com os testes do backend (o contrato roda em paralelo).
  - *Descrições do MCP* (`e2ee-mcp-condicoes.spec.ts`): o `match` de `search_requests` e `wait_for_request` cita
    `decryption`; o `set_rules` descreve a condição com os quatro estados; o `get_request` diz que traz o resultado
    da decifra.
  - *Avisos do MCP* (`e2ee-mcp-avisos.spec.ts`): `update_url` com `e2ee` (outra política ou `null`) e `create_url`
    com `e2ee` devolvem `warnings` com "e2ee ignored: MCP never changes it; ask the person to change it in the UI
    (Checks › Decryption)." e a política como estava (nula na URL nova); `signature: null` numa URL que decifra e tinha
    assinatura devolve "signature removed on a URL with e2ee: decryption no longer requires a valid HMAC" (os dois
    avisos juntos quando as duas coisas vêm); sem decifra na URL, sem assinatura para tirar ou sem `e2ee` nos
    argumentos, sem `warnings`; as descrições das duas dizem que o MCP não muda `e2ee` e não apontam a rota, e a do
    `update_url` diz o que `signature: null` tira de uma URL que decifra.

- **Documento OpenAPI 3.1** (`specs/api/openapi.spec.ts`, helper em `support/openapi.ts`): o `GET /openapi.json`
  é carregado no Ajv (JSON Schema 2020-12, o dialeto do OAS 3.1) e as respostas reais das rotas principais (token,
  captura, mensagens, regras, cenários, busca, espera, estatísticas, envio, links, chaves, JWKS, laboratório) e dos
  erros 422, 401, 404 e 410 são validadas contra o schema que o documento declara para o método, o caminho e o status.

- **Busca de mensagens** (`specs/api/busca-*.spec.ts`, helpers em `support/busca.ts`; §1 do plano
  "busca-filtro-diff"). `POST /token/{id}/requests/search` `{text?, match?, sorting?, page?, per_page?}` responde
  200 com a forma do `GET /token/{id}/requests` (`data, total, per_page, current_page, is_last_page, from, to`).
  - *Texto* (`busca-texto.spec.ts`, CA-1): `text` acha como trecho, sem diferenciar maiúsculas, com o texto
    original, com a caixa trocada e com um pedaço, em cada campo, cada um numa mensagem que só o tem ali: corpo,
    nome de header, valor de header, nome de query (`chaveúnica`, que a URL guarda como `chave%C3%BAnica`),
    valor de query (`Valor Com Espaco`, que a URL guarda com `%20`), URL (caminho) e método; a busca devolve
    exatamente aquela mensagem, com `total` 1. IP inteiro e trecho acham as duas mensagens do cliente (o teste
    confere antes que o IP não aparece em outro campo). Texto que não está lá (inclusive quase igual, com espaço
    no lugar do hífen ou espaço dobrado) → exatamente a página vazia `{data: [], total: 0, per_page: 50,
    current_page: 1, is_last_page: true, from: 1, to: 0}`. `text` é literal: `(r$ 10.00) [TOTAL]*` acha, `r. 10`
    e `total.` não. `text` vazio ou ausente não filtra.
  - *Match* (`busca-match.spec.ts`, CA-2): numa URL com assinatura GitHub e schema, quatro mensagens (POST
    válida e assinada; POST com schema inválido e assinatura divergente; PUT válido sem assinatura; GET sem corpo)
    e a lista exata, em ordem `oldest`, para: `match` ausente e `{}`; `method` (lista; vazia = qualquer); `path`
    `equals`, `prefix`, `regex`; header `equals` (nome em outra caixa), `contains`, `present: false`; corpo
    `jsonPath` com `equals`, `contains`, `equalToJson` com chaves em outra ordem; `signature` `valid`, `invalid`,
    `absent`; `schema` `valid`, `invalid` (GET sem corpo é inválido). Condições combinadas em E; `text` + `match`
    em E (inclusive `text` que casa em duas e `match` que deixa uma, e combinação vazia). URL sem schema:
    `match.schema` `valid` e `invalid` não acham nada.
  - *Paginação e ordenação* (`busca-paginacao.spec.ts`, CA-3): URL vazia → a página vazia, igual à listagem. Sem
    filtro (`{}`, `text: ""`, `match: {}`), 12 combinações de `page`/`per_page` (inclusive além do fim, `per_page`
    1 e 100) × `oldest`/`newest`: a busca é **igual** à página do `GET /requests` com os mesmos parâmetros (itens e
    metadados), e a aritmética de `metaEsperada` confere com a da listagem. Padrões: `sorting` newest, `page` 1,
    `per_page` 50 (comparados com `GET /requests?sorting=newest…`). Com filtro (5 de 9 casando, intercaladas):
    `total` 5 em toda página, `from`/`to`/`is_last_page` pela mesma aritmética, páginas além do fim, as páginas
    juntas são as que casam na ordem `oldest` e `newest`; os itens são as mensagens como na listagem; o mesmo com
    `match`. 12 mensagens no mesmo segundo: ordem de chegada entre páginas. **Varre tudo:** com 520 mensagens, a
    mais antiga (fora das 500 que o `rules/test` considera) é achada por `text` e por `match` (`method`, `path`).
  - *Validação* (`busca-validacao.spec.ts`, CA-4): 422 JSON `{chave: [mensagem]}` com a forma do Laravel: `text`
    com 201 e 1000 caracteres → `text` (200 aceito); `per_page` 0, 101, −1, 1000, 1.5, `"abc"`, `true` →
    `per_page` (1 e 100 aceitos); `page` 0, −1, 1.5, `"abc"`, `true` → `page` (1 e 99 além do fim aceitos); regex
    inválida → exatamente `{"match.path.regex": ["The regex is invalid."]}`; `method` que não é lista, header sem
    operador ou com dois, regex inválida na query ou no corpo, `body` que não é lista, `signature` e `schema` fora
    da lista, `match` texto ou número → uma chave `match…` do campo. Um 422 não mexe nas mensagens. Token que
    nunca existiu e token apagado → 410 `Token not found` no envelope JSON.

  Leituras assumidas onde a §1 deixava folga: sem filtro a busca devolve exatamente a página da listagem (mesmos
  itens, com todos os campos); "trecho" é substring literal (sem regex nem curinga); o IP é procurado como texto
  (trecho do IP também acha); `text` vazio vale como ausente e não é 422; valor não inteiro de `page`/`per_page`
  (fração, texto, booleano) é inválido como fora dos limites (como no `wait-for`); a chave do 422 de `match` não
  tem prefixo de índice (`match.path.regex`, como no `wait-for`), e só a regex tem mensagem exata; "varre todas as
  mensagens retidas" vale para `text` e para `match`, inclusive além das 500 mais recentes. Ficam fora: `sorting`
  desconhecido, `text` que não é string, corpo ausente ou que não é objeto, o campo `request` (formulário) e o
  `hostname` como alvos do texto, caixa de letras não ASCII, `match.signature` numa URL sem assinatura, o tempo da
  busca com 10.000 mensagens e a leitura em lotes (não observável pela API).

- **Reenvio pelo servidor e envio montado** (`specs/api/reenvio-*.spec.ts`, helpers em `support/reenvio.ts`; §1 do
  plano "reenvio-servidor"). O app sai com a requisição, então cada teste sobe um **receptor** HTTP em Node numa porta
  livre do host (escutando em `0.0.0.0`) e passa ao app o alvo `http://{ALVO_HOST}:{porta}`; o receptor guarda método,
  alvo cru, headers e corpo em bytes, e responde o que o teste pedir (status, headers, corpo, atraso). O stack de
  teste roda com `ANZOL_OUTBOUND_ALLOW_PRIVATE=true` e `ANZOL_OUTBOUND_LOCALHOST_ALIAS=host.docker.internal` (o
  `./ci.sh` liga os dois no `docker-compose.ci.yml`); sem eles o receptor é bloqueado e quase tudo falha.

  | Variável | Padrão | Uso |
  |---|---|---|
  | `ALVO_HOST` | `host.docker.internal` | Nome pelo qual o app (no container) alcança o host onde o receptor escuta |
  | `ALIAS_LOCALHOST` | `host.docker.internal` | O `localhost-alias` do app sob teste: o `target` esperado quando o alvo é `localhost` |
  | `APP_PELO_ALVO` | `http://{ALVO_HOST}:{porta do BASE_URL}` | O próprio Anzol visto de dentro do container (prova cruzada da assinatura) |

  - *Replay* (`reenvio-replay.spec.ts`, CA-1): `keep_path` ausente vale true e acrescenta ao alvo o caminho depois do
    token e a query da mensagem (conferida pelos pares, com `%C3%A9` decodificado); com caminho no alvo (`/base`), o da
    mensagem entra depois dele; mensagem sem caminho nem query → o alvo como veio; `keep_path` false → exatamente o
    alvo pedido e `target` igual a ele. Headers (mensagem gravada por HTTP cru, com pré-condição de que a mensagem os
    guardou): `x-forwarded-*`, `x-real-ip`, `cf-*`, `proxy-*`, `keep-alive`, `te`, `trailer` e `upgrade` não chegam ao
    receptor nem aparecem em `request_headers`; `host`, `content-length` e `connection` são os do cliente de saída
    (`host` é o do alvo); todo o resto chega com o valor gravado, inclusive `authorization` e nomes que só contêm
    `cf`/`proxy` no meio (`x-cf-…`, `x-proxy-…`). Corpo byte a byte (CRLF, tab, acentos, emoji) com o método gravado em
    POST, PUT, PATCH e DELETE; 300 KB inteiros; GET sem corpo. Resposta: status, headers (nome sem caixa), corpo,
    `duration_ms` ≥ o atraso do receptor e o item do histórico igual ao resultado; corpo de 64 KB + 5000 →
    `truncated: true` e exatamente os primeiros 65 536 bytes; exatamente 65 536 → não trunca. `id` próprio e
    `source_request` = uuid da mensagem.
  - *Send* (`reenvio-send.spec.ts`, CA-2): os 7 métodos saem como pedidos (HEAD sem corpo na resposta); headers pedidos
    chegam com o valor; corpo byte a byte; `target` = a URL pedida, `source_request` ausente ou nulo; sem `body` →
    corpo vazio. **Assinado:** para `github`, `stripe`, `generic` (sha512, base64, `prefix`), `shopify` e `slack`, a URL
    de origem e outra URL do próprio Anzol recebem a mesma `signature`; `sign=true` para
    `{APP_PELO_ALVO}/{destino}` → a mensagem gravada lá tem `signature: {valid: true}` e o mesmo corpo; os headers de
    assinatura estão em `request_headers` com o valor que chegou; o segredo não aparece no resultado, no histórico nem
    na mensagem do destino. `sign=false` ou ausente numa URL com `signature` → sai sem header de assinatura. `sign=true`
    sem `signature` → 422 (chave começando por `sign`), nada sai, nada no histórico.
  - *SSRF* (`reenvio-ssrf.spec.ts`, CA-3): 200 com `error.kind=blocked`, sem `status`, registrado no histórico, para
    `169.254.169.254` (com e sem porta, e outro `169.254.x`), `0.0.0.0` (com a porta do receptor, que não recebe
    nada), `[fe80::1]`, `224.0.0.1`, `255.255.255.255`, `[::]`, `[::ffff:169.254.169.254]`, `[::ffff:a9fe:a9fe]`,
    `[::ffff:0.0.0.0]`, `ftp://`, `file://`, `gopher://`, e o nome `169.254.169.254.nip.io` (pulado se o host do teste
    não o resolve para 169.254.169.254). `169.254.169.254` em decimal (`2852039166`) e hexadecimal (`0xA9FEA9FE`) não
    sai: `blocked`, `dns` ou `invalid_url`, nunca `connect`/`timeout`. Replay bloqueado leva `source_request`.
    Redirecionamento não é seguido: receptor que responde 302 (send) ou 307 (replay) com `Location` para outro receptor
    → o resultado mostra o 3xx e o `Location`, e o outro não recebe nada em 1 s. **localhost-alias:** `localhost` e
    `127.0.0.1` no alvo chegam ao receptor do host e `target` mostra o alias (`ALIAS_LOCALHOST`) com a mesma porta,
    caminho e query.
  - *Limites* (`reenvio-limites.spec.ts`, CA-4): receptor que demora 5 s com `timeout` 1000 (send) e 1500 (replay) →
    `error.kind=timeout` com `duration_ms` perto do prazo; sem `timeout` → corte em ~10 s (9,5 a 14 s). `body` de
    exatamente 1 MiB (ASCII) sai inteiro; 1 MiB + 1 byte → 422 em `body`, nada sai. 15 replays + 15 sends passam; o
    31º no mesmo minuto (send e replay) → 429 com `Retry-After` inteiro de 1 a 60; o recusado não sai nem entra no
    histórico; outra URL continua saindo. 51 disparos (esperando o `Retry-After` do 429) → histórico com 50, do `/n/51`
    ao `/n/2` (**teste lento, ~60 s**). Os testes de limite por minuto esperam a virada do minuto se começam depois
    do segundo 40, para passar também com janela de minuto de relógio.
  - *Histórico* (`reenvio-historico.spec.ts`, CA-1, CA-4): URL nova → `[]`; send, replay e bloqueado aparecem do mais
    novo para o mais antigo, cada item igual ao resultado da chamada, com `id` distintos; o histórico é por URL.
    Apagar a URL → 410 `Token not found` no `GET /outbound`, no replay e no send; URL que nunca existiu → 410.
  - *Validação* (`reenvio-validacao.spec.ts`): 422 JSON `{chave: [mensagem]}` com a forma do Laravel. Send: `url`
    ausente, vazia, número, texto solto, sem esquema (`www.exemplo.test/…`), relativa, 2049 caracteres → `url` (2048
    passa); `method` `TRACE`, `CONNECT`, `FOO`, vazio, número, lista → `method`; `timeout` 0, 999, 30001, −1, 60000,
    1500.5, texto, booleano → `timeout` (1000 e 30000 passam). Replay: `url` ausente, vazia, texto solto; `timeout` 999
    e 30001. Um 422 não sai nem entra no histórico. Mensagem que não existe ou foi apagada → 404 `Request not found`;
    token que nunca existiu → 410 `Token not found`. Os casos válidos usam `169.254.169.254` (bloqueado na hora) para
    provar que passaram da validação sem depender de rede.
  - *Caos* (`reenvio-caos.spec.ts`): sem `chaos`, ou com `null`, o resultado não tem a chave; `chaos: {}` → o eco dos
    cinco campos com os padrões e `injected: []`. `delay_ms` 1500 → sai depois de 1,5 s, fora do `duration_ms`;
    `duplicate` → a mesma requisição (método, alvo, corpo e cabeçalhos) chega duas vezes, a segunda depois da resposta
    da primeira, e `duplicate_result` traz a segunda resposta; `abort_mid_body` (receptor de socket cru) → cabeçalhos
    com o `Content-Length` inteiro, metade do corpo e a conexão fecha, sem `status` nem `error` e com `body_bytes_sent`;
    numa mensagem sem corpo → 422 em `chaos.abort_mid_body`; `slow_body_bps` 100 com 200 bytes → o corpo inteiro em pelo
    menos 1,5 s; `timeout_ms` 500 contra um receptor de 3 s → desiste e fecha, sem `status` nem `error`; `timeout_ms`
    que não dispara não entra em `injected`; `injected` em ordem fixa (`delay_ms` antes de `duplicate`); o histórico
    guarda o resultado com o `chaos`, numa entrada só. Validação: 21 entradas inválidas (não objeto, fora da faixa, não
    inteiro, não booleano, `timeout_ms` que não é menor que o `timeout`, opção que o servidor não tem, como `drop`) →
    422 com a chave e a mensagem exatas; nada sai e nada entra no histórico. Destino bloqueado → `blocked` e nada
    injetado, nem o atraso. 30 replays com `duplicate` no minuto passam (60 chegadas) e o 31º → 429. MCP:
    `replay_request` declara `chaos` com os cinco campos e os tipos, injeta e relata; erro de validação é `isError` com
    o texto do 422.

  Leituras assumidas onde a §1 deixava folga: `ftp://`, `file://` e `gopher://` são "esquema não http(s)" do CA-3 →
  200 `blocked`; o 422 de "esquema" é para URL sem esquema (texto que não é URL absoluta); URL acima de 2048 é
  validação (422), não `invalid_url`; `timeout` em ms, inteiro de 1000 a 30000; 64 KB = 65 536 bytes e 1 MB = 1 MiB
  (1 048 576 bytes, como o limite do webhook), `body` medido em bytes; `keep_path` junta os caminhos sem barra extra
  (`/base` + `/eventos/novo`); `GET /outbound` devolve uma lista JSON (sem envelope de página), cada item igual ao
  resultado devolvido pela chamada; o resultado bloqueado ou com erro também entra no histórico, o 422/404/410/429
  não; `status` ausente ou `null` quando há `error`; `truncated` ausente vale false; headers da resposta e
  `request_headers` podem vir como texto ou lista (o helper lê o último valor, sem caixa no nome); replay e send
  dividem o limite de 30 por minuto da URL; a chave do 422 de `sign=true` sem configuração começa por `sign`.
  **Fora do contrato:** `allow-private=false` (loopback e privados bloqueados) e DNS rebinding — o stack de teste roda
  com `allow-private=true` e o contrato não controla o resolvedor; ficam com os testes do backend (resolvedor
  controlado). No OrbStack `host.docker.internal` resolve para `0.250.250.254`, dentro de `0.0.0.0/8`: o receptor só é
  alcançável porque a §1 libera os IPs do alias com `allow-private=true` (decisão de 2026-09-26); o contrato continua
  exigindo `0.0.0.0` bloqueado. Também fora: o formato de `at`, o texto de `error.message`, o contador
  `anzol.outbound` (observabilidade), HTTPS/TLS e SNI (sem receptor TLS), o Retry-After exato, a expiração do
  histórico junto com o token (não observável no tempo de um teste), a chave `token:{id}:outbound` no Redis (apagar a
  URL só é observável como 410), `method` ausente no send, `keep_path` que não é booleano, alvo com query própria
  somada à da mensagem no replay e a tela (CA-5, E2E do frontend).

- **IA local e MCP** (`specs/api/ia-*.spec.ts`, helpers em `support/ia.ts`, `support/mcp.ts` e `support/llm-falso.ts`;
  §1 do plano "ia-local"). Nenhum teste fala com o oMLX: o `globalSetup` (`support/llm-falso-global.ts`) sobe no
  host, na porta fixa 18099, um **LLM falso OpenAI-compatível** (`POST …/chat/completions`, `GET …/models`, com ou
  sem `/v1`) que vale para todos os workers e cai no fim da execução. Porta já ocupada por outro LLM falso → é
  reaproveitada; por outra coisa → aviso, e só os testes da IA falham. Cada teste põe um **marcador** no prompt
  (suggest) ou no corpo da mensagem (explain) e programa para ele as respostas do falso, na ordem (esgotadas,
  repete a última): regra (o falso obedece ao `response_format`: com a propriedade `rule` no schema, responde
  `{rule, explanation}`; sem ela, a regra sozinha), conteúdo cru (com `reasoning_content` opcional), erro HTTP,
  conexão fechada ou atraso. O falso guarda cada pedido (corpo, headers, início e fim) para o teste conferir o prompt.
  O stack sob teste precisa de IA e MCP ligados e `ANZOL_AI_BASE_URL=http://host.docker.internal:18099`.
  - *MCP* (`ia-mcp.spec.ts`, CA-1): cliente do SDK oficial (`@modelcontextprotocol/sdk`, Streamable HTTP em
    `{BASE_URL}/mcp`). As 14 ferramentas da §1 listadas, com descrição e `inputSchema` de objeto, e todas menos
    `create_url` com o argumento do UUID da URL. Fluxo: `create_url` com opções (conferidas pelo `GET /token`) →
    `wait_for_request` esperando enquanto o webhook chega → `set_rules` (a regra aparece no `GET /rules` e responde o
    webhook seguinte) → `test_rule` (casa a primeira mensagem e não a segunda) → `delete_url` (410 depois). Erro de
    validação é erro de ferramenta (`isError`) com a mensagem da API: regex inválida no `set_rules` (e nada salvo),
    `timeout` 11 no `create_url`, URL inexistente no `get_url` (`Token not found`). O segredo de assinatura não
    aparece no resultado de `create_url` nem de `get_url`, que trazem o mascarado. Com `CONTRATO_MCP=desligado`:
    `POST` e `GET /mcp` → 404.
  - *Suggest* (`ia-suggest.spec.ts`, CA-2): resposta válida → 200 `{rule, explanation, attempts: 1}`, a regra igual à
    do modelo, nada gravado (as regras existentes continuam), e a sugestão salva pelo `PUT /rules` funciona; o pedido
    ao LLM usa `ANZOL_AI_MODEL_JSON`, `temperature` 0 e `response_format` `json_schema` estrito com um schema que
    fala de `match` e `response`, e leva o prompt do dono. Uma inválida e depois válida → `attempts: 2`, e o 2º pedido
    contém as mensagens com que o parser recusou a 1ª (as mesmas do 422 do `rules/test`). Conteúdo que não é JSON conta
    como tentativa inválida. Três inválidas, cada uma por um motivo → 422 cujo corpo contém as mensagens da última,
    exatamente 3 pedidos ao LLM, cada um com os erros do anterior, nada gravado. `request_id` → o corpo da mensagem
    vai ao prompt. `prompt` ausente, vazio, número ou com 2001 caracteres → 422 em `prompt`, sem chamar o LLM; 2000
    passa. URL inexistente → 410. LLM com 500 ou conexão fechada → 502 `{error}`. Duas chamadas simultâneas na mesma
    URL nunca chegam juntas ao LLM. Regra com `match.decryption` → volta na 1ª tentativa, o schema estrito do pedido
    ao LLM aceita os quatro estados e o prompt descreve a condição. 11ª chamada no mesmo minuto → 429 com `Retry-After` de 1 a 60; outra URL segue.
    Com `CONTRATO_IA=desligada`: 503 `{"error": "AI is not configured"}`, e webhook e listagem seguem 200.
  - *Explain* (`ia-explain.spec.ts`, CA-3): URL com assinatura GitHub, schema, `default_status` 226 e uma regra.
    Mensagem com assinatura errada, `id` fora do schema e near miss da regra → `explanation` é exatamente o `content`
    do modelo (sem o `reasoning_content`); `facts` contém o motivo da assinatura, `path` e `message` de cada erro do
    schema, o nome e as frases do near miss, o status 226, o header `x-hub-signature-256` e o início do corpo, e não
    contém o segredo; o pedido ao LLM usa `ANZOL_AI_MODEL_TEXT`, leva os mesmos fatos e não leva o segredo; o corpo
    (com uma injeção "IGNORE ALL PREVIOUS INSTRUCTIONS") vai fora da mensagem `system`, com texto antes e depois
    dele, e o resto do prompt diz que o conteúdo é não confiável e proíbe seguir instruções dele; a mensagem gravada
    não muda. Mensagem que casou a regra, com assinatura e schema válidos → o nome da regra e o 202 nos fatos, sem
    `signature mismatch`; `lang: "pt-BR"` vai ao prompt. Corpo de ~10 KB → o fim não aparece nos fatos nem no pedido
    ao LLM. Mensagem decifrada numa URL com `e2ee` → o estado e as duas chaves (`kid`, `signature_kid`) nos fatos e
    no pedido ao LLM, e o valor decifrado em nenhum dos dois. LLM com 500 ou fora → 502. Mensagem inexistente → 404 `Request not found`; URL inexistente → 410. Com
    `CONTRATO_IA=desligada`: 503.

  Leituras assumidas onde a §1 deixava folga: o resultado de cada ferramenta MCP é o JSON da resposta da API (texto
  ou `structuredContent`); os argumentos têm os nomes da API (`rules`, `rule`, `timeout`, os campos do `POST /token`)
  e o UUID da URL vai no primeiro destes que a ferramenta declarar: `token_id`, `tokenId`, `uuid`, `url_id`, `urlId`,
  `token`, `id`; ferramentas além das 14 são permitidas. O 422 do suggest sem regra válida só precisa conter as
  mensagens do parser (a forma do corpo fica livre); o 502 tem a forma do 503 (`{"error": texto}`); 404 e 410 usam o
  envelope de erro da API. Os fatos do explain são conferidos pelo conteúdo (textos e números de `facts`, em qualquer
  chave), e fatos e prompt são comparados sem aspas nem barras invertidas (o app pode pô-los como JSON). "Delimitado"
  quer dizer: fora da mensagem `system` e com texto antes e depois do corpo na mesma mensagem; "não confiável" quer
  dizer: o prompt, fora o corpo, cita `untrusted` (ou "não confiável") e proíbe seguir as instruções dele. O trecho
  do corpo tem até 4 KB mais 100 bytes de folga para uma marca de corte. O `lang` vai ao prompt como `pt-BR` ou o
  nome do idioma. A chamada simultânea recusada pode ser 409 ou 429 (a §1 só diz "uma por vez"); o limite de 10 por
  minuto é medido com chamadas de uma tentativa, então vale contando por chamada ou por tentativa. O LLM com erro
  pode ser tentado de novo pelo cliente HTTP do app: o contrato não conta esses pedidos, só exige o 502 dentro do
  prazo do teste (60 s).
  **Fora do contrato:** o 503 (IA desligada) e o 404 em `/mcp` (MCP desligado) exigem outro stack, porque os dois são
  ligados no app inteiro, não por URL. O `./ci.sh` sobe um stack só, com os dois ligados, então no CI esses casos ficam
  com os testes do backend; o contrato os cobre quando roda com `CONTRATO_IA=desligada` / `CONTRATO_MCP=desligado`.
  Também ficam fora: o timeout de leitura de 90 s (lento demais para um teste), a chave de API
  (`ANZOL_AI_API_KEY`, que no CI é qualquer uma), a métrica `anzol.ai.calls` e o span (observabilidade),
  `lang` no suggest, `request_id` inexistente no suggest, as ferramentas MCP além do fluxo do CA-1 (`update_url`,
  `list_requests`, `search_requests`, `get_request`, `get_rules`, `replay_request`, `send_request`,
  `get_outbound`: só o nome e o schema são exigidos) e a tela (CA-4, E2E do frontend).

- **Privacidade e segurança da API** (`specs/api/privacidade-*.spec.ts`, helpers em `support/privacidade.ts`; §1 do
  plano "privacidade", item 12). Os testes falam HTTP pelo `fetch` do Node, não pelo `request` do Playwright, porque o
  contexto do Playwright guarda cookies e o `Set-Cookie` do `unlock` iria sozinho nas chamadas seguintes: aqui cada
  chamada diz que credencial leva (nenhuma, `X-Anzol-Secret` ou `Cookie: anzol_access=…`). `Host` diferente vai por
  HTTP cru (`httpCruCompleto`, que também lê o corpo). A fixture `urls` cria URLs protegidas e as apaga ao fim com o
  segredo (a limpeza do `tokens` apaga sem credencial, o que numa URL protegida dá 401). O stack sob teste precisa de
  `ANZOL_ALLOWED_HOSTS=localhost,127.0.0.1,[::1],host.docker.internal` (o `./ci.sh` e o compose da 8084 a definem);
  a porta dos `Host` e `Origin` válidos vem do `BASE_URL`.
  - *Acesso* (`privacidade-acesso.spec.ts`, CA-1): numa URL protegida, as 25 rotas de gestão de `/token/{id}/**` (token
    `GET`/`PUT`/`DELETE`, `cors/toggle`, `requests`, `request/{rid}`, `raw`, `search`, `wait`, `rules`, `rules/test`,
    `scenarios` `GET`/`PUT`/`DELETE`, `suggest`, `explain`, `replay`, `send`, `outbound`, `share`, `shares`,
    `shares/{sid}`, `DELETE request/{rid}` e `DELETE request`) respondem 401 com exatamente `{"error":"This URL is
    protected","protected":true}` (JSON) sem credencial e com o header errado (outro segredo, o certo + 1 caractere, o
    certo em maiúsculas), e nada muda (token, mensagens, regras, cenários, saídas, links e o link público lidos antes e
    depois com o segredo). Com o header certo, cada rota responde o que responderia numa URL aberta (o `DELETE` do token
    por último, e 410 depois). O SSE: 401 sem acesso e com o header errado; 200 com o certo, e o evento chega. A
    captura continua aberta: GET, POST, PUT, PATCH e DELETE respondem o padrão da URL e gravam. O token traz
    `protected` (`false` sem segredo, `true` com) e as chaves de sempre; o segredo não aparece no `POST`, `GET`, `PUT`
    (nem o novo nem o antigo, ao trocar), na mensagem, na listagem nem no 401. `read_secret` de 8 e 256 caracteres
    protege; 7 e 257 → 422 com a chave `read_secret`, no `POST` e no `PUT` (e o segredo anterior continua valendo).
  - *Cookie* (`privacidade-cookie.spec.ts`, CA-2): `unlock` certo → 204 sem corpo e um `Set-Cookie` `anzol_access` com
    `HttpOnly`, `SameSite=Strict`, `Path=/token/{id}`, `Max-Age=2592000`, sem `Secure` (HTTP) e sem `Domain`; o valor
    não contém o segredo e é o mesmo em dois unlocks (HMAC de id:versão). O cookie dá acesso a `GET`, `PUT`, `rules` e
    ao SSE (o evento chega); forjado, vazio ou de outra URL protegida → 401 (inclusive no SSE). Errado → 401 sem cookie;
    10 falhas e a 11ª → 429 com `Retry-After` inteiro de 1 a 60 e sem cookie; outra URL segue (401 errado, 204 certo).
    Trocar o segredo pelo `PUT` → o cookie e o header antigos dão 401, o novo abre, o unlock com o antigo dá 401 e o
    novo cookie é outro. `lock` (com ou sem cookie) → 2xx com `Set-Cookie` `anzol_access` de mesmo `Path`, expirado
    (`Max-Age` ≤ 0 ou `Expires` no passado). `unlock` e `lock` respondem sem acesso. `PUT` sem `read_secret` (e `PUT
    {}`) → `protected` continua `true` e o segredo vale; `read_secret: null` → `protected: false` e tudo abre sem
    credencial (inclusive o SSE); `PUT` com texto numa URL aberta protege de novo.
  - *Links* (`privacidade-share.spec.ts`, CA-3): numa URL protegida, `POST …/share {}` → `{id, url, expires_at,
    redact}` com `id` base62 de 16 a 22 caracteres, `url` = `/#/share/{id}`, `redact` true e `expires_at` a 7 dias
    (±2 min); `GET /shares` lista; o público lê `GET /share/{sid}` sem credencial nenhuma: exatamente a mensagem de
    `GET /token/{id}/request/{rid}` **sem `token_id` e com o UUID da `url` trocado por `[redacted]`**, mais
    `shared_at` (agora) e `expires_at` (o mesmo instante da criação); revogar → some da lista e 404. Com e sem
    `redact`, o UUID da URL não aparece em lugar nenhum do corpo do link. Definir o segredo numa URL aberta, trocá-lo
    e removê-lo revogam todos os links da URL (o 404 de um id que nunca existiu, e a lista vazia); `PUT` sem
    `read_secret` não revoga. `expires_in` `1h`, `1d`, `7d`, `30d` → o prazo certo; `redact: false` volta `false`; ids
    distintos; a lista é por URL; revogar pela URL errada não revoga. `expires_in` `2h`, `1w`, `""`, `7`, `7D` → 422
    em `expires_in`; mensagem inexistente → 404; nada criado. 50 ativos (de duas mensagens) → o 51º dá 422; revogar um
    libera a vaga. **404 igual**: revogado, mensagem apagada, todas as mensagens apagadas e URL apagada respondem
    exatamente o 404 (status, Content-Type e corpo) de um id que nunca existiu; `GET /shares` da URL apagada → 410;
    ids fora do formato → 404. **Máscara** (mensagem gravada por HTTP cru): com `redact`, os valores de
    `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-anzol-secret`, dos headers cujo
    nome contém `token`, `key`, `secret`, `password` ou `auth` (`x-auth-token`, `x-api-keys`, `x-client-secret`,
    `x-db-password`, `x-authenticated-user`, `x-monkey`) e do header de assinatura do provedor configurado
    (`x-hub-signature-256` no GitHub; o `header` do `generic`) viram `["[redacted]"]`, e os valores de query cujo nome
    contém `token`, `key`, `secret`, `password` ou `signature` sem diferenciar maiúsculas (`access_token`, `API_KEY`,
    `clientSecret`, `Password`, `x-signature`, `monkey`, `TOKENS`) viram `"[redacted]"`; o resto da mensagem é igual
    ao gravado (menos `token_id` e o UUID da `url`), inclusive `x-comum`, `x-tok`, `stripe-signature` numa URL GitHub,
    `x-hub-signature-256` numa URL sem assinatura, as queries `tok` e `segredo` e o corpo (que tem `password`). Nenhum
    valor mascarado aparece em lugar nenhum do JSON, cru ou codificado (a `url` gravada também carrega a query).
    `redact: false` → a mensagem inteira, sem o UUID da URL.
  - *Host e Origin* (`privacidade-host-origin.spec.ts`, CA-4): `Host` `evil.test`, `localhost.evil.test`,
    `evil.test:{porta}`, `127.0.0.1.nip.io` e `rebind.localhost.evil.test` → 403 `{"error":"host not allowed"}` em
    `POST /token`, token `GET`/`PUT`/`DELETE`, `requests`, `request/{rid}`, `stream`, `rules`, `unlock`, `share`,
    `shares`, `/share/{sid}` e `POST /mcp`, e nada muda; na captura → a resposta de sempre, gravada com esse
    `hostname`; `GET /` (a tela) → 200. Os quatro hosts da lista passam com e sem porta. `Origin` `http://evil.test`,
    com porta, `https://localhost.evil.test` e `http://127.0.0.1.nip.io` → 403 `{"error":"origin not allowed"}` em
    `POST /token`, `PUT` do token, `cors/toggle`, `PUT rules`, `send`, `share`, `unlock`, os dois `DELETE` de mensagem e
    o `DELETE` do token, e nada muda; `POST /mcp` idem. `GET` com `Origin` estranho passa (token, listagem, mensagem,
    link). `Origin` da própria tela (`BASE_URL`), `127.0.0.1`, `[::1]` e `host.docker.internal` na porta do app, e sem
    `Origin` (CLI) → criar, editar, regras, link e apagar passam. A captura com `Origin` estranho responde como sempre.
  - *Captura isolada* (`privacidade-captura-sandbox.spec.ts`, decisão N2 da reauditoria): a resposta padrão de uma URL
    com HTML e script (GET, POST, HEAD) e a resposta de regra trazem `Content-Security-Policy: sandbox allow-scripts
    allow-forms allow-popups allow-modals`, e nenhum valor de CSP da resposta tem `allow-same-origin`; uma regra que
    define o próprio `Content-Security-Policy` sai com o dela **e** com o sandbox (o cabeçalho pode vir repetido: o
    teste lê todos os valores).
  - *MCP* (`privacidade-mcp.spec.ts`, CA-5): as 13 ferramentas da URL declaram `read_secret` string e opcional. Numa
    URL protegida, sem `read_secret` e com ele errado, cada uma devolve `isError` com texto que cita `protected`, sem
    o segredo, e nada muda (`delete_url` não apaga, `set_rules` não grava, `send_request`/`replay_request` não entram no
    histórico). Com o certo, `get_url` (`protected: true`), `list_requests`, `get_request`, `search_requests`,
    `wait_for_request`, `get_rules`, `set_rules` (gravou, conferido pela API), `test_rule`, `replay_request`,
    `send_request`, `get_outbound` e `delete_url` (410 depois) funcionam, e o segredo não aparece em resultado nenhum.

  Leituras assumidas onde a §1 deixava folga: a varredura com header errado e sem credencial usa uma URL nova a cada 8
  rotas, porque a §1 não diz se pedido sem credencial ou com header errado conta nas 10 falhas por minuto (o 429 é
  testado só pelo `unlock`); o explain com acesso usa uma mensagem inexistente (404) e o suggest sem `prompt` (422),
  para não chamar o LLM (503 aceito num stack com a IA desligada); `POST …/share` responde 200 ou 201 e `DELETE
  /shares/{sid}` 200 ou 204; o link traz pelo menos `id`, `url`, `expires_at` e `redact`; `GET /shares` é uma lista
  JSON de objetos com `id`; `expires_at` e `shared_at` no formato de data do app (UTC) ou ISO 8601; "404 igual" é
  status, Content-Type e corpo iguais aos de um id que nunca existiu; revogar pela URL errada responde erro (≥ 400); o
  valor mascarado de header é `["[redacted]"]` (a lista da mensagem) e o de query `"[redacted]"`; "valores de query"
  inclui a query dentro da `url` gravada (a forma mascarada da `url` fica livre, desde que nenhum valor sensível
  apareça); a lista fixa de headers é exata (nome igual), e a por nome e a de query são por trecho do nome; o header do provedor mascarado é
  só o do provedor configurado; o `Host` é comparado sem a porta e o `Origin` pelo host (qualquer esquema e porta);
  `lock` responde 2xx e apaga o cookie no navegador (o valor antigo, se reenviado, não é conferido: a §1 invalida
  cookies só pela troca de segredo); o 422 de `read_secret` e de `expires_in` só precisa da chave; o erro de
  ferramenta MCP cita `protected` (o texto do 401). **Fora do contrato:** a expiração real do link (o menor prazo é
  1 h; o link expirado some pelo TTL de `share:{sid}` e fica igual ao que nunca existiu, que é o que o contrato
  compara; o corte no tempo fica com os testes do backend), a lista vazia de `allowed-hosts` (padrão do app, sem
  checagem: outro stack), `Secure` no cookie sob HTTPS (o stack é HTTP), a comparação em tempo constante, o cache de
  PBKDF2, o formato gravado no Redis (PBKDF2, `secret_version`, `anzol:server-key`, `share:{sid}`,
  `token:{id}:shares`) e o token antigo sem o campo (não protegido: lê o Redis, testes do backend), as métricas
  `anzol.privacy.unlock` e `anzol.share` e "nenhum segredo em log" (observabilidade), `read_secret` no
  `create_url` do MCP e a tela (CA-5, E2E do frontend).

- **UX de Regras: contrato novo** (C1–C5 e E-07, aprovados pelo dono em 2026-09-27; fonte única no
  `api-contrato.md` da iniciativa). Escritos antes do backend; helpers em `support/regras.ts` e `support/busca.ts`.
  - *Trace* (`regras-trace.spec.ts`, C1): `GET /token/{id}/request/{rid}/rules/trace` → exatamente `{request,
    responded_by, rules}`, cada regra com exatamente `{id, name, enabled, position, matches, failed, conditions}`.
    Com a pega-tudo respondendo, as regras que não casaram trazem as frases e chaves que o `rules/test` dá para a mesma
    regra e mensagem; sem regra respondendo, a do `near_miss` traz exatamente o `failed`/`conditions` gravados. Ordem
    de avaliação: `position` 1..N por `priority` (empate pela lista), desligadas no fim com `position: null` e
    `matches` ignorando `enabled`. Regras trocadas depois da mensagem: o trace usa as atuais e `responded_by` segue
    citando a que respondeu. Sem regras → `rules: []`. Cenário contra o estado atual (a frase `scenario …: expected
    state "Started", got "feito"`), sem transicionar nem gravar mensagem. Assinatura e schema pelo resultado gravado
    (o `PUT /token` troca segredo e schema e o trace não muda). 410 para token inexistente ou apagado; 404 com o corpo
    do `GET /request/{rid}` para mensagem inexistente, de outra URL ou apagada; 401 da URL protegida.
  - *Busca por desfecho* (`busca-desfecho.spec.ts`, C2): `outcome` `rule`, `near_miss` e `default` com a lista exata
    em ordem `oldest`, em E com `match` e `text`, paginado com `total` do filtrado, e achando pelo id de uma regra já
    tirada da lista. 422 em `outcome.type` (ausente, `null`, desconhecido, `RULE`, número) e `outcome.rule` (ausente,
    vazio, não-UUID, número, booleano, presente com `default`); `outcome` que não é objeto → 422 numa chave `outcome…`.
    Sem `outcome`, a busca é igual à listagem.
  - *Resposta gravada* (`regras-resposta-gravada.spec.ts`, `specs/event/resposta-gravada.spec.ts`, C3): `response`
    entrou em `CHAVES_MENSAGEM` (os testes de forma de `mensagem.spec.ts`, `assinatura-config.spec.ts` e
    `privacidade-share.spec.ts` passam a exigi-la). Exatamente `{status}` com o status respondido: `default_status`,
    status pelo caminho (`/404`, `/500`), 429 com `Retry-After`, a regra (inclusive em `/404`), near miss (a resposta
    padrão) e regra com atraso; template que estoura ao responder (corpo `{{request.body}}{{request.body}}` com
    600 KiB, cabeçalho `{{request.body}}` com 9 KiB) → o cliente recebe 500 e a mensagem grava `{status: 500}`, achada pela
    listagem (resolução 9); exatamente `{fault}` nas quatro falhas de rede. Igual no `GET`, na listagem, na busca, no
    link só-leitura (com e sem `redact`) e no evento SSE, inclusive o cortado.
  - *Render* (`regras-render.spec.ts`, C4): sem `render`, `rules/test` devolve exatamente `{matches, misses}`; com
    `render=1..3`, mais `rendered` com as N mais novas de `matches`, da mais nova para a mais antiga (menos se há menos;
    `[]` sem nenhuma), cada uma exatamente `{uuid, status, headers, body}` renderizada pelo motor do webhook (cabeçalho
    comparado sem caixa no nome), literal com `template: false`, status 200 e corpo vazio sem `response`, helper que
    falha vazio, `now` perto do relógio e `seq` inteiro não anterior ao da mensagem, `{uuid, fault}` com falha, `{uuid, error: "too_large"}` acima dos tetos (corpo e cabeçalho, resolução 8), sem
    atraso nem dribble (3 respostas de 5 s em menos de 3 s), sem gravar mensagem, salvar a regra ou mudar o cenário.
    `render` 0, 4, −1, 1.5, `abc`, `true` e 20 dígitos → 422 com a chave `render`.
  - *Helper `hmac`* (`regras-hmac.spec.ts`, C5): o HMAC esperado vem de `node:crypto` com o segredo configurado pelo
    `PUT /token/{id}`; padrão sha256/hex; os seis pares de `algorithm` × `encoding` e cada um sozinho; texto literal,
    `request.method`, subexpressão `jsonPath` e cabeçalho da resposta; segredo trocado assina com o novo, removido ou
    nunca configurado deixa o trecho vazio. `md5`, algoritmo desconhecido, `base32` e encoding vazio → 422 em
    `0.response.body` com `line 2` e `column N` ao salvar e ao testar, enquanto o mesmo lugar com um valor válido passa.
    O segredo não aparece na resposta, nos cabeçalhos, nas regras, no 422 nem no `rendered`, que traz o HMAC.
  - *Diferença antes de gravar* (`ia-mcp-diff.spec.ts`, E-07; o `--dry-run` do CLI está em `tests/cli`): `diff_rules`
    listada com o argumento `rules` de mesma forma do `set_rules`; exatamente `{equal, changed, removed, added}`; igual,
    `response.status`, `name` + `priority`, removida, nova sem `id` e nova com `id` que a URL não tem; nada gravado; a
    lista do `GET` reenviada → tudo igual; `[]` → todas removidas; URL sem regras → todas novas; `match.path`,
    `response.headers` e `enabled` apontados em `fields`; regra com os padrões omitidos igual à salva; regex inválida →
    erro com `The regex is invalid.`; URL inexistente → `Token not found`; URL protegida → erro que cita `protected`
    sem `read_secret`, o diff com ele.

  Leituras assumidas onde o api-contrato deixava folga (marcadas `// SUPOSIÇÃO:` nas specs): as chaves de
  `conditions` são as do near miss (`match.headers.X-Tenant`), não as do exemplo (`headers.x-tenant`), e são
  conferidas contra a própria API; a regra que casa no trace tem `failed` e `conditions` vazios; a ordem entre as
  desligadas é livre; `response` do status pelo caminho é o status respondido; o 429 grava só `{status: 429}`; o evento
  cortado mantém `response`; a ordem de `rendered` é a da mais nova para a mais antiga; `rendered: []` sem matches;
  "`seq` de agora" só exige um inteiro não anterior ao da mensagem; `hmac` assina o texto em UTF-8 e um número como o
  template o escreveria; `outcome.type` compara com caixa e `null` vale como ausente; a ordem das listas e de `fields` do
  `diff_rules` é livre, `name` de uma regra renomeada pode ser o salvo ou o proposto, a profundidade de `fields` em ramo
  aninhado é livre, a comparação é depois dos padrões, a lista inválida é recusada como no `set_rules` e a URL protegida
  exige `read_secret` como as outras ferramentas. **Fora do contrato:** a entrada `{"error": "timeout"}` do render (os
  tetos do template não deixam um render chegar a 1 s pela API; fica com os testes do backend), a mudança de ordem da
  lista no `diff_rules` (o api-contrato compara por `id`) e o `outcome: null`.

  **Formato antigo:** mensagem gravada antes de C3 não tem `response` (ou tem `null`) e continua abrindo. Nenhuma rota
  da API grava mensagem sem passar pela captura e o contrato não escreve no Redis, então essa leitura fica com os
  testes do backend.

- **Decisões do Anzol** (M1 e T1–T4, "siga as recomendações" do dono em 2026-09-27; desenho em
  `.docs-arquivo/decisoes-anzol/api.md`). Escritos antes do backend.
  - *Busca pelo motivo exato* (`busca-motivo.spec.ts`, M1): `signature_reason` e `schema_path` no topo da busca, fora
    de `match`.
    - `signature_reason` é o `reason` inválido sem o parêntese final (`timestamp outside tolerance` acha as de 412 s e as
      de 900 s; com o parêntese no valor, também). Também cobre `signature mismatch`, `malformed header`, `header
      Stripe-Signature absent` e `header X-Hub-Signature-256 absent`. É exato: trecho, outra caixa ou espaço dobrado não
      acham. URL sem assinatura não acha nada.
    - `schema_path` é JSON Pointer exato: `/id`, `/status`, `""` para a raiz, `/itens/1/qtd`, `/a~1b` e `/m~0n`. Prefixo
      ou outra grafia não acham; URL sem schema não acha nada.
    - Os dois combinam em E entre si e com `text`, `match` e `outcome`, com paginação sobre o filtrado. `null` vale como
      ausente e sem os campos a busca é igual à listagem. O `count` de cada `reasons[]` e `paths[]` do `/stats` é o
      `total` da busca.
    - 422 em `signature_reason` (número, booleano, lista, objeto, vazio, 201 caracteres) e em `schema_path` (tipo
      errado, `id`, `$.valor`, `$`, `/a~2`, `/a~`, 1001 caracteres). São aceitos `""`, `/`, `/a~0b~1c` e 999
      caracteres.
  - *ReDoS* (`redos.spec.ts`, T1): `((a+)*)+$` contra `a`×30 + `!` e `(.*a){12}` contra `a`×40 + `!`. O `(a+)+$`
    clássico não serve, porque o JDK 25 o resolve em milissegundos.
    - Salvar a regra e o schema é aceito como hoje.
    - Webhook, `rules/test` sobre 10 mensagens, trace, busca sobre 10 mensagens e wait-for com `timeout: 0` respondem em
      menos de 5 s, medidos no cliente.
    - A condição conta como não casou: a regra seguinte responde, ou a resposta padrão. A frase `<alvo>: … timed out`
      vem na chave de sempre (`match.query.q`, `match.headers.X-A`, `match.body.0`, `path`, `query q`).
    - Na busca, a mensagem que casa sem estourar continua achada.
    - `pattern` de schema que estoura grava `valid: false` com o erro em `/nome` e `timed out`; o mesmo `pattern` com
      valor comum valida.
  - *UUID em outras codificações no link* (`privacidade-share-codificacoes.spec.ts`, T2): corpo, cabeçalho e query com
    o UUID da URL em escape JSON (`-`), sem hífens em qualquer caixa e em base64/base64url. O base64 cobre
    minúsculas, maiúsculas, com e sem hífens, nos 3 alinhamentos e dentro de um JWT. Nenhuma forma sai no link, com e
    sem `redact`, e o resto do corpo fica. Outro UUID nas mesmas formas fica byte a byte.
  - *CSP nos erros da captura* (`privacidade-captura-sandbox-erros.spec.ts`, T3): saem com o CSP sandbox, sem
    `allow-same-origin`:
    - 410 de URL inexistente em seis métodos, cliente comum e JSON, com e sem caminho;
    - 410 de URL apagada;
    - 413 de corpo acima de 1 MiB;
    - 400 de cabeçalho acima de 8 KB;
    - 500 do template acima dos tetos.
  - *Mesmo segundo* (`wait-for-mesmo-segundo.spec.ts`, T4): **guarda de regressão, verde hoje**. Rajada de 150 com
    `seq` único e crescente dentro do mesmo `created_at`. A listagem `after` no meio de um segundo traz exatamente as
    seguintes. O wait-for com `count` 100 e depois 50, atravessando o lote de 100, não pula nem repete, e o mesmo vale
    com `after` no meio de um segundo.

  Leituras assumidas e o que fica fora estão no `api.md`. Fora do contrato:
  - o 507, que exige o Redis no `maxmemory`;
  - o valor exato do teto de custo da regex;
  - a ferramenta MCP `search_requests` com os campos novos;
  - codificações encadeadas do UUID (`%252d`, base64 de base64);
  - o `seq` repetido das mensagens gravadas antes do índice (app Laravel), que é o defeito real do T4: `legacyScore`
    dá o mesmo score a mensagens do mesmo segundo. Não se semeia pela API e fica com o teste do backend, com o Redis em
    container.

- **Patamar, fatia D1: defeitos de servidor** (DX-01, DX-02, DX-14, DX-28, DX-29; aprovados pelo dono em 2026-09-28;
  desenho em `.docs-arquivo/patamar/api-defeitos.md`). Escritos antes do backend.
  - *JSON quebrado* (`token-json.spec.ts`, DX-02): com `Content-Type` JSON (`application/json`, com `charset` e
    `+json`), o corpo com bytes que não é um objeto JSON → 400 no envelope de erro (`success: false`, `error.id: null`,
    `error.message` citando `JSON`), com e sem `Accept`. Dez corpos: truncado, chave sem aspas, lixo depois do objeto,
    texto solto, lista, lista de objetos, texto JSON, número, booleano e `null`. No `POST /token` nada é criado; no
    `PUT /token/{id}` a URL fica igual (o `GET` antes e depois de cada um), e uma captura assinada confere que status,
    corpo, `Retry-After`, segredo e schema continuam valendo. Guardas: corpo vazio, `{}`, pedido sem `Content-Type` e
    `text/plain` com JSON truncado criam com os padrões; `PUT` vazio e `PUT {}` voltam aos padrões.
  - *JSON quebrado no link e no unlock* (`json-quebrado-rotas.spec.ts`, complemento do DX-02): os mesmos dez corpos
    em `POST /token/{id}/request/{rid}/share` e em `POST /token/{id}/unlock` → 400 com **a mesma resposta** que o
    `POST /token` dá para o mesmo corpo (comparada com ele, sem fixar o texto), também com `charset`, `+json` e
    `Accept: */*`. No link: nenhum link criado (a lista continua vazia), numa URL aberta e numa protegida com o
    segredo; sem o segredo, o 401 de sempre. No unlock: nenhum cookie, o segredo certo dentro de um JSON truncado não
    desbloqueia nem volta na resposta, a URL aberta também dá 400, e 12 corpos quebrados não gastam as 10 tentativas
    (o segredo certo desbloqueia depois). Guardas: no link, sem corpo, corpo vazio e `{}` criam com os padrões
    (`redact` true, 7 dias) e `expires_in` inválido dá 422; no unlock, sem corpo, `{}`, outro campo e `secret` `null`,
    vazio ou número dão 422 em `secret`, o segredo errado 401, o certo 204, e o formulário continua desbloqueando.
  - *422 no lugar do 302* (`token-json.spec.ts`, DX-01): pedido com `Content-Type` JSON, sem `Accept` e com `Accept:
    */*`, recebe exatamente o 422 de sempre em `POST /token`, `PUT /token/{id}` (a URL não muda) e `GET
    /token/{id}/requests?after=abc`. Os pedidos vão por HTTP cru, porque o `fetch` e o Playwright mandam `Accept` por
    conta própria. Guardas: formulário inválido sem `Accept` → 302 para a raiz ou para o `Referer`; `PUT` por
    formulário, query string e `GET …/requests` sem `Content-Type` → 302; formulário com `Accept` JSON ou
    `X-Requested-With` → 422.
  - *`update_url` do MCP* (`ia-mcp-update.spec.ts`, DX-28): campo ausente fica como está. Com um campo só
    (`default_status`, `default_content`, `default_content_type`, `timeout`, `retry_after`, `auto_cleanup`), e sem
    campo nenhum, a URL é a de antes mais o campo enviado, e uma captura assinada confere a assinatura e o schema.
    `schema` sozinho troca o schema; bloco `signature` sem `secret` troca o provedor e mantém o segredo; com `secret`,
    troca. `null` explícito desliga `signature` e `schema` e volta cada um dos outros ao padrão, só ele. Valor inválido
    é erro de ferramenta com a mensagem da API e nada muda. A descrição cita `null` e não diz mais `go back to their
    defaults`. O `PUT` da REST não muda.
  - *Revisão de segurança da D1* (`seguranca-d1.spec.ts`):
    - **Máscara gravada como segredo.** No `PUT /token/{id}` e no `update_url`, `signature.secret` que começa com
      `••••` e não é a máscara do segredo atual → 422 só com a chave `signature.secret` (no MCP, erro de ferramenta que
      a cita), sem o segredo na resposta, e a URL fica igual. Cinco textos: a máscara de outra URL, a máscara sozinha,
      com outros 4 caracteres, a certa com algo a mais e a máscara seguida de um segredo inteiro. Também o bloco
      inteiro copiado do `GET` (ou do `get_url`) de outra URL, e a URL sem assinatura. Uma captura confere que o
      segredo de antes continua valendo e que o texto mascarado não virou segredo. Guardas: a máscara do segredo
      atual mantém o segredo, e o segredo novo com `•` no meio é aceito.
    - **Máscara na criação.** No `POST /token` e no `create_url` não há segredo atual: `signature.secret` que começa
      com `••••` (a máscara de um segredo, a máscara sozinha, a máscara seguida de um segredo inteiro e o bloco copiado
      de outra URL) → 422 só com a chave `signature.secret` (no MCP, erro de ferramenta que a cita), e a URL não é
      criada: a resposta não traz `uuid`. Guarda: o segredo novo com `•` no meio cria a URL e confere.
    - **`create_url` com `null`.** `default_status`, `default_content`, `default_content_type` e `timeout` com `null`,
      um a um e os quatro juntos ao lado de `retry_after: 9`: a URL nasce com os padrões. Valor inválido continua erro
      de ferramenta.
    - **`update_url` com texto vazio.** `signature: ""` e `schema: ""` → erro que cita o campo, e nada muda (nem o
      `timeout` enviado junto); `null` desliga aquele e o outro fica.
    - **`update_url` simultâneo.** 20 rodadas, cada uma numa URL nova: uma chamada liga a assinatura e outra muda o
      `timeout`, ao mesmo tempo. As duas respondem sucesso e, no fim, assinatura, `timeout` e o `default_status` de
      antes estão gravados.
  - *Cursor do wait-for* (`wait-for-cursor.spec.ts`, DX-14): **guarda, verde hoje**. O cursor é o `seq` de
    `GET …/requests?sorting=newest&per_page=1` (lista vazia = 0); a espera com `after: <cursor>` acha o disparo que
    chegou antes de ela começar e não a mensagem antiga; o cursor lido antes de a mais nova ser apagada continua
    valendo. O comando `anzol cursor` está em `tests/cli`.
  - *Suggest com `check`* (`ia-suggest-check.spec.ts`, DX-29 e UX-41): a resposta 200 tem exatamente `{rule,
    explanation, attempts, check}` e `check` exatamente `{example, recent, warnings}`. O LLM falso devolve as regras
    erradas do estudo. `example` é `null` sem `request_id`; com ele, `{matches, failed, conditions}` iguais aos do
    `rules/test`. `recent` é `{evaluated, matched}`. Avisos `{code, message}`: `example_not_matched`;
    `template_disabled` (`{{` no corpo ou num cabeçalho com `template` falso ou ausente; com `template: true` e com
    chaves de JSON, não); `path_never_seen` (`equals`, `prefix`, `regex` e outra caixa; não quando o caminho existe e
    outra condição falha, nem numa URL vazia); `sequence_as_single_rule` (os dois pedidos de exemplo, pt e en; não com
    `scenario` na regra, nem em pedido comum). Os quatro somados. `explanation` é o texto do modelo e `attempts` 1, com
    um pedido só ao LLM mesmo com avisos; regras, cenário e mensagens não mudam. O 422 sem regra válida vem sem `check`.

  Leituras assumidas: JSON válido que não é objeto dá o mesmo 400 do JSON que não se lê; o envelope do 400 é o dos
  outros erros da API e o texto da mensagem é livre, desde que cite `JSON`; `null` no `update_url` vale para todo campo
  de configuração; a conferência do suggest não devolve os `failed` ao modelo; a forma de sequência é fixada pelos
  exemplos, não pelo detector; o corpo quebrado no unlock não conta como segredo errado (decisão do orquestrador). **Fora do contrato:** `signature: ""` e `schema: ""` no `PUT` da REST; `PUT` simultâneos na REST; corpo só com espaços; a ordem entre o 400 e o 410 ou 401;
  `Content-Type` JSON com `Accept: text/html`; as rotas que leem o corpo cru (regras, cenários, busca, espera, envio,
  reenvio, IA), que já recusavam com o 422 delas; ferramenta `patch_url`; o suggest
  devolver várias regras; o `explain` que chama de rejeição uma resposta 2xx (DX-30).

### Contrato do SSE

`GET {BASE_URL}/token/{id}/stream` responde 200 com `Content-Type: text/event-stream` e, a cada
mensagem gravada, um evento `event: request.created` cujo `data:` é o JSON
`{request, total, truncated, removed}` (o `data` que o app Laravel publicava no Redis, sem o
envelope `event`/`socket`, mais o `removed` da limpeza automática). Reduzir o limite pelo `PUT`
corta sem evento: quem editou recarrega a lista. O adaptador considera a assinatura pronta quando recebe o status e
os cabeçalhos: o servidor só deve enviá-los depois de registrar o assinante, senão um webhook
disparado logo em seguida se perde. Comentários (`:`) servem de keep-alive e são ignorados.

## Mudanças de comportamento decididas pelo dono

Plano de features "limpeza automática e Retry-After" (2026-09-26). O contrato mudou antes do código;
os testes abaixo falhavam no app da época (antes das mudanças) e são o juiz da implementação.

| Antes | Agora | Por quê |
|---|---|---|
| 500 mensagens por URL; a 501ª recebia 410 `Too many requests, please create a new URL/token` e não era gravada (`limite.spec.ts`, removido) | Nunca 410 por volume: janela FIFO de `auto_cleanup ?? ANZOL_MAX_REQUESTS` (padrão 10000) | Queixa dos usuários: ao chegar em 500 a URL parava de receber. Decisões D1 (FIFO) e D2 (teto global) do plano |
| Token sem `retry_after` e `auto_cleanup` | Campos novos, `null` por padrão, no JSON do token | Retry-After configurável por URL (requisito essencial do dono) e limpeza escolhida na tela |
| Evento `{request, total, truncated}` | `{request, total, truncated, removed}` | A aba aberta tira da lista o que o servidor cortou |
| Ordem indefinida entre mensagens do mesmo segundo | Ordem de chegada | Índice ordenado da listagem (item 02); a exclusão correspondente saiu |
| Listagem lendo a URL inteira a cada página | Página em até 2 s com 10.000 × 15 KB | O fim do 410 levaria a opção 10000 ao 500 medido no app Laravel |
| Mensagem sem número de ordem; listagem só por página | `seq` na mensagem (listagem, `GET`, evento) e `after=<seq>` na listagem | Correção da refutação do CLI (2026-09-26): o evento SSE sai fora da ordem de gravação sob concorrência e a paginação por página desloca quando alguém apaga; o CLI reenvia por `after` sem perder nem duplicar. A chave `seq` entrou em `CHAVES_MENSAGEM`, então os testes de forma de `mensagem.spec.ts` também a exigem |
| Toda URL responde o padrão do token; mensagem sem registro de regra | Regras de resposta por URL (`/token/{id}/rules`, `rules/test`) e `rule`/`near_miss` em toda mensagem | Feature "regras de resposta" (fase A, 2026-09-26): testar de verdade quem envia webhooks. `rule` e `near_miss` entraram em `CHAVES_MENSAGEM`, então os dois testes de forma de `mensagem.spec.ts` também as exigem; URL sem regras responde exatamente como antes |
| `template: true`, `scenario`, `delay`, `dribble`, `fault` → 422 "not supported yet" (fase A) | Aceitos: templating, cenários com estado (`/token/{id}/scenarios`), atrasos, dribble e falhas de rede | Fase B da feature "regras de resposta" (Anexo B, 2026-09-26): simular retentativa, lentidão e rede ruim para quem envia webhooks |
| Token e mensagem sem informação de assinatura | `signature` no token (configuração, segredo mascarado) e na mensagem (`{provider, valid, reason}` ou `null`); condição de regra `match.signature` | Feature "verificação de assinatura HMAC" (2026-09-26): dizer se a assinatura do provedor confere e por que não. `signature` entrou em `CHAVES_TOKEN` e `CHAVES_MENSAGEM`; URL sem configuração responde e grava como antes, com `signature: null` |
| Esperar uma requisição exigia polling da listagem | `POST /token/{id}/requests/wait` (long-poll com o `match` das regras, `count`, `after`, `timeout` e `near_miss`) | Feature "wait-for" (2026-09-26): teste automatizado afirma "chegou N vezes uma requisição assim em até T" sem `sleep` e sabe por que não chegou. Rota nova; nada do que existia muda |
| Token e mensagem sem validação do corpo | `schema` no token (JSON Schema ou `null`) e na mensagem (`{valid, errors}` ou `null`); condição `match.schema` nas regras e no `wait-for` | Feature "validação de schema por URL" (2026-09-26): saber de imediato se o payload segue o contrato e responder erro quando não segue. `schema` entrou em `CHAVES_TOKEN` e `CHAVES_MENSAGEM`; URL sem schema responde e grava como antes, com `schema: null` |
| Achar uma mensagem exigia rolar a listagem | `POST /token/{id}/requests/search` (texto sem diferenciar maiúsculas + `match` das regras, paginado como a listagem) | Feature "busca, filtro e diff" (2026-09-26): achar a mensagem que interessa entre milhares. Rota nova; nada do que existia muda |
| Reenviar uma mensagem ou montar uma requisição só pelo CLI, do host | `POST /token/{id}/request/{rid}/replay`, `POST /token/{id}/send` e `GET /token/{id}/outbound` (o servidor sai, com proteções contra SSRF, 30 disparos por minuto e histórico das últimas 50) | Feature "reenvio pelo servidor e envio pela tela" (2026-09-26): reenviar da tela para o app do dono e ver a resposta. Rotas novas; nada do que existia muda |
| Nenhuma IA nem MCP | Servidor MCP em `/mcp`, `POST /token/{id}/rules/suggest` e `POST /token/{id}/request/{rid}/explain`, com o LLM local do dono (desligados por padrão) | Feature "IA local" (item 13, 2026-09-26): agentes operam o Anzol por MCP, regra a partir de linguagem natural e diagnóstico da mensagem, sem o payload sair da máquina. Rotas novas; nada do que existia muda |
| Quem tem o UUID lê e gere a URL; token sem `protected`; qualquer `Host` e `Origin` na API | `read_secret` opcional por URL: sem acesso, toda rota `/token/{id}/**` (fora `unlock`/`lock`) dá 401 `{"error":"This URL is protected","protected":true}`; `protected` no token; links só-leitura de uma mensagem (`/share/{sid}`); com `anzol.allowed-hosts` definido, `Host` fora da lista → 403 nas rotas de gestão e `Origin` fora da lista → 403 nos métodos que mudam estado | Item 12, "privacidade e segurança" (2026-09-26): pré-requisito para publicar. URL sem `read_secret` responde como antes. `protected` entrou em `CHAVES_TOKEN` (e no tipo `Token`), então os quatro testes que comparam as chaves do token passam a exigi-lo: `token.spec.ts` "sem campos: 201 com os padrões e exatamente as chaves do token", `schema-config.spec.ts` "POST com schema: 201 devolve o schema como enviado, e o GET também" e os dois de `assinatura-config.spec.ts` ("POST com signature: GET devolve o provedor e o segredo mascarado…" e "token com signature null; mensagem com signature null…"). Nenhum outro teste antigo mudou: nenhum manda `Host` fora da lista a uma rota de gestão nem `Origin` a um método de gestão (os `Host` e `Origin` estranhos dos testes antigos vão para a captura) |
| Link só-leitura com a mensagem inteira (`token_id` e a `url` com o UUID da URL); `redact` mascarava só a lista fixa de headers; trocar o segredo mantinha os links | Link sem `token_id` e com `[redacted]` no lugar do UUID da `url`, com ou sem `redact`; `redact` também mascara headers de nome com `token`, `key`, `secret`, `password` ou `auth`; definir, trocar ou remover o segredo revoga todos os links da URL | Correções da refutação do item 12 (fatia 05, decisões do dono, 2026-09-26): o link entregava o UUID da URL (quem o tem enviava à URL e, numa URL aberta, lia tudo), credenciais em header próprio escapavam da máscara e trocar o segredo não cortava quem tinha link. Mudou só `privacidade-share.spec.ts`: "numa URL protegida: cria com os padrões…", o teste de forma da máscara (`x-auth-token` e `x-api-keys` passaram de comuns a mascarados; entraram `x-client-secret`, `x-db-password`, `x-authenticated-user`, `x-monkey` e o comum `x-tok`) e "redact false…" passaram a comparar com a mensagem sem o UUID da URL; o `lerLinkOk` local exige as chaves da mensagem menos `token_id`; dois testes novos (o link não entrega a URL; trocar o segredo revoga) |
| Resposta da captura sem `Content-Security-Policy` | Toda resposta da captura (padrão da URL, regra, `malformed_chunk`) com `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals`, acrescentado depois dos cabeçalhos da regra (um CSP da regra se soma, não o tira) | Reauditoria do item 12 (decisão N2 do dono, 2026-09-26): a captura serve pelo mesmo endereço da tela, e um HTML com script respondido por uma URL rodava na origem da tela (lia o `localStorage` e chamava a API com o cookie). Teste novo: `privacidade-captura-sandbox.spec.ts`. Nenhum teste antigo mudou: nenhum trava o conjunto de cabeçalhos da captura (os de CORS usam `toMatchObject`, que aceita cabeçalhos a mais; o de `malformed_chunk` só confere a forma de cada linha). Na mesma rodada, sem teste de contrato novo (cobertos pelos testes do backend): o link público troca o UUID da URL no JSON inteiro (cabeçalhos, query, `request`, corpo), também com maiúsculas e `%hh`; o link guarda a `secret_version` e só abre com a atual; corpo de formulário sem `Origin` e com o cookie `anzol_access` → 403 `form not allowed`; `redact` também mascara headers de nome com `session`, `credential`, `jwt`, `bearer`, `passwd` ou `pwd` (nenhum teste de contrato tinha header com esses nomes) |
| Mensagem sem o que foi respondido; regras sem trace, sem prévia da resposta nem diferença antes de gravar; busca sem filtro por desfecho | `response` (`{status}` ou `{fault}`) em toda mensagem nova; `GET …/request/{rid}/rules/trace`; `outcome` na busca; `render=1..3` no `rules/test`; helper `hmac` com o segredo da URL; ferramenta MCP `diff_rules` e `anzol rules push --dry-run` | UX de Regras (C1–C5 e E-07, decisão do dono de 2026-09-27): explicar cada resposta e avisar o erro antes dele acontecer. Tudo aditivo, menos a chave `response`, que entrou em `CHAVES_MENSAGEM` (mudaram só os testes de forma que já comparavam as chaves: `mensagem.spec.ts`, `assinatura-config.spec.ts` e `privacidade-share.spec.ts`, pela constante). Sem o campo novo pedido, toda resposta é a de antes |
| JSON quebrado ou JSON que não é objeto no `POST /token` criava a URL com os padrões (201), no `PUT /token/{id}` voltava a URL inteira aos padrões (200), no `POST …/share` criava o link com os padrões (201) e no `unlock` era lido como pedido sem `secret` (422); a validação de pedido JSON sem `Accept` respondia 302; `update_url` do MCP com um campo apagava os outros; `rules/suggest` devolvia `{rule, explanation, attempts}` | 400 no envelope de erro, sem criar nem alterar; 422 em JSON para pedido com `Content-Type` JSON; no `update_url`, campo ausente fica e `null` desliga; `check` no suggest | Patamar, fatia D1 (defeitos graves, decisão do dono de 2026-09-28): o `PUT` com JSON truncado perdia a configuração sem erro; o 302 escondia o erro de quem integra por script; o agente desligava assinatura e schema sem saber; 3 de 4 sugestões do estudo eram válidas na forma e erradas no sentido. Nenhum teste antigo mudou: nenhum mandava JSON quebrado nem pedido JSON sem `Accept`, e os do suggest não travam o conjunto de chaves. A exclusão "Validação para cliente não JSON" foi reescrita: o pedido JSON saiu dela |

## Defeitos do legado (`bugDoLegado`)

Comportamentos claramente acidentais do app Laravel. Com `CONTRATO_ALVO=novo` (padrão) o teste
exige o comportamento correto, que o app atual implementa. Com `CONTRATO_ALVO=legado` o teste é
marcado `test.fail`: descreve o comportamento correto e falhava no app Laravel, o que contava
como sucesso.

| Teste | App Laravel | Causa |
|---|---|---|
| `/{token}/12345` usa o status padrão | 500 (mensagem já gravada) | `preg_match('/[1-5][0-9][0-9]/')` sem âncora casa dentro de `12345` e o segmento inteiro vira status |
| `default_status` 999 não derruba o webhook | 500 (a criação aceita 999, 0, 42…) | Validação só exige inteiro; o Symfony rejeita o status ao responder |
| Corpo binário (UTF-8 inválido) é aceito | 500; grava `""` na hash: a mensagem conta no `total` e some da listagem | `json_encode` falha com UTF-8 inválido |
| Segunda chamada ao toggle de CORS desliga | Sempre `{enabled: true}`; nada desliga o CORS | `isset()` em atributo mágico da `Entity` (sem `__isset`) é sempre falso |
| Evento com `truncated: true` vem sem `content`, `headers` e `user_agent` | Marca `truncated` mas manda o corpo inteiro | `unset()` em atributo mágico (sem `__unset`) não faz nada |

## Limites do Tomcat (`limiteDoTomcat`)

Entradas que o app Laravel aceitava e gravava e que o Tomcat 11 do app novo recusa com 400 antes de
chegar a qualquer ponto de extensão. Com `CONTRATO_ALVO=novo` o teste fica marcado `test.fail`:
documenta a divergência e avisa (passando "inesperadamente") se um dia o servidor passar a aceitar.
Decisão de 2026-09-26: aceitar a divergência — contorná-la exigiria trocar de servidor, e as duas
requisições são inválidas pelo RFC 9112 (§3.2: o alvo não carrega fragmento; §3.2.2: em
absolute-form o servidor deve usar o host do alvo, não o cabeçalho `Host`).

| Teste | App Laravel | Por que o Tomcat recusa |
|---|---|---|
| `#` cru no caminho | 200; o fragmento some da `url` | `Http11InputBuffer` recusa antes de qualquer extensão; `#` fica fora de `relaxed-*-chars` |
| absolute-form com outro host (`GET http://outro.host:1234/{token}`) | 200; `hostname` e `url` vêm do cabeçalho `Host` | `Http11Processor.prepareRequest` chama `badRequest("inconsistentHosts")` sem configuração possível |

`Host` com underscore, `\`, `%` solto e `%FF` no caminho eram recusados pelo Tomcat e passaram a
ser aceitos pelo backend (commit `d5234e8`); hoje são testes comuns.

## Exclusões propositais

- **`Expect: 100-continue` antes de uma falha de rede** (refutação da fase B): o Tomcat responde `HTTP/1.1 100`
  ao começar a ler o corpo, antes de a regra decidir; com `empty_response`, `connection_reset` e
  `random_data_then_close`, esse `100` chega antes da falha. É o comportamento do protocolo; os testes de falha
  enviam sem `Expect`.
- **Ordem das mensagens é a de chegada** (refutação do índice ordenado, 2026-09-26): coincide com
  `created_at` enquanto o relógio do servidor não volta. Mensagem gravada com `created_at` no futuro
  (dado migrado de servidor adiantado) ou relógio que volta (ajuste de NTP) faz a ordem divergir da
  ordenação por `created_at` do app antigo, e o corte FIFO segue a ordem de chegada.
- **Reduzir o limite no `PUT` não emite evento SSE**: a aba que editou recarrega a lista; outras
  abas abertas na mesma URL só se atualizam ao recarregar.
- **`Host` fora do padrão que o nginx recusa ou lê diferente** (reverificação de 2026-09-26, N2):
  `::1` sem colchetes (nginx 400; o app novo grava), `example.com:` (porta vazia) e porta negativa
  (`-1` no legado, `0` no novo). Nenhum cliente real manda esses valores.
- **Bytes UTF-8 crus no caminho** (`/{token}/é` sem percent-encoding, N3): o legado dá 500 com
  mensagem fantasma e o novo dá 400 do Tomcat; os dois recusam.
- **`content` de multipart que o PHP abandona no meio** (parte sem `name` e sem `filename`,
  "Mime headers garbled"): os campos em `request` saem iguais; o `content` difere porque o legado
  grava `""` quando o PHP já tinha lido ~8 KB do corpo (`php://input` só relê o resto abaixo disso)
  e o app novo grava o que sobrou. Artefato do buffer interno do PHP, sem perda de dado no novo.
- **Perto do teto de 32 KB de cabeçalhos** (N4): ~31,5 KB dá 400 no nginx e 200 no novo; `TRACE`
  sai com o envelope do app em vez da página 405 do nginx.

- **Corpo HTML do 302 da validação para cliente que não manda JSON** (formulário ou query string,
  sem `Accept: application/json` e sem `X-Requested-With`): o Laravel devolvia 302 para a página
  anterior com os erros na sessão. O status e o `Location` passaram a ser fixados como guarda em
  `token-json.spec.ts`; a página do corpo fica fora. O pedido com `Content-Type` JSON saiu desta
  exclusão: recebe 422 (ver "Mudanças de comportamento decididas pelo dono").
- **Corpo HTML das páginas de erro**, e os campos de depuração do envelope JSON (`exception`,
  `trace`, `file`, `line`, presentes porque o app roda com `APP_DEBUG=true`).
- **Status 1xx pelo caminho** (`/{token}/100`, `/{token}/199`): o app responde uma resposta
  final 1xx, que não é HTTP/1.1 válido; clientes ficam esperando a resposta de verdade.
- **Requisição sem `Host`** (HTTP/1.0): `hostname` e `url` saem com o `server_name` do nginx
  (`application`), detalhe de infraestrutura.
- **`page`/`per_page` zero, negativos ou não numéricos**: resultado degenerado do
  `Collection::forPage` (ex.: `per_page=-1` devolve todas menos a última). Nenhum cliente manda.
- **Expiração de 7 dias** (`ANZOL_EXPIRY`): não observável no tempo de um teste.
- **`GET /token/{id}/request/latest`**: existe no `master` upstream mas não no app que roda
  hoje (lá responde 404). Fica fora até alguém decidir se entra.
- **Valor exato de `ip`** (depende da rede do Docker; o contrato exige string não vazia e que
  `X-Forwarded-For` não o altere), **ordem de chaves e de cabeçalhos**, escape de `/` no JSON
  (a comparação é semântica) e cabeçalhos de servidor (`Server`, `X-Powered-By`,
  `Cache-Control`).

Casos levantados pela refutação adversária que ficam fora:

- **Redis pub/sub do tempo real**: o SSE substituiu o laravel-echo-server; o app novo não publica
  mais no Redis.
- **`.php` e `.ht` no caminho**: o app Laravel responde 404/403 do PHP-FPM/nginx sem gravar; o app
  novo grava como qualquer caminho, o que é melhor.
- **UTF-8 inválido fora do corpo** (query, cabeçalho, campo multipart, `default_content`): gravado
  com U+FFFD, extensão do defeito do corpo binário já corrigido.
- **Limites do PHP** `max_input_vars` (1000) e aninhamento de arrays (64): não são emulados.
- **Cabeçalhos que o nginx descarta ou mistura**: `Proxy`, nomes com `.` ou `~`, colisão
  `X_Foo`/`X-Foo`, tab no fim do valor.
- **`X-HTTP-Method-Override: HEAD` em POST**: artefato do Symfony; nenhum cliente depende.
- **Cabeçalhos `Allow` e `Accept-Patch` em OPTIONS**: detalhe do servidor, fora da resposta
  configurada no token.
- **Normalizações de Content-Type da resposta pelo Tomcat**: aspas do charset, caixa, espaços, 205
  sem corpo, CRLF saneado; a comparação já é pelo significado.
- **Entradas absurdas**: `page`/`per_page` gigantes, `default_content_type[]`, `Accept` com `q`
  inválido. `default_status` acima de 64 bits é a exceção: 422, como no app Laravel, e é testado.
- **Detalhes de protocolo**: `Expires`/`Pragma` em HTTP/1.0, CONNECT (405 no app Laravel, 501 no
  Tomcat), método em minúsculas.
