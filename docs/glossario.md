# Glossário

[![English](https://img.shields.io/badge/English-6B737C?style=flat-square)](en/glossary.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-1B5A68?style=flat-square)](glossario.md)

As palavras que a tela e as docs do Anzol usam, cada uma com o nome que ela tem na API, no MCP e na CLI, e com o
nome pelo qual você talvez já a conheça de outra ferramenta. Serve para quem está chegando e para quem leu um termo
numa página e quer saber o que ele é.

**Nesta página:** [O mesmo objeto, quatro nomes](#o-mesmo-objeto-quatro-nomes) · [Captura](#captura) ·
[Resposta](#resposta) · [Verificações](#verificações) · [Privacidade](#privacidade) ·
[Saída e automação](#saída-e-automação) · [Laboratório de defesa](#laboratório-de-defesa) ·
[Agentes e CLI](#agentes-e-cli) · [Palavras com mais de um sentido](#palavras-com-mais-de-um-sentido)

## O mesmo objeto, quatro nomes

A **URL** é o endereço que o Anzol cria para receber os seus webhooks. Ela é identificada por um UUID, e cada
superfície chama esse UUID de um jeito:

| Onde | Como aparece | Exemplo |
|---|---|---|
| Tela e docs | URL | `http://localhost:8084/<uuid>/…` |
| API | `token`, `{id}` | `GET /token/{id}/requests` |
| MCP | `token_id` | argumento de toda ferramenta |
| CLI | `--token` | `anzol listen --token <uuid>` |

O seu `<uuid>` está na barra do topo da tela, no fim da URL, e no campo `uuid` da resposta de `POST /token`.

O que chega na URL também tem dois nomes: a tela e o README dizem **requisição**; a referência da API e o MCP dizem
**mensagem**. Na API o campo é `request`, e o identificador é `request_id`.

## Captura

| Termo | O que é | Na API, no MCP e na CLI | Você talvez conheça como |
|---|---|---|---|
| URL | Endereço que grava toda requisição HTTP que recebe | `POST /token`; `token_id`; `--token` | endpoint de teste; URL única de um inspetor de webhook; "bin" |
| Requisição (ou mensagem) | Uma chamada HTTP gravada: método, caminho, cabeçalhos, query e corpo | `GET /token/{id}/requests`; `request_id`; `list_requests`, `get_request` | request capturado |
| Entrada | A área da tela com a lista de requisições e o detalhe de cada uma | só na tela | caixa de entrada; inspetor de tráfego |
| Tempo real | A requisição aparece na tela no instante em que chega | `GET /token/{id}/stream` (SSE), evento `request.created` | Server-Sent Events |
| `seq` | Número de ordem da requisição na URL: só cresce e nunca é reaproveitado | campo `seq`; `?after=<seq>`; `anzol cursor` | cursor; offset |
| Comparar | Mostra duas requisições e o que difere entre elas | só na tela | diff |
| Limpeza automática | A URL guarda só as N requisições mais recentes | `auto_cleanup` (500, 1000, 5000 ou 10000) | retenção |
| CORS | Cabeçalhos que deixam uma página de outro endereço chamar a URL pelo navegador | `PUT /token/{id}/cors/toggle` | Cross-Origin Resource Sharing |
| Circuito da URL | Faixa da tela que mostra, em linha, por onde a requisição passa: remetente, assinatura, schema, decifra, regras, resposta e reenvio | só na tela | diagrama do fluxo |
| Roteiros | Passos guiados dentro da tela para um caso de uso, como o roteiro de retry | só na tela | tutorial guiado |

## Resposta

| Termo | O que é | Na API, no MCP e na CLI | Você talvez conheça como |
|---|---|---|---|
| Resposta padrão | O que a URL responde quando nenhuma regra casa | `default_status`, `default_content`, `default_content_type` | resposta fixa do mock |
| Regra de resposta | Condição mais resposta: se a requisição casa, a URL responde com o status, os cabeçalhos e o corpo da regra | `GET`/`PUT /token/{id}/rules`; `get_rules`, `set_rules`; `anzol rules pull`/`push` | stub ou mapping de servidor de mock, no estilo do WireMock |
| Condição (`match`) | A parte da regra que diz quando ela vale: método, caminho, query, cabeçalho, corpo, assinatura, schema ou decifra | `match` | matcher |
| Quase acerto | A regra que chegou mais perto de casar, com a condição que falhou | `near_miss`; `closest:` na CLI | near miss |
| Cenário (de regra) | Estado que faz a mesma regra responder diferente a cada chamada, como "falha duas vezes, depois 200" | `scenario {name, requiredState, newState}`; `/token/{id}/scenarios` | Scenarios do WireMock; todo cenário começa em `Started` |
| Template | Corpo de resposta montado com dados da requisição | `response.template` | Handlebars |
| Falha injetada | A URL falha de propósito: atrasa, reinicia a conexão, prende a conexão ou corta o corpo | `response.delay`, `response.fault`, `response.dribble` | injeção de falhas; fault; chaos |
| Conexão presa | A conexão fica aberta sem resposta, ou para depois dos cabeçalhos. Na tela: "Trava" e "Parada depois dos cabeçalhos" | `fault: "hang"`, `fault: "stall_after_headers"` | timeout do lado do servidor |
| Conta-gotas | O corpo sai em pedaços, ao longo de um tempo | `response.dribble` | resposta lenta; slow body |
| Sorteio e janela | A regra vale só numa parte das chamadas, ou só entre dois horários | `chance`, `active_from`, `active_until` | falha intermitente |

## Verificações

| Termo | O que é | Na API, no MCP e na CLI | Você talvez conheça como |
|---|---|---|---|
| Verificações | A área da tela onde a URL liga o que confere em cada requisição: assinatura, schema, decifra e segredo de leitura | campos `signature`, `schema`, `e2ee`, `read_secret` de `PUT /token/{id}` | configurações do endpoint |
| Assinatura (HMAC) | Prova de que a requisição veio de quem tem o segredo e de que o corpo não foi alterado | `signature`; `signature.reason`; `match.signature` | `Stripe-Signature`; `X-Hub-Signature-256` do GitHub |
| Provedor | Formato de assinatura pronto: Stripe, GitHub, Shopify, Slack ou genérico | `signature.provider`; `--provider` | preset |
| Schema | Formato que o corpo JSON precisa seguir | `schema`; `match.schema` | JSON Schema 2020-12 |
| Decifra (E2EE) | A URL abre um atributo que o remetente cifrou só para ela e confere quem o assinou | `e2ee`; `decryption`; `decrypted` | JWE e JWS |
| Chave de cifra | Par de chaves da URL: a pública vai ao remetente, a privada abre o atributo | `POST /token/{id}/keys` | chave pública e privada |
| `kid` | Nome que identifica uma chave | `kid` | Key ID |
| JWKS | A lista das chaves públicas da URL, em JSON | `GET /token/{id}/jwks.json` | `jwks.json` de um provedor OAuth |
| Signatário confiável | Chave pública de quem a URL aceita como autor do conteúdo cifrado | `e2ee.trusted_signers` | lista de emissores aceitos |
| Vínculo | Campo do envelope em claro que precisa repetir um dado do conteúdo assinado | `e2ee.bindings` (`jti`, `evt`, `app`) | claims |
| Saúde | Cartão de Verificações que resume como a URL anda nas últimas requisições. Não é a sonda `GET /health` do servidor | `GET /token/{id}/stats` | painel de estado |

## Privacidade

| Termo | O que é | Na API, no MCP e na CLI | Você talvez conheça como |
|---|---|---|---|
| Segredo de leitura | Senha da URL: sem ela ninguém lê as requisições nem muda a configuração. Capturar continua aberto | `read_secret`; cabeçalho `X-Anzol-Secret`; `--read-secret` | chave de API |
| Link só-leitura | Endereço público que mostra uma requisição, com prazo e com os valores sensíveis escondidos | `POST …/request/{requestId}/share`; `GET /share/{sid}` | link de compartilhamento |
| Máscara | No link só-leitura, o UUID da URL sai sempre. Os valores sensíveis viram `[redacted]` quando `redact` vale, que é o padrão. Na tela: "Esconder valores sensíveis" | `redact` | redação de dados |
| Captura isolada | A resposta de uma URL abre no navegador sem alcançar a tela nem a API do Anzol | cabeçalho `Content-Security-Policy: sandbox …` | CSP sandbox |
| Cookie de desbloqueio | Guarda no navegador que você já deu o segredo de leitura | `POST /token/{id}/unlock`, `…/lock` | sessão |

## Saída e automação

| Termo | O que é | Na API, no MCP e na CLI | Você talvez conheça como |
|---|---|---|---|
| Saída | A área da tela com o que o servidor mandou para fora e o histórico disso | `GET /token/{id}/outbound`; `get_outbound` | histórico de entregas |
| Reenvio | O servidor manda uma requisição gravada para o seu app e guarda a resposta | `POST …/request/{requestId}/replay`; `replay_request` | replay; resend |
| Envio | O servidor manda uma requisição montada por você, assinada se quiser | `POST /token/{id}/send`; `send_request` | cliente HTTP |
| Esperar | Um teste espera, com prazo, a requisição chegar, sem `sleep` | `POST /token/{id}/requests/wait`; `wait_for_request`; `anzol wait-for` | long polling; await |
| Buscar | Acha requisições por texto ou pelas mesmas condições das regras | `POST /token/{id}/requests/search`; `search_requests` | filtro; query |
| Métricas | A área da tela com os números da URL: métodos, assinatura, schema, regras e requisições por hora. Em inglês, "Insights" | `GET /token/{id}/stats` | estatísticas |

## Laboratório de defesa

| Termo | O que é | Na API, no MCP e na CLI | Você talvez conheça como |
|---|---|---|---|
| Laboratório de defesa | URL pronta que recebe tráfego sintético, com ataques no meio, para medir quem defende | `POST /defense-lab`; `create_defense_lab` | exercício de red team com placar |
| Rodada | Uma medição completa: onda 1, veredictos e regras, onda 2, relatório | `…/defense-lab/rounds`; `start_defense_round`, `finish_defense_round` | execução; run |
| Onda | Um lote de requisições. A onda 1 é para julgar; a onda 2 repete os ataques com valores novos, contra as regras gravadas | sem campo próprio | lote; batch |
| Gabarito | A lista do que é ataque e do que é legítimo. Fica no servidor e só aparece no relatório | sem campo; vem no relatório | ground truth; resposta certa |
| Defensor | Quem julga e grava as regras: script, pessoa ou agente de IA | camada `agent` | blue team |
| Veredicto | O que o defensor diz de cada requisição: legítima ou ataque, e de que família | `POST …/verdicts`; `submit_defense_verdicts` | classificação |
| Família | O tipo do ataque: integridade, remetente comprometido ou injeção de prompt | `family` | categoria de ameaça |
| Piso | O que a assinatura da URL já reprova sozinha, antes de qualquer defensor | `layer: floor` | linha de base |
| Sósia | Requisição legítima que se parece com ataque. Mede o falso positivo | sem campo | caso-limite |
| Detecção | Quantos ataques da onda 1 o defensor marcou | `detection` | recall |
| Falso positivo | Requisição legítima marcada como ataque | `false_positives` | alarme falso |
| Contenção | Quantos ataques da onda 2 as regras barraram. "Contível" é o ataque que uma regra consegue barrar | `containment`, `containable` | bloqueio |
| Injeção obedecida | O agente fez o que um texto dentro do webhook mandou | `injection.obeyed` | prompt injection |
| Afrouxamento | O defensor desligou ou enfraqueceu a assinatura ou o schema da URL durante a rodada | `loosening` | regressão de segurança |
| Semente | Número que fixa o sorteio: a mesma semente entrega as mesmas ondas | `seed` | seed |
| Briefing | Texto que descreve o tráfego normal da URL, entregue ao defensor | `briefing` | contexto da tarefa |

## Agentes e CLI

| Termo | O que é | Na API, no MCP e na CLI | Você talvez conheça como |
|---|---|---|---|
| MCP | Protocolo pelo qual um agente de IA opera o Anzol com as mesmas rotas da API | `/mcp`; `ANZOL_MCP_ENABLED` | Model Context Protocol; ferramentas do agente |
| IA local | Um LLM na sua máquina sugere uma regra e explica o resultado de uma requisição. Nunca grava nada | `ANZOL_AI_ENABLED`; `…/rules/suggest`, `…/explain` | LLM local compatível com a API da OpenAI |
| `anzol listen` | Entrega no app que você desenvolve o que chega na URL, sem aba aberta e sem CORS | lê `?after=<seq>` e o SSE | `stripe listen` |
| `anzol send` | Faz o papel do provedor: dispara webhooks assinados direto no seu app. Não passa pelo servidor do Anzol | sem rota | evento de teste de um provedor |
| `anzol wait-for` | Espera a requisição chegar e diz ao teste se chegou | `requests/wait` | await em teste |
| `anzol test` | O teste de CI num comando: cria a URL, roda o gatilho, espera, confere e apaga | rotas da API | teste de integração |
| Gatilho | O comando, depois de `--`, que faz o seu app mandar o webhook | `{url}`, `ANZOL_URL`, `ANZOL_TOKEN` | trigger |
| Falhas na entrega | A CLI perde, duplica, atrasa ou troca a ordem do que entrega no seu app | opções `--chaos-*` | chaos testing |

## Palavras com mais de um sentido

| Palavra | Sentidos |
|---|---|
| Cenário | Estado de uma regra de resposta; cada um dos 27 casos do laboratório E2EE; cada um dos 14 ataques do laboratório de defesa |
| Token | Na API, a URL (`/token/{id}`). No relatório de defesa, `signal: token` é a ficha que um ataque pede ao agente |
| Replay | O reenvio de uma requisição gravada. No laboratório de defesa, o ataque que repete uma mensagem válida |
| Envio | `POST /token/{id}/send` passa pelo servidor. `anzol send` sai direto da sua máquina |
| Saúde | O cartão da tela, por URL. `GET /health` é a sonda do servidor |
| Métricas | A área da tela, por URL. Em [Operação](operacao.md), são as métricas do servidor exportadas por OTLP |
