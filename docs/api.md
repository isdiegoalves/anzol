# API

O documento [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) da API está em `GET /openapi.yaml` e
`GET /openapi.json` (fonte: `backend/src/main/resources/openapi/anzol.yaml`, escrito à mão, porque as rotas leem o
corpo direto da requisição, como o app antigo). Serve para importar no Insomnia ou no Postman, gerar cliente e testar
com ferramentas como o Schemathesis. Testes garantem que ele não se afasta do código: toda rota do Spring está nele e
ele não tem rota a mais, ele valida contra o schema oficial do OpenAPI 3.1, e o contrato confere as respostas reais
contra os schemas dele.

| Rota | O que faz |
|---|---|
| `POST /token` | Cria uma URL (`default_status`, `default_content`, `default_content_type`, `timeout` 0–10 s, `retry_after`, `auto_cleanup`, `signature`, `schema`, `e2ee`, `read_secret`) |
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
| `POST /token/{id}/rules/suggest` | Regra de resposta a partir de uma descrição em linguagem natural, validada e **não gravada** (ver [IA local](mcp-e-ia.md#ia-local)) |
| `POST /token/{id}/request/{requestId}/explain` | Explica em texto por que a assinatura, o schema e as regras deram o resultado que deram numa mensagem (ver [IA local](mcp-e-ia.md#ia-local)) |
| `POST /token/{id}/unlock`, `POST /token/{id}/lock` | Desbloqueia no navegador uma URL protegida pelo segredo de leitura (cookie) e bloqueia de novo (ver [Privacidade](privacidade.md#privacidade)) |
| `POST /token/{id}/request/{requestId}/share` | Link só-leitura de uma mensagem, com expiração e máscara dos valores sensíveis (ver [Links só-leitura](privacidade.md#links-só-leitura)) |
| `GET /token/{id}/shares`, `DELETE /token/{id}/shares/{sid}` | Lista os links ativos da URL; revoga um |
| `GET /share/{sid}` | O link público: a mensagem, sem credencial nenhuma |
| `POST /token/{id}/keys`, `DELETE /token/{id}/keys/{kid}` | Gera (até duas) ou apaga uma chave de cifra da URL (ver [Decifra de atributo](#decifra-de-atributo-e2ee)) |
| `GET /token/{id}/jwks.json` | As chaves públicas de cifra da URL, sem credencial nenhuma |
| `POST /e2ee-lab`, `GET /e2ee-lab/scenarios` | Cria uma URL de laboratório E2EE pronta; lista os 27 cenários (ver [Laboratório E2EE](#laboratório-e2ee)) |
| `POST /token/{id}/e2ee-lab/run` | Roda os cenários numa URL de laboratório e compara com o esperado |

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

## Verificação de assinatura

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

## Validação de schema

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

## Decifra de atributo (E2EE)

Com `e2ee`, a URL abre um atributo do corpo que chega cifrado do remetente até esta URL: o remetente assina o
objeto (JWS) e cifra a assinatura para a chave pública da URL (JWE). **A ponta que abre é o servidor do Anzol**:
ele guarda a chave privada da URL, decifra na chegada e grava o valor decifrado na mensagem, atrás do segredo de
leitura (ver [onde o valor decifrado fica](#onde-o-valor-decifrado-fica)). O resto do envelope fica em claro, e a
assinatura HMAC da URL, quando configurada, é conferida **antes** da decifra, sobre o corpo como chegou. O formato aceito é
este:

| Camada | Formato |
|---|---|
| Externa | JWE compacto de até 256 KiB, `alg=ECDH-ES` (acordo direto), `enc=A256GCM`, `epk` na P-256, `kid` de uma chave de cifra da URL, `cty=JWT`, sem `zip` |
| Interna | JWS compacto, `alg=ES256`, `kid` de uma chave de `trusted_signers`; claims obrigatórios `aud`, `jti`, `iat`, `evt`, `app` e `data` (o objeto original do atributo) |

O formato é fixo e só este é aceito. Não servem: outro `alg` ou `enc` (`RSA-OAEP`, `ECDH-ES+A256KW`…), JWE sem JWS
dentro, JWS `HS256` ou `none`, mensagem sem `evt` ou `app`. `iss`, `exp` e `nbf` não são conferidos.

```json
{ "read_secret": "…", "e2ee": {
    "path": "$.payload", "required": true, "audience": "anzol-lab",
    "bindings": { "jti": "$.eventId", "evt": "$.tipoEvento.nome",
                  "app": { "path": "$.servico.nome", "ignore_case": true } },
    "max_age_seconds": 43200,
    "trusted_signers": [ { "kty": "EC", "crv": "P-256", "kid": "remetente-sig-1", "x": "…", "y": "…" } ] } }
```

Uma mensagem para essa política (ilustrativa, com o JWE cortado):

```json
{ "eventId": "256335e6-4c90-4b82-831f-f0e4da94239b",
  "tipoEvento": { "nome": "PEDIDO_CRIADO" },
  "servico": { "nome": "servico-exemplo" },
  "payload": "eyJhbGciOiJFQ0RILUVTIiwiZW5jIjoiQTI1NkdDTSIsImN0eSI6IkpXVCIsImtpZCI6ImVuYy12MSIsImVwayI6eyJrdHkiOiJFQyIs…" }
```

O `payload` é o JWE; dentro dele, o JWS com `{"aud": "anzol-lab", "jti": "256335e6-…", "iat": 1791499538,
"evt": "PEDIDO_CRIADO", "app": "servico-exemplo", "data": { … }}`. `jti`, `evt` e `app` repetem `eventId`,
`tipoEvento.nome` e `servico.nome` do envelope: é o que os `bindings` conferem.

| Campo | Valor |
|---|---|
| `path` | JSONPath definido (sem filtro nem curinga) do atributo cifrado no envelope |
| `required` | padrão `true`: o atributo que não é JWE é uma falha (`downgrade`), nunca texto aceito; `false` deixa passar como `absent` |
| `audience` | o `aud` que o JWS tem de ter (texto, ou lista que o contenha) |
| `bindings` | onde o envelope em claro guarda o que `jti`, `evt` e `app` do JWS têm de repetir: o JSONPath (comparação exata) ou `{path, ignore_case}` |
| `max_age_seconds` | 60 a 604800 (padrão 43200, 12 h): idade máxima do `iat`; até 5 minutos no futuro é aceito |
| `trusted_signers` | 1 a 10 JWKs **públicas** EC P-256 de assinatura ES256, com `kid` único; `alg` (se houver) `ES256`, `use` (se houver) `sig`. Vale a chave gerada fora do Anzol (Java, Insomnia) como ela vem |

Ligar `e2ee` exige `read_secret` na URL, e remover o segredo com ela ligada é recusado. Remover o segredo também é
recusado (422 em `read_secret`) enquanto alguma mensagem da URL tiver `decrypted`, mesmo com a decifra já desligada:
apague essas mensagens antes (`DELETE /token/{id}/request/{rid}`, ou todas com `DELETE /token/{id}/request`). Assim
o texto aberto nunca fica à vista de quem só tem a URL. No `PUT`, `e2ee` ausente ou `null` desliga a decifra, como os demais
campos. JWK com a parte privada `d`, fora da P-256, com o ponto fora da curva, sem `kid` ou com `kid` repetido
dá 422 com a chave em pontos (`e2ee.trusted_signers.0`). A política só tem chaves públicas: nada nela é segredo.

**Chaves de cifra.** `POST /token/{id}/keys` (`{"kid": "…"}` opcional, 1 a 64 letras, dígitos, `.`, `_` ou
`-`; sem ele, `enc-<AAAAMMDD>-<4 hex>`) gera um par EC P-256 no servidor e devolve `201`
`{kid, created_at, jwk}` só com a pública (`use=enc`, `alg=ECDH-ES`). A URL tem no máximo duas, para a rotação:
gere a nova, troque o remetente e apague a antiga com `DELETE /token/{id}/keys/{kid}` (`204`; `404` sem ela);
a mensagem cifrada para a antiga abre enquanto ela existir. A privada fica em claro no Redis (e no backup do
volume): nenhuma rota, ferramenta do MCP ou log a devolve, e quem lê o Redis a tem. As chaves ficam na URL até
alguém apagá-las: desligar a decifra ou remover o segredo não as remove, e o `jwks.json` continua publicando as
públicas. O token lista as chaves em `e2ee_keys` e `GET /token/{id}/jwks.json` publica as
públicas sem pedir o segredo de leitura, como todo JWKS.

Toda mensagem traz `decryption`: `null` sem `e2ee` na URL, senão
`{state, kid, signature_kid, reason, jti, duplicate_of}`. Quando `valid`, a mensagem traz também `decrypted`
(o claim `data`); o `content` fica como chegou. A conferência segue esta ordem e para na primeira falha:

| Passo | `state` / `reason` |
|---|---|
| A assinatura HMAC da URL (quando configurada) não é válida | `invalid` / `hmac_failed` (sem decifrar) |
| Corpo que não é JSON; atributo ausente; atributo que não é JWE | `invalid` / `body_not_json`, `attribute_missing`, `downgrade` (com `required: false`, `absent`) |
| Cabeçalho do JWE, conferido antes de decifrar | `invalid` / `too_large` (acima de 256 KiB), `malformed_jwe`, `alg_not_allowed`, `enc_not_allowed`, `zip_present`, `kid_missing`, `cty_not_jwt`, `epk_invalid`, `epk_off_curve` |
| `kid` que a URL não tem | `unknown_kid` |
| Decifra | `invalid` / `decrypt_failed` |
| JWS de dentro | `invalid` / `jws_missing`, `jws_alg_not_allowed` (`none`, `HS256`…), `signer_unknown`, `signature_invalid`, `claims_malformed` |
| Claims contra a URL e o envelope | `invalid` / `aud_mismatch`, `jti_mismatch`, `evt_mismatch`, `app_mismatch`, `iat_missing`, `iat_outside_window`, `data_missing` |

A origem é o `signature_kid`, a chave de `trusted_signers` que assinou; o `iss` não é conferido. A reentrega
de um `jti` já decifrado (dentro da janela do `iat`) continua `valid` e leva em `duplicate_of` o uuid da primeira
mensagem. O Anzol não muda o status sozinho: a resposta sai das [regras](#regras-de-resposta), com
`match.decryption`. O laboratório responde 500 ao `kid` desconhecido (um remetente que trata 5xx como temporário tenta de
novo) e 400 à cifra inválida (não tenta), e nunca usa `fault` nessa URL, porque o teto de conexões presas responde 503:

```json
[ { "name": "kid desconhecido", "match": { "decryption": "unknown_kid" }, "response": { "status": 500 } },
  { "name": "cifra inválida",   "match": { "decryption": "invalid" },     "response": { "status": 400 } } ]
```

`decrypted` sai só para quem tem o segredo de leitura: no `GET` da mensagem, na listagem, na busca e no `requests/wait`.
O link só-leitura, o evento `request.created` e as ferramentas do MCP levam `decryption` e nunca `decrypted`, e
a IA local não o recebe.

### Onde o valor decifrado fica

Quando `valid`, o claim `data` é gravado **em claro** no campo `decrypted` da mensagem, no Redis
(`token:{id}:requests`), junto da chave privada de cifra (`token:{id}`) e do segredo HMAC; tudo isso vai para o
`dump.rdb` do volume e para qualquer backup dele. Fica enquanto a mensagem existir: até a limpeza (`auto_cleanup`), o
teto (`ANZOL_MAX_REQUESTS`), a expiração da URL ou até alguém apagar a mensagem ou a URL. O segredo de leitura protege
a leitura pela API e pela tela, não o armazenamento: quem opera o servidor, o Redis ou o backup vê o valor; o Anzol
não cifra o Redis.

### Laboratório E2EE

`POST /e2ee-lab` cria uma URL **nova** pronta para testar a decifra: segredo de leitura e de HMAC gerados e
devolvidos só nesta resposta (`read_secret`, `hmac_secret`), as chaves de cifra `enc-v1` e `enc-v2`, um remetente de
teste `lab-sig-1` (a privada fica no Redis da URL e some com ela), a política com o envelope neutro (`$.payload`,
`$.eventId`, `$.tipoEvento.nome`, `$.servico.nome` sem caixa, `aud` `anzol-lab`), HMAC genérico (sha256, hex) no
cabeçalho `hmac_header` (padrão `X-Signature`) e as regras do laboratório: assinatura HMAC inválida ou ausente → 401,
`unknown_kid` → 500, outra falha da decifra → 400, o resto 202. O corpo é opcional:
`{hmac_header?, path?, bindings?, audience?, max_age_seconds?, trusted_signers?}`, com caminhos simples (`$.a.b`) e
as JWKs públicas de outros remetentes antes da de teste. A URL tem a marca `lab` (`{signer_kid, expires_at}` no
token), que nenhuma rota troca; vive 24 h sem renovar com o uso, e o servidor aceita até 20 ativas (422 em `lab`).

`POST /token/{id}/e2ee-lab/run` (`{"scenarios"?: ["P1", "N4", …]}`; sem a lista, todos) gera cada vetor com as
chaves e o remetente de teste da URL, entrega pela captura de verdade e compara status, estado e motivo:
`{total, matched, results: [{code, description, expected, actual: {status, state, reason, kid, data_matches},
ok, request_id}]}`. Só numa URL `lab` (422 nas demais), até seis rodadas por minuto por URL (429). O relatório não
traz o texto aberto; `data_matches` diz se o `data` aberto é igual ao enviado. `GET /e2ee-lab/scenarios` lista o
catálogo com o esperado da política padrão:

| Código | Cenário | Esperado |
|---|---|---|
| P1, P2, P3, P3b, P5 | ida e volta, rotação (cifrado para `enc-v1` com `enc-v2` ativa), acento e emoji, números exatos, `app` com outra caixa | 202 `valid` (P5: `app_mismatch` se o `app` não ignora caixa) |
| N1a, N1b, N1c | JWE sem JWS, signatário desconhecido, `kid` confiável com outra chave | 400 `jws_missing`, `signer_unknown`, `signature_invalid` |
| N2, N3, N4 | ciphertext de outra mensagem, objeto em claro, `kid` que a URL não tem | 400 `jti_mismatch`, 400 `downgrade`, 500 `unknown_kid` |
| N5a, N5b, N5c, N6 | `ECDH-ES+A256KW`, `A128CBC-HS256`, `zip=DEF`, `epk` fora da curva | 400 `alg_not_allowed`, `enc_not_allowed`, `zip_present`, `epk_off_curve` |
| N7a, N7b | HMAC com outro segredo, corpo alterado depois do HMAC | 401 `hmac_failed` |
| N11a, N11b | JWS `alg=none`, `HS256` | 400 `jws_alg_not_allowed` |
| Xa…Xh | `app`, `aud` e `evt` (caixa) divergentes; JWE sem `cty`; JWS sem `data`; `iat` velho; JWE sem `kid`; JWE acima de 256 KiB | 400 com o motivo de cada um (Xe: `valid` se o `evt` ignora caixa) |

## Regras de resposta

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
| `match.decryption` | `valid`, `invalid`, `unknown_kid` ou `absent` (o `decryption.state` da [decifra de atributo](#decifra-de-atributo-e2ee)). URL sem `e2ee` não casa nenhum dos quatro. Ausente ou `null`: qualquer; o `GET` só mostra a chave quando há condição |
| `match.body` | lista de condições com um de `equals`, `contains`, `regex`, `jsonPath: {path, equals?}` (sem `equals`, basta existir) ou `equalToJson` (objeto, ou texto com o JSON; ignora ordem de chaves e compara números pelo valor) |
| `scenario` | `{name, requiredState?, newState?}` (ver [Cenários](#cenários)) |
| `chance`, `active_from`, `active_until` | a regra vale só para uma porcentagem das requisições ou só numa janela de tempo (ver [Atrasos e falhas de rede](#atrasos-e-falhas-de-rede)); ausentes, não aparecem no `GET` |
| `response` | `status` 100–599 (padrão 200), `headers` texto → texto, `body` texto (padrão `""`), `template` booleano (padrão `false`), `delay`, `dribble` e `fault` (ver [Atrasos e falhas de rede](#atrasos-e-falhas-de-rede)) |

Todas as condições valem em E, e uma regra sem condições casa tudo. `regex` é a sintaxe do Java e
precisa casar o valor inteiro (`.` atravessa linhas). JSONPath segue a
[Jayway](https://github.com/json-path/JsonPath): `equals` aceita qualquer valor JSON, e texto casa
também número ou booleano de mesmo texto.

### Template

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

### Cenários

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

### Atrasos e falhas de rede

Para testar o timeout, a retentativa e o tratamento de erro de quem envia o webhook:

| Campo de `response` | Efeito |
|---|---|
| `delay` | espera antes de responder: `{"fixed": ms}`, `{"uniform": {"min": ms, "max": ms}}` (inteiros, sorteio no intervalo fechado) ou `{"lognormal": {"median": ms, "sigma": s}}` (mediana 1–60000, sigma 0–10, cortado em 60 s). Teto 60000 ms |
| `dribble` | `{"chunks": 1..100, "durationMs": 0..60000}`: status e cabeçalhos na hora e o corpo dividido em `chunks` pedaços, um a cada `durationMs / chunks` ms, com flush (`Transfer-Encoding: chunked`) |
| `fault` | a conexão falha no lugar da resposta: `connection_reset` (RST TCP), `empty_response` (fecha sem mandar nenhum byte), `malformed_chunk` (`HTTP/1.1 200 OK` chunked com um tamanho de chunk inválido, e fecha), `random_data_then_close` (1 KiB aleatório, e fecha) |
| `fault: "hang"` | lê a requisição e não manda nenhum byte até o cliente desistir (percebido em até 5 s) ou até o teto `ANZOL_FAULT_HOLD_MAX` (padrão 300 s), e fecha: testa o timeout de leitura (socket) de quem envia |
| `fault: "stall_after_headers"` | manda o `status` e os `headers` da regra, com o `Content-Length` do `body`, e nenhum byte do corpo; fica presa como no `hang` |
| `fault: "truncated_body"` | manda o `status`, os `headers` com o `Content-Length` do `body` inteiro e a primeira metade do corpo, e fecha: quem envia vê o corpo acabar antes da hora |

A mensagem é gravada (e o evento sai) antes do atraso e da falha: ela aparece na tela enquanto o
cliente ainda espera. Com `fault`, `delay` e `dribble` são ignorados; `status`, `headers` e `body` (com o template,
se ligado) só valem em `stall_after_headers` e `truncated_body`, que exigem `body` não vazio (senão 422 em
`response.body`). O atraso e a conexão presa ocupam só uma thread virtual. `hang` e `stall_after_headers` prendem
no máximo 16 conexões por URL e 128 no servidor; acima disso a resposta é 503 com `X-Fault-Limit`
(`16 held connections on this URL` ou `128 held connections on this server`), e a mensagem é gravada com a regra e
`response: {"status": 503}`. As falhas são feitas no conector do Tomcat (`LegacyHttpProtocol`),
abaixo do HTTP: o Tomcat não escreve nada depois delas e a conexão não é reaproveitada. O RST chega
ao cliente em até cerca de 1 s (o NIO do Java fecha o socket com `SO_LINGER 0` na volta seguinte do
seletor do Tomcat).

**Connect timeout.** O SYN sem resposta não é simulado: atrás do encaminhador de porta do Docker a conexão é
sempre aceita. Para testar o timeout de conexão de quem envia, aponte-o para um endereço que não responde ao SYN,
ex. `http://10.255.255.1/` numa rede em que esse endereço não existe (`curl --connect-timeout 3 http://10.255.255.1/`
desiste em 3 s). O `hang` cobre o timeout de leitura.

**Falha por sorteio e por janela.** Para falhar só em parte das requisições ou só por um tempo, a regra (no nível de
`enabled`, não dentro de `response`) aceita:

| Campo da regra | Efeito |
|---|---|
| `chance` | inteiro 1–100: a regra responde a essa porcentagem das requisições em que todo o resto casou; nas outras, a avaliação segue para a próxima regra como se ela não casasse, e o cenário dela não muda. O sorteio é fixo por mensagem e regra: a captura, o `near_miss`, o trace e o `rules/test` com a regra salva dão o mesmo número. Ausente ou `null`: sempre |
| `active_from`, `active_until` | data-hora ISO-8601 com fuso (`Z` ou `-03:00`; fração aceita): a regra só vale para as mensagens que chegaram de `active_from` (inclusive) até `active_until` (exclusive), pelo `created_at`. Voltam em UTC, cortadas no segundo (`2026-09-29T12:00:00Z`); `active_until` tem de ser depois de `active_from`. Ausente ou `null`: sem limite desse lado |

```json
{
  "name": "instável na manutenção",
  "chance": 30,
  "active_from": "2026-09-29T09:00:00-03:00",
  "active_until": "2026-09-29T09:30:00-03:00",
  "match": { "method": ["POST"], "path": { "equals": "/pagamentos" } },
  "response": { "status": 503, "headers": { "Retry-After": "5" } }
}
```

Regra sem esses campos volta no `GET` sem as chaves e responde como antes. Barrada pela janela ou pelo sorteio,
ela aparece no `near_miss` e no trace com `window: opens at 2026-09-29T12:00:00Z, received at 2026-09-29T11:59:30Z`,
`window: closed at …` ou `chance 30%: rolled 57, not applied`; o sorteio só acontece quando todo o resto casou.

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
| `match.method`, `match.path`, `match.signature`, `match.schema`, `match.decryption` | a condição de mesmo nome |
| `match.query.<nome>`, `match.headers.<nome>` | o parâmetro ou cabeçalho, com o nome escrito como na regra (a frase usa o cabeçalho em minúsculas) |
| `match.body.<i>` | a condição de índice `i` (a partir de 0) em `match.body` |
| `scenario` | o estado do cenário (ver [Cenários](#cenários)) |
| `active_from`, `active_until`, `chance` | a janela e o sorteio (ver [Atrasos e falhas de rede](#atrasos-e-falhas-de-rede)) |

Mensagem gravada antes de `conditions` traz `conditions: null`: a chave não é reconstruída, porque a regra pode ter
mudado desde então. O link só-leitura mostra `conditions` como gravado (não carrega valores).

`POST /token/{id}/rules/test` recebe uma regra (mesma validação, chaves sem o índice), ignora `enabled`
e responde `{"matches": [{uuid, seq}], "misses": [{uuid, seq, failed, conditions}]}` sobre as 500 mensagens mais
recentes, da mais nova para a mais antiga (`conditions` como no `near_miss`, sem `scenario`). As condições de assinatura e de schema usam o `signature` e o
`schema` gravados em cada mensagem (a verificação da época em que chegou).

As regras ficam em `token:{uuid}:rules`, com o TTL da URL (renovado a cada webhook), e saem junto com
ela no `DELETE /token/{id}`.

## Esperar por mensagens

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
| `match` | o `match` de uma regra (`method`, `path`, `query`, `headers`, `body`, `signature`, `schema`, `decryption`; ver [Regras de resposta](#regras-de-resposta)), com a mesma validação. Ausente: casa qualquer mensagem |
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

## Buscar mensagens

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

## Estatísticas da URL

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

## Reenvio e envio pelo servidor

> **Aviso de SSRF.** Aqui o servidor abre conexão para uma URL escolhida por quem usa a API. Com
> `ANZOL_OUTBOUND_ALLOW_PRIVATE=true` (o `docker-compose.yml` local) ele alcança a sua máquina e a rede privada em
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

Com `ANZOL_OUTBOUND_LOCALHOST_ALIAS`, alvo cujos IPs são todos loopback (`localhost`, `127.0.0.1`, `[::1]`) vai
para o alias, que aparece em `target`: dentro do container, o `localhost` é o do container, não o do Mac.

O comportamento exato (status, erros, limpeza automática e corpo de até 1 MiB) está descrito em
[`tests/contract/README.md`](../tests/contract/README.md).
