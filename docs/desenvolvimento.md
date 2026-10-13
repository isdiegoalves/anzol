# Desenvolvimento

## Como testar

```bash
# Backend: testes (Redis em container, precisa de Docker), ktlint e detekt
cd backend && ./gradlew check

# Frontend: lint, tipos dos specs de E2E, stylelint, i18n extraído, formato, testes unitários (Vitest) e build
cd frontend && npm ci
npx ng lint && npx tsc --noEmit -p e2e/tsconfig.json && npm run -s lint:styles
npx ng extract-i18n && git diff --exit-code src/locale/messages.json
npx prettier --check . && npx ng test --watch=false && npx ng build

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

O Vitest roda os testes em ordem aleatória, e a semente sai no topo do relatório (`Running tests with seed "…"`).
Para repetir a ordem de uma rodada que falhou: `VITEST_SEED=<semente> npx ng test --watch=false`.

Para mexer na tela com recarga automática, com o compose no ar: `cd frontend && npx ng serve`
abre em <http://localhost:4200> e encaminha a API para a porta 8084 (`proxy.conf.mjs`).

### CI local

O `./ci.sh` da raiz roda tudo o que está acima de uma vez. No GitHub, o workflow `testes`
(`.github/workflows/testes.yml`) roda a cada push e pull request só a parte sem stack (passo 1 abaixo: backend, CLI e
frontend), e o workflow `e2e` (`.github/workflows/e2e.yml`) roda, a cada push e em pull request que mexam em
`frontend/`, em `backend/src/main/`, no `Dockerfile`, no compose do stack isolado ou no próprio workflow, uma parte do
E2E contra a imagem do `Dockerfile`: os specs de caos (`caos*`), os `patamar-*`, o `cores-lista` e o `i18n-carga`. A
seleção está no script `e2e:github` do `frontend/package.json`; para rodá-la como o GitHub roda, com o app no ar:
`cd frontend && BASE_URL=http://localhost:8084 npm run e2e:github`. Contrato, o E2E inteiro, a regressão visual e o
aceite do CLI ficam no `./ci.sh`.

```bash
./ci.sh
```

Precisa de Docker, Java 25 e Node 24 (confere no início e diz o que falta) e da porta 8088 livre.

1. **Sem stack:** `backend` → `./gradlew check`; `cli` → `./gradlew check installDist`;
   `frontend` → `npm ci`, `ng lint`, `tsc --noEmit -p e2e/tsconfig.json` (os tipos dos specs de E2E, que o
   Playwright roda sem conferir), `npm run lint:styles` (stylelint), `ng extract-i18n` com
   `git diff --exit-code` no `messages.json`, `prettier --check .`, `ng test --watch=false`, `ng build`.
2. **Stack isolado:** `docker compose -p anzolci` com o override `docker-compose.ci.yml` sobe o
   app na porta 8088, com Redis `anzolci-redis` e volume `anzolci_redis-data` próprios. O app da
   8084 e o Redis `anzol-redis` (dados reais) não são tocados.
3. **Integração contra a 8088:** contrato (`tests/contract`, `TETO_PADRAO=10000`), E2E da tela
   (`frontend/e2e`), regressão visual (`frontend/e2e-visual.sh`, na imagem Docker do Playwright) e
   aceite do CLI (`tests/cli`, com o CLI do passo 1).
4. **Fim:** `down -v` do stack isolado (containers, rede, volume e imagem do app), também em falha ou
   Ctrl+C, e uma tabela etapa → OK/FALHOU/NÃO RODOU → tempo.

Uma etapa que falha não interrompe as seguintes; se o stack não sobe, as de integração aparecem
como NÃO RODOU. A saída é 0 só com tudo OK. Com os caches do Gradle, do npm e do Docker quentes, a
rodada inteira leva de 7 a 9 minutos.

### Varredura de segurança no GitHub

O workflow `trivy` (`.github/workflows/trivy.yml`) procura segredos e configuração mal feita (Dockerfile, Helm, compose)
a cada push e pull request, e constrói a imagem do `Dockerfile` e a escaneia a cada tag de versão (ou à mão, em
Actions → trivy → Run workflow). Falha com vulnerabilidade alta ou crítica que já tenha correção. Para repetir a
varredura da imagem na máquina: `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock
ghcr.io/aquasecurity/trivy:0.70.0 image --severity HIGH,CRITICAL --ignore-unfixed <imagem>`.

O Dependabot (`.github/dependabot.yml`) abre toda semana um pull request com as atualizações de minor e patch do Gradle
(`backend/` e `cli/`), do npm (`frontend/` e `tests/contract/`) e das Actions, e outro, só para versão major, quando
houver; no Docker (`Dockerfile` e compose) só propõe minor e patch.

## Padrões de código

- Kotlin (`backend/` e `cli/`): [`docs/padroes-kotlin.md`](padroes-kotlin.md)
- Angular: [`docs/padroes-angular.md`](padroes-angular.md)
