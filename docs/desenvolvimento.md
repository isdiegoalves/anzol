# Desenvolvimento

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
2. **Stack isolado:** `docker compose -p anzolci` com o override `docker-compose.ci.yml` sobe o
   app na porta 8088, com Redis `anzolci-redis` e volume `anzolci_redis-data` próprios. O app da
   8084 e o Redis `anzol-redis` (dados reais) não são tocados.
3. **Integração contra a 8088:** contrato (`tests/contract`, `TETO_PADRAO=10000`), E2E da tela
   (`frontend/e2e`) e aceite do CLI (`tests/cli`, com o CLI do passo 1).
4. **Fim:** `down -v` do stack isolado (containers, rede, volume e imagem do app), também em falha ou
   Ctrl+C, e uma tabela etapa → OK/FALHOU/NÃO RODOU → tempo.

Uma etapa que falha não interrompe as seguintes; se o stack não sobe, as de integração aparecem
como NÃO RODOU. A saída é 0 só com tudo OK. Com os caches do Gradle, do npm e do Docker quentes, a
rodada inteira leva uns 2 minutos.

## Padrões de código

- Kotlin (`backend/` e `cli/`): [`docs/padroes-kotlin.md`](padroes-kotlin.md)
- Angular: [`docs/padroes-angular.md`](padroes-angular.md)
