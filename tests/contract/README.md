# Contrato de paridade caixa-preta

Testes Playwright (TypeScript) que falam HTTP com uma URL base e descrevem o comportamento
observável do webhook.site: a API de tokens e mensagens, o webhook e o evento
`request.created`. São verdes contra o app atual (Laravel 5.4, porta 8084) e servem de juiz
para a reescrita (Kotlin + Spring Boot no backend, Angular no front): o app novo tem de passar
neles sem que ninguém edite os testes.

Nenhum teste lê código ou chaves do Redis: tudo passa pela API. A única exceção é o adaptador
`redis` do evento, que assina o canal pub/sub do app atual porque é ali que ele publica.

## Como rodar

Pré-requisitos: Node 24+, o app no ar e, para o adaptador `redis`, Docker com o container do
Redis do app (`webhook-redis`).

```bash
cd tests/contract
npm ci

# API (tokens, webhook, mensagens, listagem, erros, limite)
BASE_URL=http://localhost:8084 npx playwright test --project=api

# Evento request.created
EVENT_ADAPTER=redis npx playwright test --project=event                        # app atual
BASE_URL=http://localhost:8085 EVENT_ADAPTER=sse npx playwright test --project=event  # app novo

npm run typecheck
```

| Variável | Padrão | Uso |
|---|---|---|
| `BASE_URL` | `http://localhost:8084` | App sob teste |
| `EVENT_ADAPTER` | `redis` | `redis` (app atual) ou `sse` (app novo) |
| `REDIS_CONTAINER` | `webhook-redis` | Container onde roda o `redis-cli SUBSCRIBE` do adaptador `redis` |
| `CONTRATO_ALVO` | `legado` | `legado` ou `novo`; só muda os casos de defeito do legado (abaixo) |

Cada teste cria os próprios tokens e, ao terminar, apaga as mensagens (`DELETE
/token/{id}/request`) e depois o token (`DELETE /token/{id}`). A ordem importa: no app atual o
DELETE do token não apaga a hash de mensagens.

## O que cobre

- **Token** (`specs/api/token.spec.ts`): criação sem campos e com todos (JSON, formulário e
  query string), coerção de números em string, campos ignorados (`uuid`, `cors`,
  desconhecidos), leitura, edição por `PUT` (campo ausente volta ao padrão; `cors`, `ip`,
  `user_agent`, `created_at` e `updated_at` ficam), exclusão (204 sem corpo e 410 em toda a API
  depois), validação 422 com as mensagens exatas, `PUT /token/{id}/cors/toggle`.
- **Webhook** (`specs/api/webhook.spec.ts`): GET, POST, PUT, PATCH, DELETE, OPTIONS e HEAD
  gravam e respondem com o padrão do token; `X-Request-Id` e `X-Token-Id`; Content-Type
  comparado pelo significado (tipo + parâmetros, sem caixa e sem depender de espaço), inclusive
  o `; charset=UTF-8` acrescentado a `text/*` e aos `charset_types` do nginx
  (`application/javascript`, `application/rss+xml`); Content-Type vazio some da resposta; 204
  sem corpo; `timeout` (a resposta e a gravação esperam); status pelo caminho (`/404`,
  `/404/extra`, `/500/`; `/600`, `/20` e caminhos livres usam o padrão); CORS desligado e
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
  `application/json`, senão `text/plain; charset=UTF-8`); apagar uma e todas.
- **Listagem** (`specs/api/listagem.spec.ts`): `data, total, per_page, current_page,
  is_last_page, from, to`, padrões (página 1, 50 por página, `oldest`), página além do fim
  (`from` > `to`), ordenação `oldest`/`newest` com mensagens espaçadas em mais de 1 s (no mesmo
  segundo a ordem é indefinida).
- **Erros** (`specs/api/erros.spec.ts`): para cliente JSON (`Accept: application/json`, o
  Accept do AngularJS, `X-Requested-With: XMLHttpRequest` ou corpo `application/json`), o
  envelope `{success: false, error: {message, id: null}}` com 410 `Token not found`, 404
  `Request not found`, 404 e 405 de rota com mensagem vazia; para cliente comum, só o status.
- **Limite** (`specs/api/limite.spec.ts`): 500 mensagens por URL; a 501ª recebe 410 `Too many
  requests, please create a new URL/token` e não é gravada; apagar uma abre vaga.
- **Evento** (`specs/event/request-created.spec.ts`): payload `{request, total, truncated}`;
  `request` igual à mensagem gravada; `total` é a contagem do token depois de gravar; o evento
  só vai para o canal do próprio token; `truncated` fica true quando o JSON da mensagem passa de
  1.000.000 caracteres **contados como o `json_encode` do PHP** (`/` vira `\/`, não-ASCII vira
  `\uXXXX`): 990.000 letras não cortam, 600.000 barras e 200.000 `ç` cortam.

### Contrato do SSE (app novo)

`GET {BASE_URL}/token/{id}/stream` responde 200 com `Content-Type: text/event-stream` e, a cada
mensagem gravada, um evento `event: request.created` cujo `data:` é o JSON
`{request, total, truncated}` (o mesmo `data` que o app atual publica no Redis, sem o
envelope `event`/`socket`). O adaptador considera a assinatura pronta quando recebe o status e
os cabeçalhos: o servidor só deve enviá-los depois de registrar o assinante, senão um webhook
disparado logo em seguida se perde. Comentários (`:`) servem de keep-alive e são ignorados.

## Defeitos do legado (`bugDoLegado` → `test.fail`)

Comportamentos claramente acidentais do app atual. Com `CONTRATO_ALVO=legado` (padrão) o
teste é marcado `test.fail`: descreve o comportamento correto e falha no app atual, o que conta
como sucesso. Com `CONTRATO_ALVO=novo` o mesmo teste exige o comportamento correto.

| Teste | App atual | Causa |
|---|---|---|
| `/{token}/12345` usa o status padrão | 500 (mensagem já gravada) | `preg_match('/[1-5][0-9][0-9]/')` sem âncora casa dentro de `12345` e o segmento inteiro vira status |
| `default_status` 999 não derruba o webhook | 500 (a criação aceita 999, 0, 42…) | Validação só exige inteiro; o Symfony rejeita o status ao responder |
| Corpo binário (UTF-8 inválido) é aceito | 500; grava `""` na hash: a mensagem conta no `total` e some da listagem | `json_encode` falha com UTF-8 inválido |
| Segunda chamada ao toggle de CORS desliga | Sempre `{enabled: true}`; nada desliga o CORS | `isset()` em atributo mágico da `Entity` (sem `__isset`) é sempre falso |
| Evento com `truncated: true` vem sem `content`, `headers` e `user_agent` | Marca `truncated` mas manda o corpo inteiro | `unset()` em atributo mágico (sem `__unset`) não faz nada |

## Exclusões propositais

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
- **Ordem entre mensagens do mesmo segundo**: indefinida no app atual (`created_at` tem
  resolução de segundo).
