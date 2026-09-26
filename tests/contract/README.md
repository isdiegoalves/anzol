# Contrato de paridade caixa-preta

Testes Playwright (TypeScript) que falam HTTP com uma URL base e descrevem o comportamento
observável do webhook.site: a API de tokens e mensagens, o webhook e o evento
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
npx playwright test --project=api    # tokens, webhook, mensagens, listagem, busca, erros, limpeza, volume
npx playwright test --project=event  # evento request.created (SSE)

BASE_URL=http://localhost:8087 npx playwright test   # outra instância

npm run typecheck
```

| Variável | Padrão | Uso |
|---|---|---|
| `BASE_URL` | `http://localhost:8084` | App sob teste |
| `EVENT_ADAPTER` | `sse` | Transporte do evento; `sse` é o único (o adaptador `redis` do app Laravel saiu com ele) |
| `CONTRATO_ALVO` | `novo` | `novo` exige o comportamento corrigido nos defeitos do legado (abaixo); `legado` os marca `test.fail`, como quando o app Laravel era o alvo |
| `TETO_PADRAO` | `10000` | O `WEBHOOK_MAX_REQUESTS` com que o app sob teste foi iniciado (limite das URLs sem `auto_cleanup`). O contrato não descobre esse valor pela API: rodar contra um app com outro teto exige declarar aqui (ex.: app com `WEBHOOK_MAX_REQUESTS=50` e `TETO_PADRAO=50` deixa o teste do teto rápido) |

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
  (janela FIFO), com N = `auto_cleanup ?? WEBHOOK_MAX_REQUESTS` (`TETO_PADRAO`). Casos: 510
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
| 500 mensagens por URL; a 501ª recebia 410 `Too many requests, please create a new URL/token` e não era gravada (`limite.spec.ts`, removido) | Nunca 410 por volume: janela FIFO de `auto_cleanup ?? WEBHOOK_MAX_REQUESTS` (padrão 10000) | Queixa dos usuários: ao chegar em 500 a URL parava de receber. Decisões D1 (FIFO) e D2 (teto global) do plano |
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

- **Validação para cliente não JSON** (sem `Accept: application/json`, sem `X-Requested-With`):
  o Laravel devolve 302 para a home com os erros na sessão. É artefato do formulário web do
  Laravel; nenhum cliente da API depende disso. Note que corpo `application/json` sem `Accept`
  também cai no 302 (a validação olha `expectsJson`, não o Content-Type).
- **Corpo HTML das páginas de erro**, e os campos de depuração do envelope JSON (`exception`,
  `trace`, `file`, `line`, presentes porque o app roda com `APP_DEBUG=true`).
- **Status 1xx pelo caminho** (`/{token}/100`, `/{token}/199`): o app responde uma resposta
  final 1xx, que não é HTTP/1.1 válido; clientes ficam esperando a resposta de verdade.
- **Requisição sem `Host`** (HTTP/1.0): `hostname` e `url` saem com o `server_name` do nginx
  (`application`), detalhe de infraestrutura.
- **`page`/`per_page` zero, negativos ou não numéricos**: resultado degenerado do
  `Collection::forPage` (ex.: `per_page=-1` devolve todas menos a última). Nenhum cliente manda.
- **Expiração de 7 dias** (`WEBHOOK_EXPIRY`): não observável no tempo de um teste.
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
