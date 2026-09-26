# Frontend (Angular 22)

Tela do webhook.site em Angular 22 + Angular Material. Fala só com a API REST (`/token/**`) e
com o stream SSE `GET /token/{id}/stream`. Padrão de código: [`docs/padroes-angular.md`](../docs/padroes-angular.md).

## Rodar

```bash
npm ci
npx ng serve                                    # http://localhost:4200, proxy para o app atual (8084)
BACKEND_URL=http://localhost:8086 npx ng serve  # proxy para o backend Kotlin
```

O proxy (`proxy.conf.mjs`) encaminha `/token/**` e `/{uuid}/**` (a URL do webhook) ao backend.
O roteamento é em hash (`/#/{uuid}/{requestUuid}/{page}`); links antigos com `#!/` são
reescritos para `#/` antes do bootstrap.

`npx ng build` gera `dist/frontend/` com `index.html` e os arquivos com hash na raiz, para o
backend servir.

## Verificar

```bash
npx ng lint                  # angular-eslint + typescript-eslint (§7 do padrão)
npm run format:check         # Prettier
npx ng test --watch=false    # Vitest (unitários e componentes, com harnesses do CDK)
BASE_URL=http://localhost:4200 npx playwright test   # E2E do checklist de paridade 1–14
```

A E2E cria e apaga as próprias URLs pela API. `e2e/tempo-real.spec.ts` (itens 7 e 13) só roda
quando o backend responde `text/event-stream` em `/token/{id}/stream`; contra o app atual ela é
pulada com o motivo no relatório.
