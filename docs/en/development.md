# Development

[![English](https://img.shields.io/badge/English-1B5A68?style=flat-square)](development.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-6B737C?style=flat-square)](../desenvolvimento.md)

How to test Anzol on your machine and what CI runs: each part's suites, the quick check, local CI and the scans on
GitHub. This is a how-to page, for whoever works on the code. The backend tests need Docker; local CI needs Docker,
Java 25 and Node 24.

**On this page:** [How to test](#how-to-test) · [Code standards](#code-standards)

## How to test

```bash
# Backend: tests (Redis in a container, needs Docker), ktlint and detekt
cd backend && ./gradlew check

# Frontend: lint, types of the E2E specs, stylelint, extracted i18n, format, unit tests (Vitest) and build
cd frontend && npm ci
npx ng lint && npx tsc --noEmit -p e2e/tsconfig.json && npm run -s lint:styles
npx ng extract-i18n && git diff --exit-code src/locale/messages.json
npx prettier --check . && npx ng test --watch=false && npx ng build

# Web UI E2E (Playwright) against the running app
cd frontend && npx playwright install chromium   # once
BASE_URL=http://localhost:8084 npx playwright test

# Black-box contract of the API and the event against the running app
cd tests/contract && npm ci && npx playwright test

# CLI: tests (fake server and fake local app, no Docker), ktlint and detekt
cd cli && ./gradlew check

# Black-box acceptance of the CLI against the running app (after cd cli && ./gradlew installDist)
cd tests/cli && node --test
```

The E2E and the contract require outbound to the private network, [MCP](glossary.md#agents-and-cli) and
[AI](glossary.md#agents-and-cli) (against a fake LLM that the suites themselves start) to be on, which
`docker-compose.yml` alone does not do.

Start the local CI stack and point the suites at it: `docker compose -p anzolci -f docker-compose.yml -f docker-compose.ci.yml up -d --build` and
`BASE_URL=http://localhost:8088` (for the contract, also `ANZOL_FAULT_HOLD_MAX=30`, the cap of that stack); when you
finish, the same `docker compose` with `down -v`.

To work on the web UI with automatic reload, with compose up: `cd frontend && npx ng serve`
opens at <http://localhost:4200> and forwards the API to port 8084 (`proxy.conf.mjs`).

Vitest runs the tests in random order, and the seed appears at the top of the report (`Running tests with seed "…"`).
To repeat the order of a run that failed: `VITEST_SEED=<seed> npx ng test --watch=false`.

### Quick check

`./verificar.sh` runs, without Docker and without starting the app, only what gives fast feedback on the parts with
changes in git:

- in `backend/` and `cli/`: ktlint, detekt and compilation (including of the tests);
- in the web UI: lint, types, stylelint, i18n, format and unit tests.

It prints one line per step and, for the ones that fail, the first lines of the error. `./verificar.sh backend cli`
chooses the parts.

It does not run the backend and CLI tests, the E2E, the contract or the visual regression: those stay in `./ci.sh`.

### Local CI

The `./ci.sh` at the root runs everything above in one go.

```bash
./ci.sh
```

It needs Docker, Java 25 and Node 24 (it checks at the start and says what is missing) and port 8088 free.

1. **No stack:** `backend` → `./gradlew check`; `cli` → `./gradlew check installDist`;
   `frontend` → `npm ci`, `ng lint`, `tsc --noEmit -p e2e/tsconfig.json` (the types of the E2E specs, which
   Playwright runs without checking), `npm run lint:styles` (stylelint), `ng extract-i18n` with
   `git diff --exit-code` on `messages.json`, `prettier --check .`, `ng test --watch=false`, `ng build`.
2. **Isolated stack:** `docker compose -p anzolci` with the `docker-compose.ci.yml` override starts the
   app on port 8088, with its own Redis `anzolci-redis` and volume `anzolci_redis-data`. The app on
   8084 and the Redis `anzol-redis` (real data) are not touched.
3. **Integration against 8088:** startup under burst (`tests/subida`, which restarts the stack's app 8 times and,
   on each one, fires 64 clients as soon as it responds), contract (`tests/contract`, `TETO_PADRAO=10000`), web UI
   E2E (`frontend/e2e`), visual regression (`frontend/e2e-visual.sh`, in Playwright's Docker image) and
   CLI acceptance (`tests/cli`, with the CLI from step 1).

   The visual regression fails on a single different pixel (`maxDiffPixels: 0`), but "different" is by
   Playwright's default color threshold (`threshold` 0.2): a slight change of tone in a pixel, or a
   pixel of aliasing, does not count. With the threshold at zero, 13 to 15 of the 88 snapshots fail between two
   identical runs on the same machine, by 1 to 9 pixels, and the snapshots start to depend on the processor
   architecture.
4. **End:** `down -v` of the isolated stack (containers, network, volume and app image), also on failure or
   Ctrl+C, and a table step → OK/FALHOU/NÃO RODOU → time.

A step that fails does not interrupt the following ones; if the stack does not start, the integration steps show up
as NÃO RODOU. The exit code is 0 only with everything OK. With the Gradle, npm and Docker caches warm, the
whole run takes 7 to 9 minutes.

#### On GitHub

- The `testes` workflow (`.github/workflows/testes.yml`) runs on every push and pull request only the part without a
  stack (step 1 above: backend, CLI and frontend).
- The `e2e` workflow (`.github/workflows/e2e.yml`) runs a part of the E2E against the image built from the
  `Dockerfile`: the chaos specs (`caos*`), the `patamar-*`, `cores-lista` and `i18n-carga`. It runs on every push and
  on pull requests that touch `frontend/`, `backend/src/main/`, the `Dockerfile`, the isolated stack's compose file or
  the workflow itself.
- After the selection, the same `e2e` workflow runs the visual regression (`frontend/e2e-visual.sh`), against the same
  snapshots as `./ci.sh`.

The selection is in the `e2e:github` script of `frontend/package.json`; to run it the way GitHub runs it, with the app
up: `cd frontend && BASE_URL=http://localhost:8084 npm run e2e:github`.

The contract, the whole E2E and the CLI acceptance stay in `./ci.sh`.

### Security scanning on GitHub

The `trivy` workflow (`.github/workflows/trivy.yml`) looks for secrets and misconfiguration (Dockerfile, Helm, compose)
on every push and pull request, and builds the `Dockerfile` image and scans it on every version tag (or by hand, in
Actions → trivy → Run workflow). It fails on high or critical vulnerabilities that already have a fix. To repeat the
image scan on your machine: `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock
ghcr.io/aquasecurity/trivy:0.70.0 image --severity HIGH,CRITICAL --ignore-unfixed <image>`.

The `codeql` workflow (`.github/workflows/codeql.yml`) runs CodeQL static analysis on the Kotlin, the TypeScript and the
workflows on every push and pull request to `main` and every Monday; the alerts are in Security → Code scanning.

Dependabot (`.github/dependabot.yml`) opens a pull request every week with the minor and patch updates for Gradle
(`backend/` and `cli/`), npm (`frontend/` and `tests/contract/`) and the Actions, and another one, for major versions
only, when there are any; for Docker (`Dockerfile` and compose) it only proposes minor and patch.

## Code standards

- Kotlin (`backend/` and `cli/`): [`docs/padroes-kotlin.md`](../padroes-kotlin.md) (in Portuguese)
- Angular: [`docs/padroes-angular.md`](../padroes-angular.md) (in Portuguese)
