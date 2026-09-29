#!/usr/bin/env bash
# CI local: roda o que um pipeline rodaria. Unidade, lint e build de backend, cli e frontend; depois
# contrato, E2E da tela, regressão visual e aceite do CLI contra um stack isolado (projeto compose `webhookci`, porta
# 8088, Redis e volume próprios), que é derrubado no fim com `down -v`, mesmo com falha ou Ctrl+C.
# Uma etapa que falha não interrompe as seguintes; o resumo mostra o quadro inteiro e a saída é
# diferente de 0 se alguma falhou ou não rodou.
#
# Compatível com o bash 3.2 do macOS.

set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$RAIZ" || exit 1

PORTA=8088
URL="http://localhost:$PORTA"
COMPOSE=(docker compose -p webhookci -f docker-compose.yml -f docker-compose.ci.yml)
export CI=true

NOMES=()
SITUACOES=()
TEMPOS=()

registrar() {
  NOMES+=("$1")
  SITUACOES+=("$2")
  TEMPOS+=("$3")
}

# etapa <nome> <comando...>: roda, mede e registra OK/FALHOU. Devolve o status do comando.
etapa() {
  local nome=$1 inicio=$SECONDS status
  shift
  printf '\n\033[1m==> %s\033[0m\n' "$nome"
  "$@"
  status=$?
  if [ "$status" -eq 0 ]; then
    registrar "$nome" OK $((SECONDS - inicio))
  else
    registrar "$nome" FALHOU $((SECONDS - inicio))
  fi
  return "$status"
}

falta() {
  echo "ci.sh: $1" >&2
  exit 1
}

versao_maior() { # primeira sequência de dígitos da saída
  grep -oE '[0-9]+' | head -1
}

checar_prerequisitos() {
  command -v docker >/dev/null || falta "Docker não encontrado; instale o Docker Desktop (ou o engine) e tente de novo"
  docker info >/dev/null 2>&1 || falta "o Docker não responde; abra o Docker Desktop (ou suba o daemon) e tente de novo"
  docker compose version >/dev/null 2>&1 || falta "docker compose (v2) não encontrado"
  command -v java >/dev/null || falta "Java não encontrado; o backend e o CLI precisam do Java 25"
  local java
  java=$(java -version 2>&1 | head -1 | sed -E 's/^[^"]*"//' | versao_maior)
  [ "$java" = 25 ] || falta "Java 25 necessário (o toolchain do Gradle pede 25); o java do PATH é o $java"
  command -v node >/dev/null || falta "Node não encontrado; o frontend e as suítes precisam do Node 24"
  local node
  node=$(node -v | versao_maior)
  [ "$node" -ge 24 ] || falta "Node 24 necessário; o node do PATH é o $node"
  command -v curl >/dev/null || falta "curl não encontrado (usado para esperar o app subir)"
}

# --- Etapas ---------------------------------------------------------------------------------------

backend_check() { (cd backend && ./gradlew check); }
cli_check() { (cd cli && ./gradlew check installDist); }
frontend_npm_ci() { (cd frontend && npm ci --no-audit --no-fund); }
frontend_lint() { (cd frontend && npx ng lint); }
frontend_stylelint() { (cd frontend && npm run -s lint:styles); }
# Texto novo sem extração: o messages.json (fonte do pt-BR) tem de sair igual do ng extract-i18n.
frontend_i18n() {
  (cd frontend && npx ng extract-i18n && git diff --exit-code src/locale/messages.json)
}
frontend_prettier() { (cd frontend && npx prettier --check .); }
frontend_test() { (cd frontend && npx ng test --watch=false); }
frontend_build() { (cd frontend && npx ng build); }

STACK_NO_AR=0
derrubar_stack() {
  [ "$STACK_NO_AR" -eq 1 ] || return 0
  STACK_NO_AR=0
  printf '\n\033[1m==> derrubando o stack isolado (webhookci)\033[0m\n'
  "${COMPOSE[@]}" down -v --rmi local --remove-orphans
}

