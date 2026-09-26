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
| `GET`/`PUT`/`DELETE /token/{id}` | Lê, edita, apaga a URL |
| `PUT /token/{id}/cors/toggle` | Liga/desliga os cabeçalhos CORS na resposta do webhook |
| `ANY /{id}[/{status}][/...]` | O webhook: grava a requisição e responde com o padrão da URL |
| `GET /token/{id}/requests` | Lista as mensagens (`page`, `per_page`, `sorting=oldest\|newest`); com `after=<seq>`, as mensagens de `seq` maior, da mais antiga para a mais nova, até `per_page` |
| `GET`/`DELETE /token/{id}/request/{requestId}` | Lê ou apaga uma mensagem; `.../raw` devolve o corpo cru |
| `DELETE /token/{id}/request` | Apaga todas as mensagens |
| `GET /token/{id}/stream` | SSE: um evento `request.created` a cada mensagem gravada (`removed` lista as que a limpeza tirou) |

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
