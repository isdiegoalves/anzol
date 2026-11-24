# Solução de problemas

[![English](https://img.shields.io/badge/English-6B737C?style=flat-square)](en/troubleshooting.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-1B5A68?style=flat-square)](solucao-de-problemas.md)

Os erros e os comportamentos estranhos do Anzol, reunidos por tema, para quem travou num deles. É uma página de como
fazer: cada linha diz o que você vê, por que acontece e o que fazer, e termina no link da seção que detalha.

**Nesta página:** [Captura e leitura](#captura-e-leitura) · [Resposta e regras](#resposta-e-regras) ·
[Assinatura, schema e decifra](#assinatura-schema-e-decifra) · [CLI](#cli) · [MCP e IA local](#mcp-e-ia-local) ·
[Laboratório de defesa](#laboratório-de-defesa) · [Servidor e operação](#servidor-e-operação)

## Captura e leitura

O que acontece quando uma requisição chega à URL, ou quando você lê a URL pela tela ou pela API.

| O que você vê | Por que acontece | O que fazer |
|---|---|---|
| `410` com `Token not found` no webhook ou numa rota `/token/{id}/...`; a tela mostra "Esta URL não existe mais" | A URL foi apagada, ou expirou: 7 dias sem uso, no padrão (`ANZOL_EXPIRY`), com o prazo renovado a cada uso | A tela oferece "Criar uma URL nova". [Configuração](operacao.md#configuração) |
| `401 {"error":"This URL is protected","protected":true}` numa rota `/token/{id}/...` | A URL tem segredo de leitura, e a chamada veio sem acesso. A captura `/{id}/...` não muda | Mande o cabeçalho `X-Anzol-Secret: <segredo>` (CLI, scripts), ou desbloqueie a URL na tela (cookie). [Segredo de leitura](privacidade.md#segredo-de-leitura) |
| `429` com `Retry-After` e `Too many wrong secrets for this URL; try again later`; a tela diz "Tentativas demais. Tente de novo em …" | Mais de 10 segredos errados por minuto na URL, unlock e cabeçalho somados (o MCP tem contador próprio). O `429` vale também para o segredo certo | Espere o `Retry-After`, até o minuto acabar. O cookie de desbloqueio não passa por esse limite. [Segredo de leitura](privacidade.md#segredo-de-leitura) |
| A tela diz "Sem sinal do servidor desde …. A lista pode estar incompleta." | O servidor parou de mandar o `ping` que o stream traz a cada 15 s | A tela reconecta sozinha: mostra "Nova tentativa em … s" e o botão "Tentar agora". [Requisições](api.md#requisições) |
| `GET /share/{sid}` responde `404`; a tela mostra "Este link não está disponível" | O link expirou, foi revogado, é de requisição ou de URL apagada, ou não existe. Definir, trocar ou remover o segredo de leitura revoga todos os links da URL | "Peça um link novo a quem o compartilhou." (tela). [Links só-leitura](privacidade.md#links-só-leitura) |
| `507` com `Storage is full; the request was not stored.`; a tela diz "O armazenamento está cheio desde …: requisições novas estão sendo recusadas." | O Redis chegou ao `--maxmemory 1gb` com `noeviction`: recusa gravar em vez de apagar chaves. O que já está gravado continua legível | `ANZOL_MAX_REQUESTS` e `auto_cleanup` limitam cada URL. Liberada a memória, o aviso fica até uma requisição ser gravada e 30 s passarem sem outra recusa; aí a tela diz "Voltou a gravar." [Memória do Redis](operacao.md#memória-do-redis) |
| Página HTML `413 Request Entity Too Large` | O corpo da requisição passou de 1 MiB | O limite é 1 MiB; `POST /token/{id}/send` aceita até 2 MiB, por causa do JSON em volta. [Reenvio e envio pelo servidor](api.md#reenvio-e-envio-pelo-servidor) |
| Você pediu um status pelo caminho (`/{id}/600`, `/{id}/0/404`) e a URL respondeu o status padrão | Só vale o segmento logo depois do UUID, quando é um status de 200 a 599. Fora disso vale o padrão da URL, e sem ele 200 | Valem `/404`, `/404/extra` e `/500/`; `/600`, `/20`, `/0/404` e caminhos livres usam o padrão. [URL](api.md#url) · [O que cobre](../tests/contract/README.md#o-que-cobre) |
| Erro em página HTML em vez do envelope JSON | O envelope `{success: false, error: {message, id: null}}` sai só para cliente JSON. O `413` é sempre HTML | Cliente JSON é o que manda `Accept: application/json`, `X-Requested-With: XMLHttpRequest` ou corpo `application/json`. [O que cobre](../tests/contract/README.md#o-que-cobre) |
| `422` com `The timeout may not be greater than 10.` ao criar ou editar a URL | O `timeout` da URL vai de 0 a 10 s | O limite é 10 s. O `delay` de uma regra de resposta vai até 60000 ms. [URL](api.md#url) · [Atrasos e falhas de rede](api.md#atrasos-e-falhas-de-rede) |

## Resposta e regras

O que a URL responde quando tem regras de resposta, cenários, falhas injetadas ou template.

| O que você vê | Por que acontece | O que fazer |
|---|---|---|
| A URL respondeu o padrão, e a sua regra não atuou | Nenhuma regra ativa casou. A requisição grava o quase acerto em `near_miss`: a regra com menos condições falhando, com uma frase por condição, como `method: expected POST, got GET` | Leia `near_miss.failed` na requisição. `POST /token/{id}/rules/test` diz em quais das 500 requisições mais recentes a regra casaria. [Regra que respondeu e quase acerto](api.md#regra-que-respondeu-e-quase-acerto) |
| Regra gravada sem erro, e a resposta saiu `200` | `status` no nível da regra, fora de `response`: o servidor aceita, ignora o campo e responde 200 | Ponha o status em `response`: `{"response": {"status": 400}}`. [Tropeços de forma de regra](laboratorio-defesa.md#tropeços-de-forma-de-regra) |
| Regra com `regex` não casa | `regex` é a sintaxe do Java e precisa casar o valor inteiro (`.` atravessa linhas) | Cubra o valor todo, com `.*` em volta: `"body": [{"regex": ".*\"amount\":[0-9]{7,}.*"}]`. [Tropeços de forma de regra](laboratorio-defesa.md#tropeços-de-forma-de-regra) |
| `422` ao gravar uma regra com `match.signature` em objeto | `match.signature` é texto: `valid`, `invalid` ou `absent` | Use `"signature": "invalid"`, e outra regra com `"signature": "absent"`. [Tropeços de forma de regra](laboratorio-defesa.md#tropeços-de-forma-de-regra) |
| A regra com `"signature": "invalid"` deixa passar a requisição sem cabeçalho de assinatura | `invalid` não cobre a falta do cabeçalho: ela é `absent` | Grave as duas regras, `invalid` e `absent`. [Tropeços de forma de regra](laboratorio-defesa.md#tropeços-de-forma-de-regra) |
| A regra de cenário não casa; o `near_miss` diz `scenario entrega: expected state "entregue", got "Started"` | O cenário da URL está noutro estado. Todo cenário começa em `Started` | `DELETE /token/{id}/scenarios` volta todos a `Started`; `PUT /token/{id}/scenarios/{name}` com `{"state": "..."}` define um estado. [Cenários](api.md#cenários) |
| O `timeout` e o `Retry-After` da URL não aparecem na resposta | Quando uma regra responde, eles não se aplicam. `X-Request-Id`, `X-Token-Id` e os cabeçalhos de CORS continuam | A resposta da regra tem `headers` e `delay` próprios, em `response`. [Regras de resposta](api.md#regras-de-resposta) |
| `503` com `X-Fault-Limit` (`16 held connections on this URL` ou `128 held connections on this server`) | `hang` e `stall_after_headers` prendem no máximo 16 conexões por URL e 128 no servidor. Acima disso, a requisição é gravada com a regra e `response: {"status": 503}` | O limite é 16 por URL e 128 no servidor. Cada conexão presa fecha quando o cliente desiste ou no teto `ANZOL_FAULT_HOLD_MAX` (padrão 300 s). [Atrasos e falhas de rede](api.md#atrasos-e-falhas-de-rede) |
| `500` com `The template is invalid: longer than 65536 characters.` numa regra que já respondia | A regra foi salva antes dos tetos do template, conferidos ao salvar. A requisição continua gravada | Salve a regra dentro dos tetos. [Tetos](api.md#tetos) |
| `500` com `The rendered template is too large.` (a requisição fica gravada) | A renderização passou de um teto: corpo, cada cabeçalho ou a soma dos cabeçalhos | Os tetos são 1 MiB no corpo, 8 KiB por cabeçalho e 32 KiB na soma dos cabeçalhos renderizados. [Tetos](api.md#tetos) |
| `500` com `The template took too long to render.` | Renderizar a resposta passou de 1 s, como num `each` aninhado que gira sem produzir saída | O teto é 1 s para renderizar o corpo e os cabeçalhos, depois de compilar. [Tetos](api.md#tetos) |

## Assinatura, schema e decifra

O que as Verificações da URL gravam em cada requisição: assinatura, schema e decifra.

| O que você vê | Por que acontece | O que fazer |
|---|---|---|
| Assinatura inválida com `signature mismatch` | O HMAC não confere: segredo diferente nos dois lados, ou corpo alterado no caminho. A conta é feita sobre os bytes do corpo como chegaram | "Confira se o segredo do HMAC daqui é o mesmo do remetente; se for, algo no caminho alterou o corpo." (tela; com provedor, a frase traz o nome dele). [Verificação de assinatura](api.md#verificação-de-assinatura) |
| Assinatura com `header X-Hub-Signature-256 absent` (o nome muda com o provedor) | Falta um cabeçalho que a verificação exige; no Slack, a assinatura ou o timestamp | No Genérico: "O remetente não assinou, ou o cabeçalho configurado aqui é outro." (tela). Com provedor, a tela diz que ele não assinou (sem segredo cadastrado lá). [Verificação de assinatura](api.md#verificação-de-assinatura) |
| Assinatura inválida com `malformed header` | O cabeçalho não está no formato do provedor: sem `t` ou `v1`, sem `sha256=`, `v0=` ou `prefix`, ou com hex ou base64 inválido | No Genérico, a tela manda comparar o Prefixo e a Codificação de Verificações › Assinatura com o cabeçalho que chegou: fora do combinado, corrige o remetente; senão, ajuste aqui. Com provedor, manda confirmar que o remetente é esse provedor, ou usar o Genérico. [Verificação de assinatura](api.md#verificação-de-assinatura) |
| Assinatura inválida com `timestamp outside tolerance (412 s)` | A assinatura confere, mas o timestamp está a mais de `toleranceSeconds` (padrão 300) de agora. Só no `stripe` e no `slack` | A tela aponta "reentrega atrasada ou relógio errado; ou aumente a tolerância". `toleranceSeconds` vai de 1 a 86400. [Verificação de assinatura](api.md#verificação-de-assinatura) |
| `422` com `{"schema": ["The schema is invalid: …."]}` | O schema não é objeto, passa de 64 KB, tem `$schema` de outro dialeto, não segue o meta-schema, ou tem `$ref` que não resolve ou não é interno | Vale objeto de até 64 KB (JSON compacto), em 2020-12, 2019-09 ou draft-07, com `$ref` só para o próprio documento (`#`, `#/$defs/…`). [Validação de schema](api.md#validação-de-schema) |
| `format` no schema não reprova nada | No 2020-12 e no 2019-09, `format` é só anotação | No draft-07, `format` é verificado: `$schema` `http://json-schema.org/draft-07/schema#`. [Validação de schema](api.md#validação-de-schema) |
| Decifra `invalid` com `hmac_failed` | A URL confere a assinatura HMAC antes de decifrar; com ela inválida ou ausente, a decifra nem é tentada | "Confira a assinatura HMAC primeiro: a decifra só roda depois dela." (tela). [Resultado da decifra](api.md#resultado-da-decifra) |
| Decifra `invalid` com `downgrade` | Com `required` em `true`, o padrão, atributo que não é JWE é falha, nunca texto aceito | "O remetente mandou em claro, ou o atributo cifrado configurado aqui aponta para outro campo." (tela). Com `required: false`, passa como `absent`. [Decifra de atributo (E2EE)](api.md#decifra-de-atributo-e2ee) |
| Decifra `unknown_kid` ou `decrypt_failed` com `kid_deleted_at` preenchido | O remetente cifrou para uma chave que a URL apagou, ou para a que tinha o mesmo `kid` antes de ser recriada | O remetente precisa baixar o JWKS de novo (`GET /token/{id}/jwks.json`). [Resultado da decifra](api.md#resultado-da-decifra) |
| Decifra `unknown_kid` com `kid_deleted_at` `null` | A URL não tem registro de ter apagado essa chave: o remetente cifrou para outro destino | "Confira qual JWKS o remetente usa." (tela). [Resultado da decifra](api.md#resultado-da-decifra) |
| `422` com `The e2ee requires a read secret on this URL (read_secret).` | Ligar a decifra (`e2ee`) exige segredo de leitura na URL | Mande `read_secret` junto com `e2ee`, no `POST /token` ou no `PUT /token/{id}`. [Decifra de atributo (E2EE)](api.md#decifra-de-atributo-e2ee) |
| `422` com `The read secret cannot be removed while this URL has decrypted requests; delete them first.` | Alguma requisição da URL guarda o atributo decifrado (`decrypted`), mesmo com a decifra já desligada | Apague essas requisições antes (`DELETE /token/{id}/request/{rid}`, ou todas com `DELETE /token/{id}/request`), ou mantenha o segredo. [Segredo de leitura](privacidade.md#segredo-de-leitura) |

## CLI

O que a CLI `anzol` imprime quando algo dá errado, com o código de saída.

| O que você vê | Por que acontece | O que fazer |
|---|---|---|
| `This URL is protected: pass --read-secret or set ANZOL_READ_SECRET` no stderr; saída 1 (2 no `wait-for` e no `test`) | A URL tem segredo de leitura, e a CLI não mandou o segredo certo | Passe `--read-secret <segredo>` depois do subcomando, ou a variável `ANZOL_READ_SECRET`. Só ASCII imprimível. [CLI e MCP](privacidade.md#cli-e-mcp) |
| `Too many wrong read secrets for this URL; try again in a minute` | Mais de 10 segredos errados por minuto na URL, unlock e cabeçalho somados | Espere o minuto acabar: até lá, o bloqueio vale também para o segredo certo. [Segredo de leitura](privacidade.md#segredo-de-leitura) |
| Linha `POST /pedidos/43 -> error: connection refused` no `listen` | O app local está fora do ar ou com erro de rede. A requisição não é reenviada de novo | O CLI continua ouvindo. Para reenviar a gravada: `anzol replay <token> <requestId> --to http://localhost:3000`. [Erros](cli.md#erros) |
| O `anzol listen` não entrega o que chegou antes de ele começar | Só as requisições que chegam depois que o `listen` começa são reenviadas | O `anzol replay` reenvia requisições gravadas, na ordem dada. [`anzol replay`](cli.md#anzol-replay) |
| Linha `Reconnected; forwarding 2 missed request(s)` | A conexão com o servidor caiu e voltou | O `listen` reconecta sozinho (espera 1 s, 2 s, 4 s… até 30 s) e reenvia, em ordem e sem repetir, as requisições que chegaram durante a queda. [Erros](cli.md#erros) |
| `Could not reach …: …` | A CLI não alcançou o servidor; no `wait-for` e no `test`, saída 2 | O servidor vem de `--server`, senão de `ANZOL_SERVER`, senão é `http://localhost:8084`. [Servidor](cli.md#servidor) |
| A linha termina em `[files were not forwarded: not stored by the server]` | O servidor não guarda os arquivos do multipart nem o corpo cru dele, só os campos de texto | É uma limitação: só os campos de texto do multipart são reenviados. [Limitações](cli.md#limitações) |
| `--chaos-abort works only with an http:// target`; saída 2 | O corte do `--chaos-abort` é feito no socket, sem TLS | Use um alvo `http://`. [Falhas na entrega](cli.md#falhas-na-entrega-listen-e-replay) |
| `anzol wait-for` sai com 1 e imprime `timed out after … ms: 0/1 matched`, `closest: #<seq> <uuid>` e `- method: expected DELETE, got POST` | O prazo acabou sem requisição que case. `closest` é a que chegou mais perto | Leia as linhas `- <frase>` do `closest`: uma por condição do `match` que essa requisição não cumpriu. [`anzol wait-for`](cli.md#anzol-wait-for) |
| `anzol test` sai com 3 | O gatilho não subiu ou saiu com código diferente de 0, e a espera não começa | A linha `trigger:` diz como ele saiu; o stdout e o stderr do gatilho vão para o stderr do `anzol test`. [`anzol test`](cli.md#anzol-test) |
| `anzol rules push` imprime `0.match.path.regex: The regex is invalid.` e sai com 1 | O servidor recusou as regras (422), e nada muda na URL | Cada linha é `chave: mensagem`, com a chave em pontos a partir do índice da lista; `rules` quando o arquivo não é uma lista. O `--dry-run` não valida. [`anzol rules pull` e `anzol rules push`](cli.md#anzol-rules-pull-e-anzol-rules-push) |

## MCP e IA local

O que o servidor MCP e as duas rotas de IA local respondem quando estão desligados, protegidos ou no limite.

| O que você vê | Por que acontece | O que fazer |
|---|---|---|
| `/mcp` responde `404` | O MCP vem desligado (`ANZOL_MCP_ENABLED=false`), também no compose | Ponha `ANZOL_MCP_ENABLED=true` num `docker-compose.override.yml` e rode `docker compose up -d` de novo; `GET /health` mostra `"mcp":"on"`. Não ligue o MCP num app publicado. [Ligar no compose](operacao.md#ligar-no-compose) |
| Ferramenta volta erro (`isError`) com `{"status":401,"error":"This URL is protected; pass its read_secret"}` | A URL tem segredo de leitura, e o argumento `read_secret` faltou ou está errado | Passe `read_secret` na ferramenta. No `update_url`, ele é só o acesso: o segredo da URL não muda por ali. [CLI e MCP](privacidade.md#cli-e-mcp) |
| Ferramenta volta `429` com `This URL is protected and got too many wrong secrets; try again in … s` | O `read_secret` errado do MCP tem contador próprio, à parte do da tela e da CLI: 10 erros por minuto na URL | Espere os segundos da mensagem. A tela e a CLI seguem abrindo a URL. [Segredo de leitura](privacidade.md#segredo-de-leitura) |
| Rota de IA responde `503 {"error": "AI is not configured"}`; a tela diz "Este servidor não tem IA local." | `ANZOL_AI_ENABLED` está `false`, o padrão. O resto da API segue igual | Ponha `ANZOL_AI_ENABLED=true` e `ANZOL_AI_BASE_URL` no `docker-compose.override.yml`; `GET /health` mostra `"ai":"on"`. [Variáveis](mcp-e-ia.md#variáveis) · [Ligar no compose](operacao.md#ligar-no-compose) |
| Rota de IA responde `502 {"error": "The language model failed: ..."}`; a tela diz "O modelo local não respondeu…" | O LLM está fora do ar, deu erro ou não respondeu em 90 s, sem retentativa. O modelo frio no oMLX leva de 9 a 31 s só para carregar | "Confira se ele está rodando e acessível pelo servidor e tente de novo." (tela). A captura e o resto da API não são afetados. [Limites e falhas](mcp-e-ia.md#limites-e-falhas) · [Riscos](mcp-e-ia.md#riscos) |
| Rota de IA responde `429` com `Retry-After`; a tela diz "Chamadas demais à IA nesta URL (até 10 por minuto, uma de cada vez)." | Por URL, uma chamada de IA por vez e até 10 por minuto | Espere o `Retry-After`. [Limites e falhas](mcp-e-ia.md#limites-e-falhas) |

## Laboratório de defesa

O que o laboratório de defesa responde ao criar a URL e ao abrir e fechar a rodada, e o que derruba a contenção.

| O que você vê | Por que acontece | O que fazer |
|---|---|---|
| O relatório mostra contenção baixa, ou zero, com os ataques detectados | Regra com forma errada: `status` fora de `response`, `regex` que não cobre o valor inteiro, valor exato da onda 1, regra de `absent` esquecida | Confira a regra com `GET /token/{id}/rules` e teste-a com `test_rule` (MCP) ou `POST /token/{id}/rules/test`. [Tropeços de forma de regra](laboratorio-defesa.md#tropeços-de-forma-de-regra) |
| `422` em `defense_lab` com `There are already 20 active defense lab URLs; delete one or wait.` | O servidor aceita até 20 laboratórios de defesa ativos. A URL conta como ativa por 30 min depois de criada e depois de cada rodada aberta | Apague um laboratório ou espere uma vaga vencer. Na 0.9.5, a vaga dura as 24 h de vida da URL. [Laboratório de defesa](api.md#laboratório-de-defesa) · [Limites](laboratorio-defesa.md#limites) |
| `422` em `defense_lab` com `This is not a defense lab URL: create one with POST /defense-lab.` | A rodada só roda numa URL criada por `POST /defense-lab` | Crie a URL com `POST /defense-lab` e abra a rodada nela. [Erros e limites](api.md#erros-e-limites) |
| `409` com `This URL already has an open round; finish it first` | Uma URL tem uma rodada aberta por vez | Feche a rodada aberta com `POST .../rounds/{round}/finish` antes de abrir outra. [A rodada](api.md#a-rodada) |
| `409` com `This round is still open; finish it to get the report` | O relatório só sai de rodada fechada | Feche a rodada com `POST .../rounds/{round}/finish`, que devolve o relatório. [Relatório](api.md#relatório) |
| `409` com `This round is already finished` | `verdicts` e `finish` só valem em rodada aberta, e a rodada fechada não reabre | O relatório dela sai em `GET /token/{id}/defense-lab/rounds/{round}`. [Erros e limites](api.md#erros-e-limites) |
| `429` com `Retry-After` e `Too many defense rounds for this URL; try again later` | Mais de 6 rodadas no minuto na URL | Espere o `Retry-After`. [Erros e limites](api.md#erros-e-limites) |
| `429` com `Retry-After` e `There are already 20 active defense lab URLs; delete one or wait.` ao abrir a rodada | A vaga da URL venceu, e o servidor já tem 20 laboratórios de defesa ativos | Espere o `Retry-After`, que vai até a primeira vaga vencer. [Erros e limites](api.md#erros-e-limites) |
| `start_defense_round` abriu com uma semente que não era a pedida | O servidor aceita campo que não conhece: o argumento errado no lugar de `seed` abre a rodada com semente sorteada | Confira a semente no relatório. [Limites](laboratorio-defesa.md#limites) |

## Servidor e operação

O que o servidor responde por causa da configuração: saúde, nomes aceitos e saída para a rede.

| O que você vê | Por que acontece | O que fazer |
|---|---|---|
| `403 {"error":"host not allowed"}`: a tela abre, mas a API responde 403 | O nome no `Host` não está em `ANZOL_ALLOWED_HOSTS`, a proteção contra DNS rebinding das rotas de gestão e do `/mcp` | Acrescente o nome à lista (no Helm, `anzol.allowedHosts`). `*` desliga a conferência da gestão e é inseguro: qualquer página aberta no navegador passa a usar a API. O `/mcp` continua no padrão. [Proteção contra DNS rebinding/CSRF](privacidade.md#proteção-contra-dns-rebindingcsrf) |
| `403 {"error":"origin not allowed"}` num `POST`, `PUT`, `PATCH` ou `DELETE` | O `Origin` não é deste servidor: outra porta, ou nome fora da lista. No `/mcp`, o `Origin` é conferido em todo método | Para uma tela servida noutra porta, escreva `nome:porta` na lista, como `localhost:4200`. [Proteção contra DNS rebinding/CSRF](privacidade.md#proteção-contra-dns-rebindingcsrf) |
| Reenvio ou envio volta `200` com `error.kind` `blocked` e `destination not allowed or not resolvable`; a tela mostra "Bloqueado" | No padrão (`ANZOL_OUTBOUND_ALLOW_PRIVATE=false`), o servidor só sai para endereço público. Nome que não resolve dá a mesma mensagem | Para um app na sua máquina: `ANZOL_OUTBOUND_ALLOW_PRIVATE=true` e `ANZOL_OUTBOUND_LOCALHOST_ALIAS=host.docker.internal` no override do compose. **Não publique o app assim.** [Reenvio e envio pelo servidor](api.md#reenvio-e-envio-pelo-servidor) · [Ligar no compose](operacao.md#ligar-no-compose) |
| Reenvio ou envio volta `429` com `Retry-After`; a tela diz "Envios demais desta URL (30 por minuto)." | Mais de 30 disparos por minuto na mesma URL, reenvio e envio somados | Espere o `Retry-After`. [Reenvio e envio pelo servidor](api.md#reenvio-e-envio-pelo-servidor) |
| `GET /health` responde `503` com `"status": "unavailable"` e `"redis": "down"`; o `docker ps` mostra `(unhealthy)` | O Redis não respondeu a um `PING` em até 2 s. Depois de três leituras sem o 200, o `HEALTHCHECK` marca `(unhealthy)` | O prazo do `PING` é 2 s. `GET /version` responde mesmo com o Redis fora; no Kubernetes, o pod sai do Service, e a liveness não o reinicia. [Saúde e versão](operacao.md#saúde-e-versão) · [O que o chart sobe](helm.md#o-que-o-chart-sobe) |
