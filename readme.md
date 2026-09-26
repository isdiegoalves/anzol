# Webhook.site

Gera uma URL única e aleatória que grava toda requisição HTTP recebida e a mostra na tela em
tempo real: método, cabeçalhos, query, corpo. Serve para testar e depurar webhooks e clientes
HTTP sem subir um servidor exposto à internet.

Este repositório é um fork do [webhook.site](https://github.com/fredsted/webhook.site) de
Simon Fredsted (licença MIT), reescrito sem mudança de comportamento:

| Parte | Stack | Pasta |
|---|---|---|
| API, webhook e tempo real (SSE) | Kotlin 2.4 + Spring Boot 4.1 + Java 25 | `backend/` |
| Tela | Angular 22 + Angular Material | `frontend/` |
| Armazenamento | Redis 8.10 (tokens expiram em 7 dias) | serviço `redis` do compose |
| Contrato caixa-preta da API e do evento | Playwright | `tests/contract/` |
| CLI de encaminhamento (`webhook listen`/`replay`) | Kotlin 2.4 + Java 25 + Clikt | `cli/` |

Uma imagem só (`Dockerfile` da raiz): o Node constrói o Angular, o Gradle embute o build no jar
e o Spring Boot serve a API e a tela na mesma porta.

## Como subir

```bash
docker compose up -d --build
```

Abra <http://localhost:8084>. Os dados do Redis ficam no volume `webhooksite_redis-data` e
sobrevivem a `docker compose down` (só `docker compose down -v` os apaga).

### Configuração

| Variável (serviço `app`) | Padrão | O que faz |
|---|---|---|
| `WEBHOOK_MAX_REQUESTS` | `10000` | Mensagens guardadas por URL sem limpeza automática (`auto_cleanup` nulo). Ao passar, a mais antiga sai; a URL nunca para de receber. Com `auto_cleanup`, vale o limite da URL |
| `WEBHOOK_EXPIRY` | `604800` | Segundos até um token e suas mensagens expirarem (renovado a cada uso) |

O Redis sobe com `--maxmemory 1gb --maxmemory-policy noeviction`: cheio, recusa gravação (o
webhook responde `507 Insufficient Storage`) em vez de apagar chaves, então nenhum token some e o que já está gravado
continua legível. Com mensagens de ~15 KB, 1 GB guarda cerca de 60 mil; `WEBHOOK_MAX_REQUESTS` e
`auto_cleanup` limitam cada URL. Mudar o `command` do Redis no compose recria o container, e os
dados ficam no volume.

## API

| Rota | O que faz |
|---|---|
| `POST /token` | Cria uma URL (`default_status`, `default_content`, `default_content_type`, `timeout` 0–10 s, `retry_after`, `auto_cleanup`, `signature`, `schema`) |
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
| `GET`/`DELETE /token/{id}/scenarios` | Lista os cenários das regras com o estado atual, ou volta todos a `Started` |
| `PUT /token/{id}/scenarios/{name}` | Define à mão o estado de um cenário (`{"state": "..."}`) |

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

`POST /token/{id}/rules/test` recebe uma regra (mesma validação, chaves sem o índice), ignora `enabled`
e responde `{"matches": [{uuid, seq}], "misses": [{uuid, seq, failed}]}` sobre as 500 mensagens mais
recentes, da mais nova para a mais antiga. As condições de assinatura e de schema usam o `signature` e o
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
  "near_miss": { "uuid": "bbe0…", "seq": 1790438428567114, "failed": ["method: expected DELETE, got POST"] } }
```

`requests` traz as `count` mensagens que casaram de menor `seq`, em ordem crescente e completas (como
no `GET /token/{id}/request/{requestId}`); sem sucesso, as que casaram até ali. `near_miss` só aparece
com `matched: false`: entre as mensagens avaliadas que não casaram, a de menos condições falhando
(empate: a mais nova), com as frases do `near_miss` das regras; `null` se nenhuma foi avaliada.

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

O comportamento exato (status, erros, limpeza automática e corpo de até 1 MiB) está descrito em
[`tests/contract/README.md`](tests/contract/README.md). A coleção `webhook-paw.paw` (Paw) tem
exemplos das mesmas rotas.

## CLI

Entrega os webhooks que chegam na URL direto no app que você está desenvolvendo, como o
`stripe listen`: sem aba aberta e sem CORS.
Também baixa e sobe as [regras de resposta](#regras-de-resposta) da URL como arquivo JSON.
Com o `send`, faz o papel do provedor: dispara webhooks assinados, com retentativas, para o seu app.
Com o `wait-for`, um teste automatizado espera o webhook chegar, sem `sleep`.

### Instalar

Precisa do Java 25.

```bash
cd cli && ./gradlew installDist
# o script fica em cli/build/install/webhook/bin/webhook; ponha a pasta bin no PATH ou chame pelo caminho
```

### `webhook listen`

```bash
webhook listen --forward http://localhost:3000             # cria uma URL nova e a mostra
webhook listen --forward http://localhost:3000 --token <uuid>   # usa uma URL que já existe
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

