#!/usr/bin/env bash
# Regressão visual do item 14 (E11) na imagem Docker oficial do Playwright, na versão instalada no frontend, para os
# pixels baterem entre máquinas. O container alcança o app do host por `host.docker.internal`, que está na lista
# fechada de `ANZOL_ALLOWED_HOSTS` (item 12). Uso, de dentro de frontend/:
#
#   ./e2e-visual.sh http://localhost:8088                      # compara com as baselines commitadas
#   ./e2e-visual.sh http://localhost:8088 --update-snapshots   # regrava as baselines (revise o diff das imagens)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

base=${1:?"uso: $0 <URL do app no host> [args do playwright]"}
shift
versao=$(node -p "require('./node_modules/@playwright/test/package.json').version")
# Do container, o localhost do host é host.docker.internal.
base_no_container=$(printf '%s' "$base" | sed -E 's#//(localhost|127\.0\.0\.1)#//host.docker.internal#')

exec docker run --rm --init --ipc=host \
  --add-host=host.docker.internal:host-gateway \
  -v "$PWD":/work -w /work \
  -e CI=true -e VISUAL=1 -e BASE_URL="$base_no_container" \
  "mcr.microsoft.com/playwright:v$versao-noble" \
  npx playwright test "$@"
