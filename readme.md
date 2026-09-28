# Anzol

*anzol* é “fishhook” em português.

Gera uma URL única e aleatória que grava toda requisição HTTP recebida e a mostra na tela em
tempo real: método, cabeçalhos, query, corpo. Serve para testar e depurar webhooks e clientes
HTTP sem subir um servidor exposto à internet.

Mantido por [Diego Alves](https://github.com/isdiegoalves). Reescrito do zero, preservando o comportamento
da API e do webhook (licença MIT, ver [`LICENSE`](LICENSE)):

| Parte | Stack | Pasta |
|---|---|---|
| API, webhook e tempo real (SSE) | Kotlin 2.4 + Spring Boot 4.1 + Java 25 | `backend/` |
| Tela | Angular 22 + Angular Material | `frontend/` |
| Armazenamento | Redis 8.10 (tokens expiram em 7 dias) | serviço `redis` do compose |
| Contrato caixa-preta da API e do evento | Playwright | `tests/contract/` |
| CLI (`anzol listen`, `replay`, `rules`, `send`, `wait-for`, `cursor`) | Kotlin 2.4 + Clikt; roda em Java 21 ou mais novo (o build usa o JDK 25) | `cli/` |

Uma imagem só (`Dockerfile` da raiz): o Node constrói o Angular, o Gradle embute o build no jar
e o Spring Boot serve a API e a tela na mesma porta.

## Como subir

```bash
docker compose up -d --build
```

Abra <http://localhost:8084>. Os dados do Redis ficam no volume `anzol_redis-data` e
sobrevivem a `docker compose down` (só `docker compose down -v` os apaga).

### Configuração

| Variável (serviço `app`) | Padrão | O que faz |
|---|---|---|
| `WEBHOOK_MAX_REQUESTS` | `10000` | Mensagens guardadas por URL sem limpeza automática (`auto_cleanup` nulo). Ao passar, a mais antiga sai; a URL nunca para de receber. Com `auto_cleanup`, vale o limite da URL |
| `WEBHOOK_EXPIRY` | `604800` | Segundos até um token e suas mensagens expirarem (renovado a cada uso) |
| `WEBHOOK_OUTBOUND_ALLOW_PRIVATE` | `false` | Replay e send podem sair para loopback, redes privadas, CGNAT e ULA (ver [Reenvio e envio pelo servidor](#reenvio-e-envio-pelo-servidor)). O `docker-compose.yml` liga e por isso publica a porta só em `127.0.0.1` (`"127.0.0.1:8084:8080"`); **deixe `false` ao publicar** |
| `WEBHOOK_OUTBOUND_LOCALHOST_ALIAS` | vazio | Nome que substitui `localhost`/`127.0.0.1`/`::1` no alvo do replay e do send. O `docker-compose.yml` usa `host.docker.internal` (o Mac, onde roda o app do dono) |
| `WEBHOOK_MCP_ENABLED` | `false` | Servidor MCP em `/mcp` (ver [MCP](#mcp)). O `docker-compose.yml` liga |
| `WEBHOOK_AI_ENABLED`, `WEBHOOK_AI_*` | `false` | IA local: `rules/suggest` e `explain` com um LLM OpenAI-compatível (ver [IA local](#ia-local)). O `docker-compose.yml` liga, apontando para o oMLX do Mac |
| `WEBHOOK_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1],host.docker.internal` | Nomes aceitos no `Host` das rotas de gestão e do `/mcp`, contra DNS rebinding; o `Origin` dos métodos que mudam estado só passa na mesma porta do `Host` ou com `nome:porta` na lista, contra CSRF (ver [Proteção contra DNS rebinding/CSRF](#proteção-contra-dns-rebindingcsrf)). Vazio vale o padrão. `*` desliga a conferência da gestão: **inseguro** |

O Redis sobe com `--maxmemory 1gb --maxmemory-policy noeviction`: cheio, recusa gravação (o
webhook responde `507 Insufficient Storage`) em vez de apagar chaves, então nenhum token some e o que já está gravado
continua legível. Com mensagens de ~15 KB, 1 GB guarda cerca de 60 mil; `WEBHOOK_MAX_REQUESTS` e
`auto_cleanup` limitam cada URL. Mudar o `command` do Redis no compose recria o container, e os
dados ficam no volume.

### Observabilidade

O `docker-compose.yml` manda métricas, traces e logs por OTLP HTTP para um Grafana Alloy em
`host.docker.internal:4318` (`service.name=webhook-site`, `deployment.environment=local`). São as variáveis
`OTEL_*` do serviço `app`: sem elas (o padrão do app, os testes e o `./ci.sh`) nada é exportado, e com o Alloy
fora do ar o app segue normal. Métricas de negócio: `webhook_requests_captured_total` (por `method`,
`status_class`, `rule`, `signature`, `schema` e `fault`, nunca com token), `webhook_capture_duration_seconds`,
`webhook_storage_full_total`, `webhook_cleanup_removed_total`, `webhook_sse_subscribers`, `webhook_wait_active` e
`webhook_outbound_total` (replay e send, por `kind` e `outcome`: `2xx`…`5xx`, `blocked`, `error`; nunca com URL ou token),
`webhook_ai_calls_total` e `webhook_ai_duration_seconds` (IA local, por `kind` `suggest`/`explain`, `outcome`
`ok`/`invalid`/`error` e `model`; nada do prompt nem da mensagem). Cada chamada ao LLM vira também um span do Spring AI.
Cada captura vira um trace com o token em `span.webhook.token`, e os logs levam o `trace_id`. O dashboard e a
importação no Grafana estão em [`observability/`](observability/README.md).

## API

| Rota | O que faz |
|---|---|
| `POST /token` | Cria uma URL (`default_status`, `default_content`, `default_content_type`, `timeout` 0–10 s, `retry_after`, `auto_cleanup`, `signature`, `schema`, `read_secret`) |
| `GET`/`PUT`/`DELETE /token/{id}` | Lê, edita, apaga a URL (com as mensagens dela) |
| `PUT /token/{id}/cors/toggle` | Liga/desliga os cabeçalhos CORS na resposta do webhook |
| `ANY /{id}[/{status}][/...]` | O webhook: grava a requisição e responde com o padrão da URL |
| `GET /token/{id}/requests` | Lista as mensagens (`page`, `per_page`, `sorting=oldest\|newest`); com `after=<seq>`, as mensagens de `seq` maior, da mais antiga para a mais nova, até `per_page` |
| `GET`/`DELETE /token/{id}/request/{requestId}` | Lê ou apaga uma mensagem; `.../raw` devolve o corpo cru |
| `DELETE /token/{id}/request` | Apaga todas as mensagens |
| `GET /token/{id}/stream` | SSE: um evento `request.created` a cada mensagem gravada (`removed` lista as que a limpeza tirou) |
| `GET`/`PUT /token/{id}/rules` | Lê ou substitui a lista de regras de resposta da URL (o `PUT` é também o import) |
| `POST /token/{id}/rules/test` | Testa uma regra contra as 500 mensagens mais recentes |
| `POST /token/{id}/requests/search` | Busca nas mensagens por texto e pelo `match` das regras, paginada como a listagem (ver [Buscar mensagens](#buscar-mensagens)) |
| `POST /token/{id}/requests/wait` | Espera, com prazo, até chegarem mensagens que casam um `match` das regras (ver [Esperar por mensagens](#esperar-por-mensagens)) |
| `GET /token/{id}/stats` | Resumo das mensagens mais novas (`window`, padrão 500): métodos, assinatura, schema, regras e mensagens por hora (ver [Estatísticas da URL](#estatísticas-da-url)) |
| `GET`/`DELETE /token/{id}/scenarios` | Lista os cenários das regras com o estado atual, ou volta todos a `Started` |
| `PUT /token/{id}/scenarios/{name}` | Define à mão o estado de um cenário (`{"state": "..."}`) |
| `POST /token/{id}/request/{requestId}/replay` | O servidor reenvia a mensagem gravada para uma URL e devolve a resposta (ver [Reenvio e envio pelo servidor](#reenvio-e-envio-pelo-servidor)) |
| `POST /token/{id}/send` | O servidor envia uma requisição montada (método, headers, corpo), opcionalmente assinada com a `signature` da URL |
| `GET /token/{id}/outbound` | Histórico dos últimos 50 replays e sends da URL, o mais novo primeiro |
| `POST /token/{id}/rules/suggest` | Regra de resposta a partir de uma descrição em linguagem natural, validada e **não gravada** (ver [IA local](#ia-local)) |
| `POST /token/{id}/request/{requestId}/explain` | Explica em texto por que a assinatura, o schema e as regras deram o resultado que deram numa mensagem (ver [IA local](#ia-local)) |
| `POST /token/{id}/unlock`, `POST /token/{id}/lock` | Desbloqueia no navegador uma URL protegida pelo segredo de leitura (cookie) e bloqueia de novo (ver [Privacidade](#privacidade)) |
| `POST /token/{id}/request/{requestId}/share` | Link só-leitura de uma mensagem, com expiração e máscara dos valores sensíveis (ver [Links só-leitura](#links-só-leitura)) |
| `GET /token/{id}/shares`, `DELETE /token/{id}/shares/{sid}` | Lista os links ativos da URL; revoga um |
| `GET /share/{sid}` | O link público: a mensagem, sem credencial nenhuma |

Toda mensagem lida pela API (listagem, `GET` de uma e o `request` do evento) traz `seq`, inteiro
estritamente crescente por URL na ordem em que o servidor gravou e nunca reaproveitado, nem depois
de apagar a mais nova ou todas (o índice das mensagens; nas gravadas antes dele, o `created_at` em
microssegundos). `after=<seq>` percorre as mensagens a
partir de um ponto sem depender de `page` (que desloca quando algo é apagado) nem da ordem de
chegada dos eventos SSE (que pode trocar entre gravações simultâneas): ignora `page` e `sorting`,
`is_last_page` diz se há mais depois da última devolvida, e `after` que não é inteiro ≥ 0 dá 422.

`retry_after` (segundos, inteiro ≥ 0, ou data HTTP no formato `Sun, 06 Nov 1994 08:49:37 GMT`)
faz toda resposta do webhook da URL levar o cabeçalho `Retry-After`; útil com `/429`, `/503` ou 3xx.

`auto_cleanup` (500, 1000, 5000 ou 10000) é a limpeza automática: a URL guarda só as N mensagens
mais recentes e apaga a mais antiga a cada nova (também na hora, se o limite for reduzido). A URL
nunca para de receber.

### Verificação de assinatura

Com `signature`, a URL confere em cada mensagem se a assinatura HMAC que o provedor mandou bate com o segredo,
e diz por que não bate. A conta é feita na chegada, sobre os bytes do corpo exatamente como chegaram (antes
de qualquer decodificação: corpo com UTF-8 inválido, formulário e multipart também são verificados), e a
comparação é em tempo constante. A chave do HMAC são os bytes UTF-8 do segredo inteiro (o `whsec_…` da
Stripe inclusive).

| `provider` | Cabeçalho | O que é assinado |
|---|---|---|
| `stripe` | `Stripe-Signature: t=…,v1=…` (vale qualquer `v1`; os demais itens são ignorados) | HMAC-SHA256 em hex de `"{t}.{corpo}"`; `t` a até `toleranceSeconds` de agora (padrão 300) |
| `github` | `X-Hub-Signature-256: sha256=<hex>` | HMAC-SHA256 do corpo |
| `shopify` | `X-Shopify-Hmac-Sha256: <base64>` | HMAC-SHA256 do corpo |
| `slack` | `X-Slack-Signature: v0=<hex>` e `X-Slack-Request-Timestamp` | HMAC-SHA256 de `"v0:{timestamp}:{corpo}"`; timestamp a até `toleranceSeconds` de agora (padrão 300) |
| `generic` | `header` (obrigatório), com `prefix` opcional antes do valor | HMAC do corpo com `algorithm` `sha1`, `sha256` (padrão) ou `sha512`, em `encoding` `hex` (padrão) ou `base64` |

```json
{ "signature": { "provider": "generic", "secret": "meu-segredo", "header": "X-Signature",
  "algorithm": "sha256", "encoding": "hex", "prefix": "sha256=" } }
```

`secret` tem de 1 a 256 caracteres; `toleranceSeconds` (só `stripe` e `slack`) é inteiro de 1 a 86400;
campos que não se aplicam ao provedor são ignorados. O token devolve a configuração com os padrões
preenchidos e o segredo **mascarado**, `"••••"` e os 4 últimos caracteres (nunca mais que a metade do
segredo); o segredo inteiro fica só no Redis, e nunca vai para o log. No `PUT`, `secret` ausente, nulo, vazio
ou igual ao mascarado mantém o atual (a tela salva os outros campos sem apagá-lo); sem segredo atual, é 422
em `signature.secret`. `signature` ausente ou `null` desliga a verificação, como os demais campos do `PUT`.
Configuração inválida dá 422 com a chave em pontos (`{"signature.provider": ["The selected signature.provider is invalid."]}`).

Toda mensagem traz `signature`: `null` quando a URL não verifica, senão `{provider, valid, reason}`, com
`reason` `null` quando válida ou uma destas frases:

| `reason` | Quando |
|---|---|
| `header X-Hub-Signature-256 absent` | falta um cabeçalho que a verificação exige (no Slack, a assinatura ou o timestamp) |
| `malformed header` | o cabeçalho não está no formato do provedor (sem `t` ou `v1`, sem `sha256=`/`v0=`/`prefix`, hex ou base64 inválido) |
| `signature mismatch` | o HMAC não confere (segredo errado ou corpo alterado) |
| `timestamp outside tolerance (412 s)` | a assinatura confere, mas o timestamp está a mais de `toleranceSeconds` de agora, para trás ou para a frente |

Mensagens gravadas antes da verificação trazem `signature: null`.

### Validação de schema

Com `schema`, a URL valida o corpo de cada mensagem contra um [JSON Schema](https://json-schema.org/) e grava
o resultado. O campo vai no `POST /token` e no `PUT /token/{id}` como um objeto; o dialeto é o 2020-12, ou o
que o `$schema` do documento escolher entre draft-07 (`http://json-schema.org/draft-07/schema#`) e 2019-09
(`https://json-schema.org/draft/2019-09/schema`). O token devolve o documento como foi enviado.

```json
{ "schema": { "type": "object", "required": ["id"],
              "properties": { "id": { "type": "integer" }, "status": { "enum": ["pago", "pendente"] } } } }
```

`schema` ausente ou `null` desliga a validação, como os demais campos do `PUT`. Dá 422
`{"schema": ["The schema is invalid: <motivo>."]}` o schema que não é objeto, passa de 64 KB (JSON compacto),
tem `$schema` de outro dialeto, não segue o meta-schema do dialeto (`type` desconhecido, `required` que não é
lista, `pattern` que não compila…), tem `$ref` que não resolve ou que não é interno. Só vale referência ao
próprio documento (`#`, `#/$defs/…`): `$ref`, `$dynamicRef` e `$recursiveRef` com URL, caminho relativo,
`file:` ou `classpath:` são recusados, e nada é buscado na rede.

Toda mensagem traz `schema`: `null` quando a URL não valida, senão `{valid, errors}`, com até 20 erros (os
primeiros, na ordem da biblioteca) no formato `{"path": "<JSON Pointer na instância>", "message": "<texto>"}`:

```json
{ "valid": false, "errors": [ { "path": "/status", "message": "does not have a value in the enumeration [\"pago\", \"pendente\"]" },
                              { "path": "", "message": "required property 'id' not found" } ] }
```

O `path` é `""` na raiz; propriedade obrigatória ausente aponta para o objeto que devia tê-la. O corpo é JSON
pelo conteúdo, não pelo `Content-Type`: vazio ou que não é JSON (formulário, XML, JSON quebrado) dá
`valid: false` com o erro `{"path": "", "message": "body is not JSON"}`; um escalar JSON é validado como
qualquer valor. No 2020-12 e no 2019-09, `format` é só anotação; no draft-07 é verificado. Se a própria
validação falhar (por exemplo, `$ref` recursivo numa instância aninhada demais), a mensagem é gravada com
`valid: false` e o motivo, e a URL responde normalmente. O resultado é o do momento da captura: trocar o schema
não revalida o histórico. O evento `request.created` leva o mesmo `schema`. Mensagens e URLs gravadas antes da
validação trazem `schema: null`.

### Regras de resposta

Cada URL pode ter até 100 regras que escolhem a resposta do webhook pela requisição, como um mock
server (no estilo da WireMock). A primeira regra ativa que casa, pela menor `priority` e, no empate,
pela ordem na lista, responde com o `status`, os `headers` e o `body` dela; sem regra que case, a URL
responde como sempre (`default_*`, `timeout`, `retry_after`, status pelo caminho). Com regra, o
`timeout` e o `Retry-After` da URL não se aplicam; `X-Request-Id`, `X-Token-Id` e os cabeçalhos de CORS
(se ligados) continuam, e os `headers` da regra os sobrescrevem.

```json
{
  "name": "pagamento aprovado",
  "enabled": true,
  "priority": 5,
  "match": {
    "method": ["POST"],
    "path": { "equals": "/pagamentos" },
    "query": { "tipo": { "equals": "pix" } },
    "headers": { "X-Signature": { "present": true } },
    "body": [ { "jsonPath": { "path": "$.status", "equals": "pago" } }, { "contains": "pedido" } ]
  },
  "response": { "status": 201, "headers": { "Content-Type": "application/json" }, "body": "{\"ok\":true}" }
}
```

| Campo | Regra |
|---|---|
| `id` | UUID; gerado pelo servidor quando ausente |
| `name` | obrigatório, até 100 caracteres |
| `enabled`, `priority` | padrão `true` e `5`; `priority` inteiro ≥ 1, menor vence |
| `match.method` | lista; vazia ou ausente casa qualquer método (sem caixa) |
| `match.path` | um de `equals`, `prefix`, `regex`, sobre o caminho após o token, decodificado e sem a barra final (`/` quando vazio) |
| `match.query`, `match.headers` | nome → um de `equals`, `contains`, `regex` ou `present: true\|false`; nome de cabeçalho sem caixa. Valem os valores como gravados na mensagem (último repetido; `content-type` e `content-length` vazios contam como presentes) |
| `match.signature` | `valid`, `invalid` ou `absent` (falta o cabeçalho de assinatura; ver [Verificação de assinatura](#verificação-de-assinatura)). URL sem verificação não casa nenhum dos três. Ausente ou `null`: qualquer; o `GET` só mostra a chave quando há condição |
| `match.schema` | `valid` ou `invalid` (o resultado da [validação de schema](#validação-de-schema) gravado na mensagem). URL sem schema não casa nenhum dos dois. Ausente ou `null`: qualquer; o `GET` só mostra a chave quando há condição |
| `match.body` | lista de condições com um de `equals`, `contains`, `regex`, `jsonPath: {path, equals?}` (sem `equals`, basta existir) ou `equalToJson` (objeto, ou texto com o JSON; ignora ordem de chaves e compara números pelo valor) |
| `scenario` | `{name, requiredState?, newState?}` (ver [Cenários](#cenários)) |
| `response` | `status` 100–599 (padrão 200), `headers` texto → texto, `body` texto (padrão `""`), `template` booleano (padrão `false`), `delay`, `dribble` e `fault` (ver [Atrasos e falhas de rede](#atrasos-e-falhas-de-rede)) |

Todas as condições valem em E, e uma regra sem condições casa tudo. `regex` é a sintaxe do Java e
precisa casar o valor inteiro (`.` atravessa linhas). JSONPath segue a
[Jayway](https://github.com/json-path/JsonPath): `equals` aceita qualquer valor JSON, e texto casa
também número ou booleano de mesmo texto.

#### Template

Com `"template": true`, o `body` e os valores dos `headers` da resposta são templates
[Handlebars](https://github.com/jknack/handlebars.java), sem escape HTML:

```json
{ "name": "eco", "response": { "template": true,
  "headers": { "X-Pedido": "{{jsonPath request.body '$.id'}}" },
  "body": "{\"id\": \"{{jsonPath request.body '$.id'}}\", \"seq\": {{seq}}}" } }
```

| No template | Valor |
|---|---|
| `request.method`, `request.path`, `request.url` | método, caminho após o token (como no `match.path`) e a `url` gravada |
| `request.query.<nome>`, `request.headers.<nome>` | parâmetro da query e cabeçalho (nome em minúsculas; `request.headers.[content-type]` também vale) |
| `request.body`, `seq` | corpo cru e o `seq` da mensagem gravada |
| `{{request}}`, `{{request.query}}`, `{{request.headers}}` | mapa impresso inteiro sai como JSON (`{"x":"1"}`, na ordem de chegada), nunca no formato do Java |
| `{{jsonPath request.body '$.x'}}` | valor no corpo JSON; objeto ou lista saem como JSON. Só caminho simples (propriedade, índice, `*`, união e fatia): busca profunda (`..`), filtro (`[?(…)]`) e função (`.length()`) dão 422 ao salvar e, se o caminho vier da requisição, deixam o trecho vazio. A recusa olha `..`, `?` e `(` em qualquer lugar do caminho, inclusive dentro de chave entre aspas: `$['a(b)']`, `$['x?']` e `$['a..b']` também dão 422 |
| `{{now}}`, `{{now format='yyyy-MM-dd'}}` | agora em ISO-8601 UTC (em segundos) ou no padrão do `DateTimeFormatter`, em UTC |
| `{{randomValue type='UUID'\|'ALPHANUMERIC'\|'NUMERIC'\|'HEX' length=N}}` | valor aleatório; `length` de 1 a 10000 (fora disso, 422 ao salvar), padrão 16 |
| `{{math a '+'\|'-'\|'*'\|'/' b}}` | conta com números ou textos numéricos de até 100 dígitos na parte inteira e 100 casas decimais (operando ou resultado maior deixa o trecho vazio) |

Valem também os blocos `if`, `unless`, `each`, `with` e `lookup`. Não há helper que leia arquivo,
ambiente ou rede: partials (`{{> x}}`), decorators e os demais helpers embutidos do Handlebars
(`embedded`, `block`, `partial`, `precompile`, `i18n`, `log`...) ficam desligados, e o template só
enxerga os valores acima (nada de propriedade ou método de objeto Java nem dos dados internos da
renderização; `lookup` de chave ausente sai vazio). O que vem do remetente (query, cabeçalhos, corpo) é
sempre texto: `{{seq}}` dentro de um valor sai literal, sem ser avaliado. Erro de sintaxe, helper
desconhecido, helper sem os parâmetros que exige (`{{#each}}`, `{{#if}}`, `{{math 1 '+'}}`, em
qualquer ramo), partial ou decorator dão 422 ao salvar
(`"0.response.body": ["The template is invalid: could not find helper: 'x' (line 1, column 2)."]`, ou a
chave do cabeçalho). Falha ao executar (`jsonPath` em corpo que não é JSON, caminho ausente, divisão
por zero) deixa só aquele trecho vazio. Diferente do Handlebars puro, `}` logo depois do fim de uma tag
é texto: `{"seq":{{seq}}}` vale e sai `{"seq":42}`.

Tetos do template, conferidos ao salvar:

| Teto | Ao estourar |
|---|---|
| tamanho do `body` e de cada valor de cabeçalho templado: 64 KiB (65 536 caracteres) | 422, `The template is invalid: longer than 65536 characters.` |
| blocos aninhados e subexpressões aninhadas: 32 níveis (cada `{{else if …}}` conta um) | 422, `The template is invalid: blocks nested more than 32 levels deep (line 1, column 353).` |

O template é compilado uma vez e guardado pelo texto: o webhook não recompila a regra a cada requisição,
e salvar a regra com outro texto compila o novo. O cache guarda até 4096 templates (e até 4 Mi caracteres
de texto somados).

Regra salva antes desses tetos continua listada e casando. Quando ela responde, a mensagem continua
gravada, a resposta é 500 com o motivo no envelope de erro de sempre
(`{"success":false,"error":{"message":"The template is invalid: longer than 65536 characters.","id":null}}`)
e o log do servidor registra a URL e o motivo. Para voltar a responder, salve a regra dentro dos tetos.

Tetos da renderização, cobrados enquanto ela acontece (um `each` sobre os cabeçalhos do remetente não
junta a saída inteira antes de conferir):

| Teto | Ao estourar |
|---|---|
| corpo renderizado: 1 MiB (1 048 576 caracteres) | a mensagem continua gravada e a resposta é 500 com o envelope de erro de sempre: `{"success":false,"error":{"message":"The rendered template is too large.","id":null}}` para cliente JSON, a página de erro para os demais |
| cada valor de cabeçalho renderizado: 8 KiB (8192 caracteres) | o mesmo 500, `The rendered template is too large.` |
| soma dos valores de cabeçalho renderizados: 32 KiB (32 768 caracteres), abaixo do buffer de 64 KB do Tomcat | o mesmo 500 (sem o teto, o Tomcat responderia um 500 sem corpo) |
| `jsonPath`: objeto ou lista maior que o teto da saída (corpo ou cabeçalho), ou caminhos achados somando 4 Mi caracteres (ex.: união repetida `$[0,0,0][0,0,0]…`) | o mesmo 500, mesmo que o valor só sirva de condição |
| tempo de renderizar a resposta (corpo e cabeçalhos, depois de compilar): 1 s | 500, `The template took too long to render.` (ex.: `each` aninhado que gira sem produzir saída; o `jsonPath` confere o prazo a cada passo no documento) |

O corpo JSON que o `jsonPath` percorre é lido uma vez por resposta, não uma por chamada.

Num valor de cabeçalho renderizado, CR, LF e todo outro caractere de controle (U+0000–U+001F, U+007F e
U+0080–U+009F), menos o TAB, viram espaço: `{"X-Eco": "{{request.query.x}}"}` com `x=a%0D%0AX-Injetado:%20sim`
sai numa linha só, `X-Eco: a  X-Injetado: sim`. Espaço, e não erro, para que o remetente não consiga
derrubar a resposta da regra com uma quebra de linha; o corpo sai como veio. (O Tomcat 11 já troca os
controles C0 e o DEL por espaço, mas manda os C1 crus; a troca é feita pelo app, sem depender dele.)
Valor fixo (`template` desligado) recebe o mesmo tratamento: CR, LF e NUL escritos na regra dão 422 ao
salvar, templada ou não, e os demais controles saem como espaço (`"a\u0085b"` sai `a b`), para que os
dois caminhos mandem ao fio o mesmo valor.

Em todo valor de cabeçalho da regra, templado ou fixo, cada caractere fora do ISO-8859-1 (acima de U+00FF,
inclusive U+2028 e U+2029; um emoji conta como um) vira `?`: `{"X-Eco": "ação ✓"}` sai `X-Eco: ação ?`.
Sem a troca, o Tomcat descartaria o cabeçalho inteiro, sem aviso.

#### Cenários

Uma regra com `"scenario": {"name": "entrega", "requiredState": "falhou 1", "newState": "falhou 2"}` só
casa quando o cenário `entrega` da URL está em `requiredState` (ausente: qualquer estado) e, ao
responder, o leva a `newState` (ausente: mantém). Todo cenário começa em `Started`. Exemplo "falha 3×,
depois 200", para testar a retentativa de quem envia:

```json
[
  { "name": "falha 1", "scenario": { "name": "entrega", "requiredState": "Started", "newState": "falhou 1" },
    "response": { "status": 503, "headers": { "Retry-After": "1" } } },
  { "name": "falha 2", "scenario": { "name": "entrega", "requiredState": "falhou 1", "newState": "falhou 2" },
    "response": { "status": 503, "headers": { "Retry-After": "1" } } },
  { "name": "falha 3", "scenario": { "name": "entrega", "requiredState": "falhou 2", "newState": "entregue" },
    "response": { "status": 503, "headers": { "Retry-After": "1" } } },
  { "name": "ok", "scenario": { "name": "entrega", "requiredState": "entregue" }, "response": { "status": 200 } }
]
```

A escolha da regra e a mudança de estado são atômicas por URL, mesmo com várias instâncias do app:
com requisições simultâneas, cada transição acontece uma vez só (compare-and-set num script Lua; quem
perde relê o estado e decide de novo). Regra de cenário fora do estado entra no `near_miss` com
`scenario entrega: expected state "entregue", got "Started"`; o `rules/test` avalia só as condições da
requisição, sem o estado do cenário.

`GET /token/{id}/scenarios` responde `[{"name", "state", "states"}]`: os cenários citados pelas regras
(e os definidos à mão), o estado atual e os estados que as regras citam. `PUT /token/{id}/scenarios/{name}`
com `{"state": "..."}` define um estado (422 em `state` se vazio ou não texto) e devolve o cenário;
`DELETE /token/{id}/scenarios` volta todos a `Started` e devolve a lista. O estado fica em
`token:{uuid}:scenarios` (hash nome → estado), com o TTL da URL e apagado junto com ela.

#### Atrasos e falhas de rede

Para testar o timeout, a retentativa e o tratamento de erro de quem envia o webhook:

| Campo de `response` | Efeito |
|---|---|
| `delay` | espera antes de responder: `{"fixed": ms}`, `{"uniform": {"min": ms, "max": ms}}` (inteiros, sorteio no intervalo fechado) ou `{"lognormal": {"median": ms, "sigma": s}}` (mediana 1–60000, sigma 0–10, cortado em 60 s). Teto 60000 ms |
| `dribble` | `{"chunks": 1..100, "durationMs": 0..60000}`: status e cabeçalhos na hora e o corpo dividido em `chunks` pedaços, um a cada `durationMs / chunks` ms, com flush (`Transfer-Encoding: chunked`) |
| `fault` | a conexão falha no lugar da resposta: `connection_reset` (RST TCP), `empty_response` (fecha sem mandar nenhum byte), `malformed_chunk` (`HTTP/1.1 200 OK` chunked com um tamanho de chunk inválido, e fecha), `random_data_then_close` (1 KiB aleatório, e fecha) |

A mensagem é gravada (e o evento sai) antes do atraso e da falha: ela aparece na tela enquanto o
cliente ainda espera. Com `fault`, `status`, `headers`, `body`, `delay` e `dribble` são ignorados. O
atraso ocupa só uma thread virtual. As falhas são feitas no conector do Tomcat (`LegacyHttpProtocol`),
abaixo do HTTP: o Tomcat não escreve nada depois delas e a conexão não é reaproveitada. O RST chega
ao cliente em até cerca de 1 s (o NIO do Java fecha o socket com `SO_LINGER 0` na volta seguinte do
seletor do Tomcat).

Validação: 422 em JSON com a chave em pontos a partir do índice da lista
(`{"0.match.path.regex": ["The regex is invalid."]}`, `{"rules": ["The rules may not have more than 100 items."]}`);
URL inexistente dá 410. O `GET` devolve a regra com todos os campos, e devolver essa lista ao `PUT` a
recria sem perda.

Toda mensagem traz `rule` (`{id, name}` da regra que respondeu, ou `null`) e `near_miss`: sem regra
que case, a regra ativa com menos condições falhando (empate pela prioridade), com uma frase por
condição em `failed` (`method: expected POST, got GET`, `header x-signature: absent`,
`body $.status: expected "pago", got "pendente"`, `signature: expected valid, got invalid (signature mismatch)`,
`signature: expected valid, got not configured`, `schema: expected valid, got invalid (3 errors)`, com o número
de erros gravados, `schema: expected invalid, got valid`, `schema: expected valid, got not configured`); `null` quando respondeu uma regra ou não há regra
ativa. Mensagens gravadas antes das regras trazem os dois nulos.

O `near_miss` traz também `conditions`: a condição que produziu cada frase de `failed`, na mesma ordem e com o
mesmo tamanho, no formato das chaves do 422 (sem o índice da lista), para a tela apontar o campo da regra:

```json
"near_miss": { "id": "5b0c…", "name": "Pagamento pix",
  "failed":     ["method: expected POST, got GET", "header x-signature: absent", "body $.status: expected \"pago\", got \"pendente\""],
  "conditions": ["match.method",                   "match.headers.X-Signature",  "match.body.0"] }
```

| Chave | Condição |
|---|---|
| `match.method`, `match.path`, `match.signature`, `match.schema` | a condição de mesmo nome |
| `match.query.<nome>`, `match.headers.<nome>` | o parâmetro ou cabeçalho, com o nome escrito como na regra (a frase usa o cabeçalho em minúsculas) |
| `match.body.<i>` | a condição de índice `i` (a partir de 0) em `match.body` |
| `scenario` | o estado do cenário (ver [Cenários](#cenários)) |

Mensagem gravada antes de `conditions` traz `conditions: null`: a chave não é reconstruída, porque a regra pode ter
mudado desde então. O link só-leitura mostra `conditions` como gravado (não carrega valores).

`POST /token/{id}/rules/test` recebe uma regra (mesma validação, chaves sem o índice), ignora `enabled`
e responde `{"matches": [{uuid, seq}], "misses": [{uuid, seq, failed, conditions}]}` sobre as 500 mensagens mais
recentes, da mais nova para a mais antiga (`conditions` como no `near_miss`, sem `scenario`). As condições de assinatura e de schema usam o `signature` e o
`schema` gravados em cada mensagem (a verificação da época em que chegou).

As regras ficam em `token:{uuid}:rules`, com o TTL da URL (renovado a cada webhook), e saem junto com
ela no `DELETE /token/{id}`.

### Esperar por mensagens

Para o teste automatizado que dispara uma ação e precisa afirmar "chegou (N vezes) um webhook assim,
em até T", sem `sleep` nem polling à mão. `POST /token/{id}/requests/wait` é um long-poll: responde
assim que houver mensagens suficientes que casam, ou quando o prazo acaba.

```json
{ "match": { "method": ["POST"], "path": { "prefix": "/pedidos" },
             "body": [ { "jsonPath": { "path": "$.status", "equals": "pago" } } ] },
  "after": 1790438426238928, "count": 1, "timeout": 30000 }
```

| Campo | Regra |
|---|---|
| `match` | o `match` de uma regra (`method`, `path`, `query`, `headers`, `body`, `signature`, `schema`; ver [Regras de resposta](#regras-de-resposta)), com a mesma validação. Ausente: casa qualquer mensagem |
| `after` | inteiro ≥ 0: só mensagens com `seq` maior. Ausente: todo o histórico guardado e as que chegarem |
| `count` | 1 a 100 (padrão 1): quantas mensagens que casam são necessárias |
| `timeout` | 0 a 300000 ms (padrão 30000): quanto esperar por mensagens novas; `0` só olha o histórico |

A resposta é sempre 200 quando a chamada é válida:

```json
{ "matched": false, "count": 0, "requests": [],
  "near_miss": { "uuid": "bbe0…", "seq": 1790438428567114, "failed": ["method: expected DELETE, got POST"],
                 "conditions": ["match.method"] } }
```

`requests` traz as `count` mensagens que casaram de menor `seq`, em ordem crescente e completas (como
no `GET /token/{id}/request/{requestId}`); sem sucesso, as que casaram até ali. `near_miss` só aparece
com `matched: false`: entre as mensagens avaliadas que não casaram, a de menos condições falhando
(empate: a mais nova), com as frases do `near_miss` das regras e, em `conditions`, a chave `match.*` de cada uma
(do `match` da espera; nunca `scenario`); `null` se nenhuma foi avaliada.

O servidor registra a escuta das mensagens novas antes de ler o histórico e desconta a mesma mensagem
vista nos dois (pelo `seq`): nenhuma que chegue durante a chamada se perde. A espera ocupa só uma thread
virtual. Apagar a URL durante a espera a encerra na hora, com o que houver (200, `matched: false` se não
bastou). Corpo vazio vale `{}`. Validação: 422 em JSON, com `match.<campo>` como no `rules/test`
(`{"match.path.regex": ["The regex is invalid."]}`), `after`, `count` e `timeout` na chave do campo e
`wait` quando o corpo não é um objeto JSON; URL inexistente dá 410.

### Buscar mensagens

`POST /token/{id}/requests/search` acha mensagens entre as retidas na URL (até 10.000) sem rolar a lista.

```json
{ "text": "PED-7781", "match": { "method": ["POST"], "signature": "invalid" },
  "sorting": "newest", "page": 1, "per_page": 50 }
```

| Campo | Regra |
|---|---|
| `text` | até 200 caracteres. Casa quando aparece como trecho literal, sem diferenciar maiúsculas, no método, na `url` gravada, no IP, num nome ou valor de header, num nome ou valor de query (em qualquer nível: `a[b]=1` também) ou no corpo. Vazio ou ausente: sem filtro de texto |
| `match` | o `match` de uma regra (ver [Regras de resposta](#regras-de-resposta)), com a mesma validação. Ausente: casa qualquer mensagem |
| `sorting` | `newest` (padrão) ou `oldest` |
| `page`, `per_page` | `page` ≥ 1 (padrão 1); `per_page` de 1 a 100 (padrão 50) |

`text` e `match` combinam em E. A resposta tem a forma e a aritmética de página do `GET /token/{id}/requests`
(`data`, `total`, `per_page`, `current_page`, `is_last_page`, `from`, `to`), com `total` = quantas casam; sem
filtro, é a mesma página da listagem. O servidor varre todas as mensagens da URL a cada chamada, em trechos de
100 lidos pelo índice (na memória ficam o trecho e a página, nunca a URL inteira); não há índice de texto.
Mensagem fantasma do app antigo (valor vazio na hash) não casa nada e não conta no `total`. Corpo vazio vale
`{}`. Validação: 422 em JSON, com `match.<campo>` como no `rules/test`, `text`, `sorting`, `page` e `per_page`
na chave do campo e `search` quando o corpo não é um objeto JSON; URL inexistente dá 410.

### Estatísticas da URL

`GET /token/{id}/stats?window=N` resume as `N` mensagens mais novas da URL (`window` de 1 a 500, padrão 500;
ausente ou vazio vale 500). É o que alimenta o Health e o Insights da tela.

```json
{ "window": 500, "evaluated": 128, "total": 128,
  "newest_seq": 1790438428567114, "oldest_seq": 1790438402000001,
  "newest_at": "2026-09-26 14:02:07", "oldest_at": "2026-09-25 09:13:44",
  "methods": { "POST": 120, "GET": 8 },
  "signature": { "valid": 110, "invalid": 9, "absent": 3, "unchecked": 6,
                 "reasons": [ { "reason": "signature mismatch", "count": 6 },
                              { "reason": "timestamp outside tolerance", "count": 3 } ] },
  "schema": { "valid": 100, "invalid": 20, "unchecked": 8, "paths": [ { "path": "/data/object/amount_paid", "count": 4 } ] },
  "rules": { "answered": [ { "id": "…", "name": "Stripe payment OK", "count": 41 } ],
             "near_miss": [ { "id": "…", "name": "Refund queued", "count": 3 } ], "default": 84 },
  "hourly": [ { "hour": "2026-09-26 14:00:00", "count": 12, "methods": { "POST": 12 } } ] }
```

| Campo | O que conta |
|---|---|
| `evaluated`, `total` | quantas foram avaliadas (`min(window, total)`) e quantas a URL guarda |
| `newest_*`, `oldest_*` | `seq` e `created_at` da mais nova e da mais antiga avaliadas; `null` sem mensagens |
| `methods` | mensagens por método, da mais frequente para a menos |
| `signature` | o estado da [verificação de assinatura](#verificação-de-assinatura) gravado em cada mensagem; `unchecked` é `signature: null`. `reasons`: os motivos das inválidas e ausentes sem o parêntese final (`timestamp outside tolerance (412 s)` conta como `timestamp outside tolerance`), por contagem decrescente e, no empate, pelo texto; no máximo 10 |
| `schema` | o resultado da [validação de schema](#validação-de-schema); `unchecked` é `schema: null`. `paths`: cada `errors[].path` conta uma vez por mensagem (`""` é a raiz), na mesma ordem e com o mesmo teto dos motivos |
| `rules` | `answered` agrupa por `rule.id`, com o nome da mensagem mais nova; `near_miss` agrupa por `near_miss.id`; `default` conta as que tiveram `rule: null` (a resposta padrão da URL) |
| `hourly` | as horas UTC com pelo menos uma mensagem, da mais antiga para a mais nova, com o total e os métodos |

Horários no formato do `created_at` (UTC). Mensagens gravadas antes da assinatura, do schema ou das regras contam
como `unchecked` e `default`. Nada é gravado: a rota só lê, em trechos de 100 pelo índice, como a busca. Validação:
422 `{"window": ["The window must be an integer between 1 and 500."]}`; URL inexistente dá 410 (antes de validar);
URL protegida sem acesso dá 401, como toda rota `/token/{id}/...`.

### Reenvio e envio pelo servidor

> **Aviso de SSRF.** Aqui o servidor abre conexão para uma URL escolhida por quem usa a API. Com
> `WEBHOOK_OUTBOUND_ALLOW_PRIVATE=true` (o `docker-compose.yml` local) ele alcança a sua máquina e a rede privada em
> que roda: **não publique o app assim**. O padrão do app (`false`) só sai para endereço público. Pelo mesmo motivo
> o `docker-compose.yml` publica a porta só no loopback (`"127.0.0.1:8084:8080"`): publicada em todas as interfaces
> (`"8084:8080"`) com `allow-private=true`, qualquer um na mesma rede, sem credencial, usaria o send como proxy para
> a LAN, para a rede do Docker (o Redis) e para o seu Mac. Não troque o bind enquanto a variável estiver ligada.

`POST /token/{id}/request/{requestId}/replay` reenvia uma mensagem gravada; `POST /token/{id}/send` envia uma
requisição montada:

```json
{ "url": "http://localhost:3000/hooks", "keep_path": true, "timeout": 10000 }

{ "url": "http://localhost:3000/hooks", "method": "POST", "headers": { "Content-Type": "application/json" },
  "body": "{\"evento\":\"pago\"}", "sign": true, "timeout": 10000 }
```

| Campo | Regra |
|---|---|
| `url` | obrigatória, URL absoluta de até 2048 caracteres (senão 422). Esquema que não é `http`/`https` sai como `error.kind=blocked` |
| `timeout` | ms, inteiro de 1000 a 30000 (padrão 10000): prazo total do disparo (resolução do nome, conexão, TLS e resposta; DNS que não responde a tempo dá `timeout`) |
| `keep_path` (replay) | padrão `true`: acrescenta à `url` o caminho depois do token e a query da mensagem (`/base` + `/pedidos/42?x=1`) |
| `method` (send) | `GET`, `POST` (padrão), `PUT`, `PATCH`, `DELETE`, `HEAD` ou `OPTIONS` |
| `headers` (send) | objeto nome → texto; nome no formato de header, valor sem CR/LF; até 100 headers, valor de até 8192 caracteres e nomes + valores somando até 65536 (senão 422 em `headers`, se o destino passa; destino recusado antes de sair grava o resultado recusado com os headers cortados a esses tetos) |
| `body` (send) | texto de até 1 MiB em bytes UTF-8 (o pedido inteiro do send aceita até 2 MiB, por causa do JSON em volta) |
| `sign` (send) | `true` assina o corpo com a `signature` da URL, com as fórmulas da [verificação](#verificação-de-assinatura) (Stripe e Slack com o timestamp de agora); sem `signature` na URL, 422 em `sign` |

O replay sai com o método, o corpo e os headers gravados, menos `host`, `content-length`, `connection`,
`transfer-encoding`, `keep-alive`, `upgrade`, `te`, `trailer`, `proxy-*`, `x-forwarded-*`, `x-real-ip` e `cf-*` (o
send tira só os de conexão: `host`, `content-length`, `connection`, `transfer-encoding`, `keep-alive`, `upgrade`,
`te`, `trailer`, `proxy-*`). A resposta é o resultado, que também entra no histórico:

```json
{ "id": "…", "kind": "replay", "at": "2026-09-26 18:00:00", "target": "http://host.docker.internal:3000/hooks/pedidos/42?x=1",
  "method": "POST", "request_headers": { "content-type": "application/json" }, "status": 200,
  "headers": { "content-type": ["text/plain"] }, "body": "ok", "truncated": false, "duration_ms": 12,
  "source_request": "…" }
```

`body` guarda até 64 KiB da resposta, decodificado como UTF-8, e `headers` até 16 KiB (nomes + valores; os que
passam saem inteiros): além de qualquer um dos dois, `truncated: true`. Redirecionamento
não é seguido: o 3xx volta como resposta, com o `Location`. Falha de saída não é erro da API: 200 com
`{"error": {"kind", "message"}}` e sem `status`, com `kind` `blocked` (destino proibido), `dns`, `connect`,
`timeout`, `tls` ou `invalid_url` (host, porta ou IP que não servem). Com `allow-private=false` (o padrão, o
que se publica) o erro não descreve a rede: nome que não resolve e faixa bloqueada dão o mesmo `blocked` com
`destination not allowed or not resolvable`, e o `connect` diz só `could not connect to the destination`, sem o IP;
com `true` (uso local) saem `dns`, a faixa e a mensagem da conexão. Token inexistente dá 410, mensagem
inexistente 404, entrada inválida 422 (nada disso sai nem entra no histórico). Mais de 30 disparos (replay e send
somados) por minuto na mesma URL dão 429 com `Retry-After`. O segredo da `signature` nunca vai para a resposta, o
histórico ou o log; o header assinado vai em `request_headers`.

`GET /token/{id}/outbound` devolve a lista (sem envelope) com os 50 resultados mais novos. O histórico
(`token:{id}:outbound`) tem a expiração da URL e sai junto com ela no `DELETE /token/{id}`.

**Destinos.** O servidor resolve o nome uma vez, confere **todos** os IPs e conecta no IP conferido, com o nome
original no `Host` e no SNI/validação do TLS: um DNS que muda de resposta entre a conferência e a conexão (DNS
rebinding) não troca o destino. IPv4 escrito de forma estranha (`2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1`)
vale o IP que os navegadores leem; IPv4 embutido em IPv6 (`::ffff:a.b.c.d`, `::a.b.c.d`, NAT64 `64:ff9b::/96` e
6to4 `2002::/16`) vale pelo IPv4; IPv6 com zona (`%25en0`) é sempre recusado.

| Faixa | `allow-private=false` (padrão) | `allow-private=true` |
|---|---|---|
| `0.0.0.0/8`, `::`, link-local `169.254.0.0/16` (metadados de nuvem) e `fe80::/10`, multicast, `240.0.0.0/4` (inclui o broadcast) | bloqueado | bloqueado |
| o resto que o [registro de uso especial da IANA](https://www.iana.org/assignments/iana-ipv4-special-registry/) ([IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry/)) marca como não globalmente alcançável: `192.0.0.0/24` (inclui `192.0.0.192`, metadados da Oracle Cloud), `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `192.88.99.0/24`, `2001::/23` (inclui Teredo `2001::/32`), `2001:db8::/32`, `3fff::/20`, `5f00::/16`, `64:ff9b:1::/48`, `::ffff:0:0:0/96`, `100::/64` | bloqueado | bloqueado |
| loopback `127.0.0.0/8` e `::1`, privados `10/8`, `172.16/12`, `192.168/16`, CGNAT `100.64/10`, ULA `fc00::/7`, site-local `fec0::/10` | bloqueado | liberado |
| IPs para os quais o `localhost-alias` resolve naquele disparo (o OrbStack põe `host.docker.internal` em `0.250.250.254`) | regra da faixa | liberado (menos `0.0.0.0` e `::`) |
| demais (públicos) | liberado | liberado |

Com `WEBHOOK_OUTBOUND_LOCALHOST_ALIAS`, alvo cujos IPs são todos loopback (`localhost`, `127.0.0.1`, `[::1]`) vai
para o alias, que aparece em `target`: dentro do container, o `localhost` é o do container, não o do Mac.

O comportamento exato (status, erros, limpeza automática e corpo de até 1 MiB) está descrito em
[`tests/contract/README.md`](tests/contract/README.md). A coleção `webhook-paw.paw` (Paw) tem
exemplos das mesmas rotas.

## Privacidade

Quem tem o UUID de uma URL lê tudo dela. Com um **segredo de leitura**, ver e gerir a URL passa a exigir o segredo;
**capturar continua aberto** (quem manda o webhook não tem segredo).

Limites (o modelo não tem contas de usuário):

- **Quem tem o UUID de uma URL ABERTA pode protegê-la** com um segredo seu, e o dono perde o acesso até saber o
  segredo. É o mesmo poder que esse UUID já dava (ler, apagar, trocar a resposta): proteja a URL antes de o UUID
  circular.
- **O PBKDF2 não tem limite global.** O limite de 10 falhas por minuto é por URL; quem espalha tentativas por muitas
  URLs faz o servidor calcular um PBKDF2 (210.000 iterações) por tentativa. Limites globais anti-abuso, para publicar
  o app, são outro tema.

### Captura isolada (CSP sandbox)

Toda resposta da captura `/{id}/...` — a resposta padrão da URL, a de uma regra e a da falha `malformed_chunk` — sai
com `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals`, **sem
`allow-same-origin`**. Motivo: a tela, a API e a captura servem pelo mesmo endereço (`localhost:8084`), e a resposta
de uma URL é conteúdo de quem a configurou (ou de quem conhece o UUID de uma URL aberta). Sem o sandbox, uma captura
que responde HTML com `<script>` rodaria na origem da tela: leria o `localStorage` (os UUIDs de quem abre a página) e
chamaria a API com o cookie de desbloqueio. Com ele, a página roda numa origem opaca: o script roda, formulários e
pop-ups funcionam, mas nada da origem do app fica ao alcance. O cabeçalho vem depois dos cabeçalhos da regra e é
acrescentado, não trocado: uma regra que define o próprio `Content-Security-Policy` fica com os dois, e o navegador
aplica os dois. Clientes que não são navegador (CLI, SDKs, provedores) ignoram o cabeçalho.

### Segredo de leitura

`read_secret` (texto de 8 a 256 caracteres) no corpo do `POST /token` ou do `PUT /token/{id}`. Nunca é devolvido: o
token ganha `"protected": true|false`. No `PUT`, **ausente mantém** o segredo (exceção deliberada à regra "campo
ausente volta ao padrão": apagar a proteção por omissão seria perigoso), `null` remove e texto troca. Na query, 422.

Sem acesso, **toda** rota `/token/{id}/...` (o token, `DELETE`, mensagens, raw, SSE, busca, wait, regras, cenários,
saídas, replay, send, IA, links) responde `401 {"error":"This URL is protected","protected":true}`; só `unlock` e
`lock` respondem. A captura `/{id}/...` não muda. Acesso é um destes:

- cabeçalho `X-Webhook-Secret: <segredo>` (CLI, scripts);
- o cookie de desbloqueio (a tela).

No Redis fica só o PBKDF2-HMAC-SHA256 (sal aleatório de 16 bytes, 210.000 iterações) e `secret_version`, que muda a
cada troca; comparação em tempo constante. Acertos ficam 5 minutos em memória (o CLI não paga o PBKDF2 em toda
chamada). **10 segredos errados por minuto por URL** (unlock e cabeçalho somados; o `read_secret` do MCP conta à parte, para
um agente errando não travar a tela e o CLI) → `429` com `Retry-After`
até o minuto acabar, **também para o segredo certo** (senão o 429 do errado e o 200 do certo diriam qual é o certo);
o cookie não passa por esse limite. O segredo não aparece em log, resposta, métrica nem erro. Token gravado antes do
segredo abre como não protegido.

### Cookie de desbloqueio

`POST /token/{id}/unlock {"secret": "..."}` → `204` com
`Set-Cookie: wh_access=<dia>.<HMAC-SHA256(chave do servidor, id:versão:dia)>; Path=/token/{id}; Max-Age=2592000;
HttpOnly; SameSite=Strict` (e `Secure` quando a requisição chega em HTTPS, direto ou com `X-Forwarded-Proto: https`).
Errado: `401 {"error":"Wrong secret"}`; sem `secret`: 422; URL sem proteção: `204` sem cookie. O cookie abre toda rota
da URL, inclusive o SSE, sem o segredo passar pelo JavaScript. `POST /token/{id}/lock` apaga o cookie (`204`).

`<dia>` é o dia de emissão (dias desde 1970, UTC), assinado junto: **o servidor recusa o cookie com 30 dias ou mais**,
mesmo que o navegador ainda o mande. É o dia, e não o instante, para que dois desbloqueios no mesmo dia deem o mesmo
cookie; o prazo nunca passa de 30 dias (encurta menos de um dia). Cookies do formato anterior (sem o dia) deixaram de
valer: quem os tinha desbloqueia de novo.

A chave do servidor são 32 bytes aleatórios em `webhook:server-key` no Redis, criados no primeiro uso com `SET NX`
(duas instâncias ficam com a mesma) e sem TTL: sobrevive a restart. Trocar ou remover o segredo muda a versão, então
os cookies antigos param de valer (inclusive se o segredo for definido de novo), as conexões SSE e esperas abertas
da URL são fechadas (quem reconectar passa de novo pelo acesso) e **todos os links só-leitura da URL são revogados**
(um link é acesso; quem troca o segredo quer cortar quem tinha).

### CLI e MCP

No CLI, `--read-secret <segredo>` (depois do subcomando, como o `--server`) ou a variável `WEBHOOK_READ_SECRET` põe o
cabeçalho em `listen`, `replay`, `wait-for` e `rules`. URL protegida sem o segredo certo: `This URL is protected: pass
--read-secret or set WEBHOOK_READ_SECRET` no stderr e saída 1 (2 no `wait-for`). O segredo nunca é impresso. Só ASCII
imprimível: o cliente HTTP do Java troca os demais caracteres por `?` num cabeçalho.

```bash
WEBHOOK_READ_SECRET='meu-segredo' anzol listen --token <uuid> --forward http://localhost:3000
anzol rules pull <uuid> --read-secret 'meu-segredo'
```

No MCP, toda ferramenta da URL aceita o argumento opcional `read_secret`; URL protegida sem ele (ou com ele errado) é
erro de ferramenta `{"status":401,"error":"This URL is protected; pass its read_secret"}`. No `create_url`,
`read_secret` é o segredo que a URL nova passa a exigir; no `update_url`, é só o acesso (o segredo da URL não muda por
ali).

## Links só-leitura

Uma mensagem pode ser compartilhada por um link que não dá acesso a mais nada da URL (nem com ela protegida):

```bash
curl -X POST localhost:8084/token/<uuid>/request/<rid>/share -H 'Content-Type: application/json' \
  -d '{"expires_in":"1d","redact":true}'
# 201 {"id":"3kQ…","url":"/#/share/3kQ…","expires_at":"2026-09-27 12:00:00","redact":true}
```

- `expires_in`: `1h`, `1d`, `7d` (padrão) ou `30d`; `redact`: `true` (padrão) ou `false`. Outro valor: 422.
- `GET /token/{id}/shares` lista os ativos; `DELETE /token/{id}/shares/{sid}` revoga (`204`; link de outra URL, 404).
  No máximo 50 ativos por URL (422 acima).
- `GET /share/{sid}` é público: a mensagem como `GET /token/{id}/request/{rid}` a devolve, mais `shared_at` e
  `expires_at`, **sempre sem o UUID da URL** (com ou sem `redact`): sem `token_id`, e com toda ocorrência do UUID no
  JSON inteiro trocada por `[redacted]` (`http://localhost:8084/[redacted]/caminho?x=1`) — na `url`, nos cabeçalhos
  (`referer`), na query, no `request` e no corpo (o ping do GitHub traz a própria URL) —, também escrito com
  maiúsculas ou com caracteres em `%hh` (`%2D` no lugar do hífen). O UUID é do servidor, não dado do remetente: do
  corpo, só ele sai. Expirado, revogado, de mensagem apagada, de URL apagada ou inexistente: o mesmo `404`.
- Definir, trocar ou remover o segredo de leitura da URL revoga todos os links dela. O link guarda a `secret_version`
  da URL na criação e só abre enquanto ela for a atual: um link criado no mesmo instante da troca também morre.
- `redact=true` troca por `"[redacted]"` os valores dos cabeçalhos `authorization`, `proxy-authorization`, `cookie`,
  `set-cookie`, `x-api-key`, `x-webhook-secret`, dos cabeçalhos cujo nome contém `token`, `key`, `secret`, `password`,
  `auth`, `session`, `credential`, `jwt`, `bearer`, `passwd` ou `pwd` (sem diferenciar maiúsculas: `X-Auth-Token`,
  `X-Api-Keys`, `X-Session-Id`) e do cabeçalho de assinatura do provedor
  configurado na URL, e os
  valores de query cujo nome contém `token`, `key`, `secret`, `password` ou `signature` (sem diferenciar maiúsculas),
  também dentro da `url` gravada. Os `php-auth-user`/`php-auth-pw` (o `Authorization: Basic` decodificado que a
  mensagem grava), os campos de formulário de nome sensível e as frases do `near_miss` que citam esses valores também
  saem mascarados. **O corpo não é mascarado.**

O id são 128 bits aleatórios em base62; no Redis, `share:{sid}` com TTL igual à expiração e o índice
`token:{uuid}:shares`, apagados junto com a URL.

## Proteção contra DNS rebinding/CSRF

Uma página maliciosa aberta no navegador pode tentar usar a API local: por DNS rebinding (o nome dela passa a apontar
para `127.0.0.1`, e o navegador manda `Host: nome-do-atacante`) ou por CSRF (um formulário de outro site, inclusive de
outro app em outra porta do `localhost`: o `SameSite` do cookie não separa portas). Com `WEBHOOK_ALLOWED_HOSTS`
(`webhook.allowed-hosts`, lista separada por vírgula; padrão fechado `localhost,127.0.0.1,[::1],host.docker.internal`),
as rotas de gestão (`/token`, `/token/...`, `/share/...`) e o `/mcp` conferem:

- `Host` fora da lista → `403 {"error":"host not allowed"}` (nome sem porta na lista casa qualquer porta);
- nos métodos que mudam estado (POST, PUT, PATCH, DELETE, inclusive por `X-HTTP-Method-Override`), `Origin` presente
  que não seja deste servidor → `403 {"error":"origin not allowed"}`. Passa o `Origin` na **mesma porta do `Host`** com
  nome da lista (a própria tela, também aberta por outro nome do loopback, ou pelo proxy do `ng serve`, que mantém o
  `Host`) ou com `nome:porta` escrito na lista (ex.: `localhost:4200` para uma tela servida noutra porta). Outra porta
  do mesmo nome é outra origem. No `/mcp`, o `Origin` é conferido em todo método, como o transporte Streamable HTTP
  exige;
- `_method` num POST (campo de formulário ou query, que transformaria o POST de um `<form>` em PUT ou DELETE) →
  `403 {"error":"_method not allowed"}`, com ou sem `Origin`;
- corpo de formulário (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, os que um `<form>`
  manda sem preflight) com `Origin` ou com o cookie de desbloqueio `wh_access` (que só um navegador manda sozinho,
  mesmo quando omite o `Origin`) → `403 {"error":"form not allowed"}`. A tela só manda JSON. Sem `Origin` e sem o
  cookie (CLI, curl, scripts) o formulário continua aceito, como no app antigo. É 403, e não 415, porque o tipo é aceito: o que se
  recusa é o formulário vindo de um navegador.

Cliente sem `Origin` (CLI, curl, agentes) passa pelo `Host`. A captura `/{id}/...` e os arquivos da tela não conferem
nada (a captura aceita formulário, `_method` e qualquer `Origin`). A rota é reconhecida como o Spring a casa:
`/token;x=1/...` ou `/%74oken/...` também são conferidos. Lista vazia vale o padrão. Para chegar ao app por outro
nome, acrescente-o à lista.

**`*` desliga a conferência de `Host` e `Origin` da gestão, e é inseguro**: qualquer página aberta no navegador (e
qualquer nome que resolva para o app) passa a usar a API. O `/mcp` continua no padrão, e `_method` e formulário com
`Origin` continuam recusados.

## MCP

Com `WEBHOOK_MCP_ENABLED=true` (ligado no `docker-compose.yml`), o app é um servidor
[MCP](https://modelcontextprotocol.io) em `/mcp` (Streamable HTTP, Spring AI 2.0): agentes de IA operam o
Anzol pelas mesmas rotas da API, sem LLM nenhum no app. Para conectar o Claude Code:

```bash
claude mcp add --transport http anzol http://127.0.0.1:8084/mcp
```

São 15 ferramentas:

| Ferramenta | Rota da API |
|---|---|
| `create_url`, `get_url`, `update_url`, `delete_url` | `POST /token`, `GET`/`PUT`/`DELETE /token/{id}` |
| `list_requests`, `get_request`, `search_requests`, `wait_for_request` | `GET /token/{id}/requests`, `GET /token/{id}/request/{rid}`, `POST .../requests/search`, `POST .../requests/wait` |
| `get_rules`, `set_rules`, `test_rule` | `GET`/`PUT /token/{id}/rules`, `POST .../rules/test` |
| `diff_rules` | sem rota: compara a lista proposta (o mesmo argumento do `set_rules`) com as regras salvas, por `id`, e não grava |

O `update_url` muda só o que foi enviado, ao contrário do `PUT /token/{id}` (que troca a configuração inteira): campo
ausente fica como está, e campo enviado como `null` desliga (`signature`, `schema`) ou volta ao padrão.
| `replay_request`, `send_request`, `get_outbound` | `POST .../request/{rid}/replay`, `POST .../send`, `GET .../outbound` |

Os argumentos têm os nomes da API (a URL é sempre `token_id`, a mensagem `request_id`), e o resultado é o JSON que a
rota devolveria, com o segredo de assinatura mascarado. Validação, URL ou mensagem inexistente e limite viram erro de
ferramenta (`isError`) com o status e as mensagens da API: `{"status": 422, "errors": {"timeout": ["The timeout may
not be greater than 10."]}}`, `{"status": 410, "error": "Token not found"}`. Desligado (o padrão), `/mcp` é 404.

Contra DNS rebinding, o `/mcp` confere `Host` e `Origin` com a lista `WEBHOOK_ALLOWED_HOSTS` (ver [Proteção contra
DNS rebinding/CSRF](#proteção-contra-dns-rebindingcsrf)); com `*` na lista, só o padrão (`localhost`, `127.0.0.1`,
`[::1]` e `host.docker.internal`). URL protegida exige o argumento `read_secret` (ver [Privacidade](#privacidade)).

O servidor não tem autenticação, como o resto da API: quem alcança a porta opera todas as URLs sem segredo de
leitura, inclusive o `send` para a rede local quando `WEBHOOK_OUTBOUND_ALLOW_PRIVATE=true`. Por isso o compose publica
só em `127.0.0.1`; não ligue o MCP num app publicado.

## IA local

Com `WEBHOOK_AI_ENABLED=true`, duas rotas usam um LLM local OpenAI-compatível (no `docker-compose.yml`, o
oMLX do Mac, em `host.docker.internal:8000`). Os payloads não saem da máquina, e o
LLM nunca grava nada.

- `POST /token/{id}/rules/suggest` `{"prompt": "responda 429 com Retry-After 5 para POST em /pagamentos", "lang"?:
  "pt-BR", "request_id"?: "<uuid de uma mensagem de exemplo>"}` → `{"rule", "explanation", "attempts"}`. O modelo
  responde com saída estruturada (`json_schema` estrito com a forma da regra) e o mesmo validador do `PUT /rules`
  decide; se a regra for inválida, os erros voltam ao modelo, até 3 tentativas. Sem regra válida: 422
  `{"error", "errors", "attempts"}` com os erros da última. A regra não é gravada: a tela a mostra no editor e quem
  salva é o dono. `prompt` tem de 1 a 2000 caracteres (422 em `prompt`).
- `POST /token/{id}/request/{rid}/explain` `{"lang"?}` → `{"explanation", "facts"}`. O backend monta os fatos (resultado
  da assinatura com o motivo, erros do schema, regra que respondeu ou near miss com as frases, status dado, cabeçalhos
  relevantes e até 4 KB do corpo) e o modelo só redige, em markdown simples, no idioma de `lang` (padrão `en`).

| Variável | Padrão | O que faz |
|---|---|---|
| `WEBHOOK_AI_ENABLED` | `false` | Liga as rotas; desligada, respondem `503 {"error": "AI is not configured"}` e o resto da API segue igual |
| `WEBHOOK_AI_BASE_URL` | `http://localhost:8000` | Raiz do servidor, sem o `/v1` (o app chama `{base}/v1/chat/completions`). No compose, `http://host.docker.internal:8000` |
| `WEBHOOK_AI_API_KEY` | vazia | `Authorization: Bearer`; vazia, o pedido sai sem o cabeçalho. O compose lê de um `.env` ao lado dele, fora do git (permissão 600): **nunca** no compose, no repositório ou no log |
| `WEBHOOK_AI_MODEL_JSON` | `NVIDIA-Nemotron-3.5-Lightning-30B-A3B-4bit` | Modelo do suggest (saída estruturada) |
| `WEBHOOK_AI_MODEL_TEXT` | `KAT-Coder-V2.5-Dev-oQ4e-mtp` | Modelo do explain |

```bash
# .env na raiz do repositório (ignorado pelo git): a chave do oMLX
echo 'WEBHOOK_AI_API_KEY=<chave>' > .env && chmod 600 .env
```

Cada chamada tem até 90 s (temperatura 0, sem retentativa); o app lê só o `content` da resposta (o
`reasoning_content` dos modelos que pensam fica de fora). LLM fora do ar, com erro ou sem resposta no prazo: `502
{"error": "The language model failed: ..."}`, sem afetar a captura nem o resto da API. Por URL, uma chamada de IA por
vez e até 10 por minuto: acima disso, `429` com `Retry-After`. A inicialização não depende da chave nem do LLM.

Riscos:

- **Prompt injection.** O corpo e os cabeçalhos de uma mensagem são escritos por quem mandou o webhook. No explain (e
  na mensagem de exemplo do suggest) eles vão ao modelo fora da mensagem de sistema, entre marcadores com um código
  novo a cada chamada, e o prompt manda tratá-los como dado não confiável e nunca seguir instruções de dentro deles.
  Isso reduz, mas não elimina, o risco de um payload mudar o texto da explicação: os `facts` da resposta, montados
  pelo backend, são a fonte de verdade. O LLM não tem ferramentas nem grava nada, e a regra sugerida só vale depois
  que o dono a salva.
- **Modelo frio.** O oMLX descarrega o modelo ocioso (15 min); a primeira chamada depois disso leva de 9 a 31 s só
  para carregar. O prazo de 90 s cobre isso; acima dele, 502.
- **Memória.** Os modelos dividem a memória unificada do Mac com os outros do dono.

## CLI

Entrega os webhooks que chegam na URL direto no app que você está desenvolvendo, como o
`stripe listen`: sem aba aberta e sem CORS.
Também baixa e sobe as [regras de resposta](#regras-de-resposta) da URL como arquivo JSON.
Com o `send`, faz o papel do provedor: dispara webhooks assinados, com retentativas, para o seu app.
Com o `wait-for`, um teste automatizado espera o webhook chegar, sem `sleep`.

### Instalar

Roda em Java 21 ou mais novo. Para construir, o JDK 25 (o Gradle o usa como toolchain e gera classes do Java 21).

```bash
cd cli && ./gradlew installDist
# o script fica em cli/build/install/anzol/bin/anzol; ponha a pasta bin no PATH ou chame pelo caminho
```

### `anzol listen`

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

### `anzol replay`

```bash
anzol replay <token> <requestId> --to http://localhost:3000
```

Reenvia uma mensagem gravada, igual ao `listen`, e imprime a mesma linha. Sai com 0 quando o app
local respondeu (qualquer status) e com 1 em `error:`, `Token not found` ou `Request not found`.

### `anzol rules pull` e `anzol rules push`

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

### `anzol send`

Simula o provedor: dispara webhooks assinados como o Stripe, o GitHub, o Shopify ou o Slack
assinariam, direto para o receptor do seu app, e tenta de novo quando ele falha. Serve para testar a
verificação de assinatura, a idempotência e o que o app faz com a retentativa, sem depender do
provedor de verdade. Não passa pelo servidor do Anzol (não usa `--server`).

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

**Assinatura.** As mesmas fórmulas da [verificação de assinatura](#verificação-de-assinatura) do
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

### `anzol wait-for`

Para o teste de integração ou E2E do seu app: depois de disparar a ação que gera o webhook, espera
(com prazo) até a URL receber a requisição esperada, e diz por que não chegou quando falha. Usa o
[`requests/wait`](#esperar-por-mensagens) da API.

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
| `--match <json>` / `--match-file <arquivo>` | `{}` (casa qualquer mensagem) | O objeto `match` de uma [regra de resposta](#regras-de-resposta); um ou outro |
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

### Servidor

`--server <url>`, senão a variável `WEBHOOK_SERVER`, senão `http://localhost:8084`. Vale para `listen`,
`replay`, `rules` e `wait-for` (o `send` fala direto com o `--to`) e vem depois do subcomando: `anzol listen --server https://hooks.exemplo --forward …`,
`anzol rules pull <token> --server https://hooks.exemplo`. URL protegida: `--read-secret`, na mesma posição, ou
`WEBHOOK_READ_SECRET` (ver [Privacidade](#cli-e-mcp)).

### O que é reenviado

| Parte | Reenvio |
|---|---|
| Método | O gravado (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) |
| URL | `<forward>` sem a barra final + caminho depois do token + query como está na `url` gravada (o servidor grava a query com os pares em ordem alfabética) |
| Cabeçalhos | Os gravados, cada valor da lista, **menos** `connection`, `keep-alive`, `transfer-encoding`, `te`, `trailer`, `upgrade`, `proxy-*` (valem só para a conexão original), `host` (vira o do `--forward`), `content-length` (recalculado) e `expect` |
| Corpo | O `content` gravado, em UTF-8 |
| Multipart | Os campos de texto gravados, remontados com um boundary novo (que não aparece em nenhum campo) no `Content-Type` reenviado; nome escapado como o navegador faz (`"` CR LF → `%22` `%0D` `%0A`); arrays do PHP viram `campo[0]`, `campo[chave]` |

### Limitações

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

## Como testar

```bash
# Backend: testes (Redis em container, precisa de Docker), ktlint e detekt
cd backend && ./gradlew check

# Frontend: lint, testes unitários (Vitest) e build
cd frontend && npm ci && npx ng lint && npx ng test --watch=false && npx ng build

# E2E da tela (Playwright) contra o app no ar
cd frontend && npx playwright install chromium   # uma vez
BASE_URL=http://localhost:8084 npx playwright test

# Contrato caixa-preta da API e do evento contra o app no ar
cd tests/contract && npm ci && npx playwright test

# CLI: testes (servidor e app local falsos, sem Docker), ktlint e detekt
cd cli && ./gradlew check

# Aceite caixa-preta do CLI contra o app no ar (depois de cd cli && ./gradlew installDist)
cd tests/cli && node --test
```

Para mexer na tela com recarga automática, com o compose no ar: `cd frontend && npx ng serve`
abre em <http://localhost:4200> e encaminha a API para a porta 8084 (`proxy.conf.mjs`).

### CI local

O `./ci.sh` da raiz roda tudo o que está acima de uma vez. No GitHub, o workflow `testes`
(`.github/workflows/testes.yml`) roda a cada push e pull request só a parte sem stack (passo 1 abaixo: backend, CLI e
frontend); contrato, E2E e aceite do CLI ficam no `./ci.sh`.

```bash
./ci.sh
```

Precisa de Docker, Java 25 e Node 24 (confere no início e diz o que falta) e da porta 8088 livre.

1. **Sem stack:** `backend` → `./gradlew check`; `cli` → `./gradlew check installDist`;
   `frontend` → `npm ci`, `ng lint`, `prettier --check .`, `ng test --watch=false`, `ng build`.
2. **Stack isolado:** `docker compose -p webhookci` com o override `docker-compose.ci.yml` sobe o
   app na porta 8088, com Redis `webhookci-redis` e volume `webhookci_redis-data` próprios. O app da
   8084 e o Redis `anzol-redis` (dados reais) não são tocados.
3. **Integração contra a 8088:** contrato (`tests/contract`, `TETO_PADRAO=10000`), E2E da tela
   (`frontend/e2e`) e aceite do CLI (`tests/cli`, com o CLI do passo 1).
4. **Fim:** `down -v` do stack isolado (containers, rede, volume e imagem do app), também em falha ou
   Ctrl+C, e uma tabela etapa → OK/FALHOU/NÃO RODOU → tempo.

Uma etapa que falha não interrompe as seguintes; se o stack não sobe, as de integração aparecem
como NÃO RODOU. A saída é 0 só com tudo OK. Com os caches do Gradle, do npm e do Docker quentes, a
rodada inteira leva uns 2 minutos.

## Padrões de código

- Kotlin (`backend/` e `cli/`): [`docs/padroes-kotlin.md`](docs/padroes-kotlin.md)
- Angular: [`docs/padroes-angular.md`](docs/padroes-angular.md)

## Helm

O chart `anzol` em `helm/` sobe no Kubernetes o mesmo que o `docker-compose.yml`: o app (imagem
`ghcr.io/isdiegoalves/anzol`, porta 8080, uma réplica) e um Redis 8 como StatefulSet com PVC, `--maxmemory` e
`noeviction`, gravando o `dump.rdb` em `/data`. O workflow `imagem` (`.github/workflows/imagem.yml`) publica a imagem no
`ghcr.io`, para amd64 e arm64, a cada tag de versão `vX.Y.Z` enviada ao GitHub (tags `X.Y.Z`, `X.Y` e `latest`); informe
a tag publicada. Sem tag de versão publicada, construa com o `Dockerfile` da raiz e publique você mesmo.

```bash
helm install anzol ./helm -f valores.yaml
# chave da IA, se houver, sem passar por arquivo:
helm install anzol ./helm -f valores.yaml --set-string webhook.ai.apiKey="$WEBHOOK_AI_API_KEY"
```

Um `valores.yaml` mínimo para publicar atrás do ingress-nginx:

```yaml
image:
  tag: <tag publicada>
ingress:
  enabled: true
  hosts: [anzol.example.com]
  tls:
    - secretName: anzol-tls
      hosts: [anzol.example.com]
```

- **`WEBHOOK_ALLOWED_HOSTS`** é montado pelo chart: loopback (o `kubectl port-forward`), cada host de `ingress.hosts`
  (com `:443` os que têm TLS) e o que vier em `webhook.allowedHosts`. Um nome fora dessa lista abre a tela, mas a API
  responde 403 (ver [Proteção contra DNS rebinding/CSRF](#proteção-contra-dns-rebindingcsrf)); outro acesso que não o
  Ingress (um LoadBalancer, um DNS a mais) vai em `webhook.allowedHosts`.
- **Ingress**: os annotations do `values.yaml` são do ingress-nginx e são necessários: `proxy-buffering: "off"` para o
  SSE, `proxy-read-timeout` longo para o SSE, o `requests/wait` (até 300 s) e a IA (até 90 s), `proxy-body-size: 2m`
  para o app ser quem corta o corpo e `proxy-buffer-size: 64k` para os cabeçalhos das regras de resposta.
- **Redis externo**: `redis.external.host` (e `port`) no lugar do StatefulSet; a senha, se houver, vai em `extraEnv`
  como `SPRING_DATA_REDIS_PASSWORD` com `valueFrom.secretKeyRef`.
- **IA**: `webhook.ai.*`; a chave vem de um Secret (`webhook.ai.existingSecret`, ou o criado a partir de
  `webhook.ai.apiKey` na instalação), nunca em texto no Deployment nem num values versionado.
- **Observabilidade**: as variáveis `OTEL_*` da [Observabilidade](#observabilidade) vão no mapa `otel`.
- `webhook.outbound.allowPrivate` e `webhook.mcp.enabled` ficam `false` no chart: no cluster, o primeiro abre o replay e
  o send para o Redis e qualquer Service, e o MCP não tem autenticação.

Sem actuator, as probes usam `GET /` (o `index.html`, lido do jar). O container do app roda como o usuário `webhook`
(uid 999), sem privilégios e com o sistema de arquivos só-leitura, com um `emptyDir` em `/tmp` para o Tomcat e a JVM.
Cada opção está comentada em [`helm/values.yaml`](helm/values.yaml).