### `webhook replay`

```bash
webhook replay <token> <requestId> --to http://localhost:3000
```

Reenvia uma mensagem gravada, igual ao `listen`, e imprime a mesma linha. Sai com 0 quando o app
local respondeu (qualquer status) e com 1 em `error:`, `Token not found` ou `Request not found`.

### `webhook rules pull` e `webhook rules push`

```bash
webhook rules pull <token>                     # a lista de regras no stdout
webhook rules pull <token> --file regras.json  # no arquivo (o stdout fica vazio)
webhook rules push <token> regras.json         # troca a lista inteira da URL pela do arquivo
```

O `pull` escreve a lista como o `GET /token/{id}/rules` a devolve, em JSON indentado com 2 espaços,
UTF-8 e quebra de linha final, o mesmo formato do Export da tela. O `push` manda o arquivo no
`PUT /token/{id}/rules` (a lista inteira: regra que não está no arquivo deixa de existir, e `[]`
apaga todas) e imprime `Pushed <n> rule(s)`. Regra com `id` o mantém; sem `id`, o servidor gera um.
Ida e volta `pull` → `push` → `pull` dá o mesmo arquivo.

```
$ webhook rules push 9f3c…e21a regras.json
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

### `webhook send`

Simula o provedor: dispara webhooks assinados como o Stripe, o GitHub, o Shopify ou o Slack
assinariam, direto para o receptor do seu app, e tenta de novo quando ele falha. Serve para testar a
verificação de assinatura, a idempotência e o que o app faz com a retentativa, sem depender do
provedor de verdade. Não passa pelo servidor do webhook.site (não usa `--server`).

```bash
# Stripe: 3 retentativas com backoff exponencial (1 s, 2 s, 4 s), Idempotency-Key igual em todas
webhook send --to http://localhost:3000/webhooks/stripe \
  --provider stripe --secret whsec_teste \
  --header "Content-Type: application/json" --header "Idempotency-Key: {{uuid}}" \
  --data '{"id":"evt_{{random 24}}","type":"payment_intent.succeeded","created":{{timestamp}}}' \
  --retries 3

# GitHub: corpo de um arquivo, 5 eventos com meio segundo entre eles
webhook send --to http://localhost:3000/webhooks/github \
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
servidor: uma URL do webhook.site configurada com o mesmo provedor e segredo grava `valid: true`.

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

### `webhook wait-for`

Para o teste de integração ou E2E do seu app: depois de disparar a ação que gera o webhook, espera
(com prazo) até a URL receber a requisição esperada, e diz por que não chegou quando falha. Usa o
[`requests/wait`](#esperar-por-mensagens) da API.

```bash
# um POST em /pedidos… com status "pago" no corpo JSON, em até 10 s; as mensagens vão para o jq
webhook wait-for --token <uuid> --method POST --path /pedidos --json-path '$.status="pago"' --timeout 10000 | jq '.[0].content'

# 3 webhooks que casam o match de uma regra (inline ou de arquivo), só os que chegarem daqui em diante
webhook wait-for --token <uuid> --match-file match.json --count 3 --new
```

```
$ webhook wait-for --token 9f3c…e21a --method DELETE --path /evento/2 --timeout 1500
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
`replay`, `rules` e `wait-for` (o `send` fala direto com o `--to`) e vem depois do subcomando: `webhook listen --server https://hooks.exemplo --forward …`,
`webhook rules pull <token> --server https://hooks.exemplo`.

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

Não há pipeline remoto: o CI é o `./ci.sh` da raiz, que roda tudo o que está acima de uma vez.

```bash
./ci.sh
```

Precisa de Docker, Java 25 e Node 24 (confere no início e diz o que falta) e da porta 8088 livre.

1. **Sem stack:** `backend` → `./gradlew check`; `cli` → `./gradlew check installDist`;
   `frontend` → `npm ci`, `ng lint`, `prettier --check .`, `ng test --watch=false`, `ng build`.
2. **Stack isolado:** `docker compose -p webhookci` com o override `docker-compose.ci.yml` sobe o
   app na porta 8088, com Redis `webhookci-redis` e volume `webhookci_redis-data` próprios. O app da
   8084 e o Redis `webhook-redis` (dados reais) não são tocados.
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

O chart em `helm/` está desatualizado: ainda descreve a stack antiga (imagens upstream
`webhooksite/webhook.site` e `webhooksite/laravel-echo-server`, `redis:alpine`). Serve só
como ponto de partida; o app roda com o `docker-compose.yml`.