subir_stack() {
  STACK_NO_AR=1
  # Sobra de uma execução morta sem trap (kill -9) ocuparia a porta.
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1
  if lsof -nP -iTCP:"$PORTA" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "a porta $PORTA está ocupada por outro processo; libere-a (lsof -iTCP:$PORTA -sTCP:LISTEN)" >&2
    return 1
  fi
  "${COMPOSE[@]}" up -d --build || return 1
  local limite=$((SECONDS + 180))
  until curl -fsS -o /dev/null "$URL/"; do
    if [ "$SECONDS" -ge "$limite" ]; then
      echo "o app não respondeu em $URL em 180 s" >&2
      "${COMPOSE[@]}" logs --tail 50 app
      return 1
    fi
    sleep 2
  done
  echo "app no ar em $URL"
}

contrato() {
  (cd tests/contract && npm ci --no-audit --no-fund &&
    BASE_URL="$URL" TETO_PADRAO=10000 WEBHOOK_FAULT_HOLD_MAX=30 npx playwright test)
}

e2e_frontend() {
  (cd frontend && npx playwright install chromium && BASE_URL="$URL" npx playwright test)
}

# Regressão visual (item 14, E11) na imagem Docker do Playwright da versão instalada: os pixels só batem com a mesma
# fonte e o mesmo rasterizador. O container chega ao stack por host.docker.internal (na lista de WEBHOOK_ALLOWED_HOSTS).
# Baselines em frontend/e2e/visual.spec.ts-snapshots; para regravar: (cd frontend && ./e2e-visual.sh <URL> -u).
regressao_visual() {
  (cd frontend && ./e2e-visual.sh "$URL")
}

aceite_cli() {
  (cd tests/cli && WEBHOOK_SERVER="$URL" WEBHOOK_CLI=cli/build/install/anzol/bin/anzol node --test)
}

# --- Resumo ---------------------------------------------------------------------------------------

duracao() { printf '%dm%02ds' $(($1 / 60)) $(($1 % 60)); }

# Preenche à direita contando caracteres (o printf do bash conta bytes, e "NÃO" tem 4).
preencher() {
  local texto=$1 largura=$2
  printf '%s' "$texto"
  local i=${#texto}
  while [ "$i" -lt "$largura" ]; do
    printf ' '
    i=$((i + 1))
  done
}

resumo() {
  local total=$1 i falhas=0
  printf '\n\033[1mResumo do CI local\033[0m\n\n'
  preencher "Etapa" 40; preencher "Situação" 11; printf 'Tempo\n'
  preencher "-----" 40; preencher "--------" 11; printf -- '-----\n'
  for i in "${!NOMES[@]}"; do
    preencher "${NOMES[$i]}" 40
    preencher "${SITUACOES[$i]}" 11
    if [ "${TEMPOS[$i]}" = - ]; then printf -- '-\n'; else duracao "${TEMPOS[$i]}"; printf '\n'; fi
    [ "${SITUACOES[$i]}" = OK ] || falhas=$((falhas + 1))
  done
  printf '\nTotal: %s. ' "$(duracao "$total")"
  if [ "$falhas" -eq 0 ]; then
    printf 'Tudo verde.\n'
    return 0
  fi
  printf '%d etapa(s) falharam ou não rodaram.\n' "$falhas"
  return 1
}

# --- Execução -------------------------------------------------------------------------------------

checar_prerequisitos

INICIO=$SECONDS
trap derrubar_stack EXIT
trap 'exit 130' INT TERM

etapa "backend: gradlew check" backend_check
etapa "cli: gradlew check installDist" cli_check
etapa "frontend: npm ci" frontend_npm_ci
etapa "frontend: ng lint" frontend_lint
etapa "frontend: stylelint" frontend_stylelint
etapa "frontend: i18n extraído (messages.json)" frontend_i18n
etapa "frontend: prettier --check" frontend_prettier
etapa "frontend: ng test" frontend_test
etapa "frontend: ng build" frontend_build

INTEGRACAO=(
  "contrato (tests/contract)"
  "E2E da tela (frontend/e2e)"
  "regressão visual (Docker Playwright)"
  "aceite do CLI (tests/cli)"
)
if etapa "stack isolado: build e subida" subir_stack; then
  etapa "${INTEGRACAO[0]}" contrato
  etapa "${INTEGRACAO[1]}" e2e_frontend
  etapa "${INTEGRACAO[2]}" regressao_visual
  etapa "${INTEGRACAO[3]}" aceite_cli
else
  for nome in "${INTEGRACAO[@]}"; do registrar "$nome" "NÃO RODOU" -; done
fi

derrubar_stack
resumo $((SECONDS - INICIO))
