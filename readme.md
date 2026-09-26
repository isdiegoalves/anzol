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
webhook responde 500) em vez de apagar chaves, então nenhum token some e o que já está gravado
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
| `GET /token/{id}/requests` | Lista as mensagens (`page`, `per_page`, `sorting=oldest\|newest`) |
| `GET`/`DELETE /token/{id}/request/{requestId}` | Lê ou apaga uma mensagem; `.../raw` devolve o corpo cru |
| `DELETE /token/{id}/request` | Apaga todas as mensagens |
| `GET /token/{id}/stream` | SSE: um evento `request.created` a cada mensagem gravada (`removed` lista as que a limpeza tirou) |

`retry_after` (segundos, inteiro ≥ 0, ou data HTTP no formato `Sun, 06 Nov 1994 08:49:37 GMT`)
faz toda resposta do webhook da URL levar o cabeçalho `Retry-After`; útil com `/429`, `/503` ou 3xx.

`auto_cleanup` (500, 1000, 5000 ou 10000) é a limpeza automática: a URL guarda só as N mensagens
mais recentes e apaga a mais antiga a cada nova (também na hora, se o limite for reduzido). A URL
nunca para de receber.

O comportamento exato (status, erros, limpeza automática e corpo de até 1 MiB) está descrito em
[`tests/contract/README.md`](tests/contract/README.md). A coleção `webhook-paw.paw` (Paw) tem
exemplos das mesmas rotas.

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
```

Para mexer na tela com recarga automática, com o compose no ar: `cd frontend && npx ng serve`
abre em <http://localhost:4200> e encaminha a API para a porta 8084 (`proxy.conf.mjs`).

## Padrões de código

- Kotlin: [`docs/padroes-kotlin.md`](docs/padroes-kotlin.md)
- Angular: [`docs/padroes-angular.md`](docs/padroes-angular.md)

## Helm

O chart em `helm/` está desatualizado: ainda descreve a stack antiga (imagens upstream
`webhooksite/webhook.site` e `webhooksite/laravel-echo-server`, `redis:alpine`). Serve só
como ponto de partida; o app roda com o `docker-compose.yml`.
