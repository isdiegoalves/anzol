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
| `POST /token` | Cria uma URL (`default_status`, `default_content`, `default_content_type`, `timeout` 0–10 s, `retry_after`, `auto_cleanup`) |
| `GET`/`PUT`/`DELETE /token/{id}` | Lê, edita, apaga a URL (com as mensagens dela) |
| `PUT /token/{id}/cors/toggle` | Liga/desliga os cabeçalhos CORS na resposta do webhook |
| `ANY /{id}[/{status}][/...]` | O webhook: grava a requisição e responde com o padrão da URL |
| `GET /token/{id}/requests` | Lista as mensagens (`page`, `per_page`, `sorting=oldest\|newest`); com `after=<seq>`, as mensagens de `seq` maior, da mais antiga para a mais nova, até `per_page` |
| `GET`/`DELETE /token/{id}/request/{requestId}` | Lê ou apaga uma mensagem; `.../raw` devolve o corpo cru |
| `DELETE /token/{id}/request` | Apaga todas as mensagens |
| `GET /token/{id}/stream` | SSE: um evento `request.created` a cada mensagem gravada (`removed` lista as que a limpeza tirou) |
| `GET`/`PUT /token/{id}/rules` | Lê ou substitui a lista de regras de resposta da URL (o `PUT` é também o import) |
| `POST /token/{id}/rules/test` | Testa uma regra contra as 500 mensagens mais recentes |
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
| `{{jsonPath request.body '$.x'}}` | valor no corpo JSON; objeto ou lista saem como JSON. Só caminho simples (propriedade, índice, `*`, união e fatia): busca profunda (`..`), filtro (`[?(…)]`) e função (`.length()`) dão 422 ao salvar e, se o caminho vier da requisição, deixam o trecho vazio |
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
`body $.status: expected "pago", got "pendente"`); `null` quando respondeu uma regra ou não há regra
ativa. Mensagens gravadas antes das regras trazem os dois nulos.

`POST /token/{id}/rules/test` recebe uma regra (mesma validação, chaves sem o índice), ignora `enabled`
e responde `{"matches": [{uuid, seq}], "misses": [{uuid, seq, failed}]}` sobre as 500 mensagens mais
recentes, da mais nova para a mais antiga.

As regras ficam em `token:{uuid}:rules`, com o TTL da URL (renovado a cada webhook), e saem junto com
ela no `DELETE /token/{id}`.

O comportamento exato (status, erros, limpeza automática e corpo de até 1 MiB) está descrito em
[`tests/contract/README.md`](tests/contract/README.md). A coleção `webhook-paw.paw` (Paw) tem
exemplos das mesmas rotas.

## CLI

Entrega os webhooks que chegam na URL direto no app que você está desenvolvendo, como o
`stripe listen`: sem aba aberta e sem CORS.

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

### Servidor

`--server <url>`, senão a variável `WEBHOOK_SERVER`, senão `http://localhost:8084`. Vale para os
dois comandos e vem depois do subcomando: `webhook listen --server https://hooks.exemplo --forward …`.

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
