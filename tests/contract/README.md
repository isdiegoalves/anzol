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
npx playwright test --project=api    # tokens, webhook, mensagens, listagem, erros, limpeza, volume
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
/token/{id}/request`) e depois o token (`DELETE /token/{id}`). A ordem importa: no app Laravel o
DELETE do token não apagava a hash de mensagens.

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
