#!/usr/bin/env bash
# Verificação rápida, sem Docker e sem subir o app, de saída curta: uma linha por etapa e, só nas que falham, as
# primeiras linhas do erro. Cobre lint, tipos, formato, compilação e os testes da tela; não cobre os testes do backend
# e do CLI, o E2E, o contrato nem a regressão visual, que ficam no ./ci.sh.
#
#   ./verificar.sh              as partes com mudança no git (backend, cli, frontend)
#   ./verificar.sh backend ...  só as partes nomeadas
#   ./verificar.sh --hook       para o hook Stop do Claude Code: não diz nada se passa e, se falha, sai com 2 para o
#                               agente ler o erro e corrigir antes de terminar
#
# Compatível com o bash 3.2 do macOS.

set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$RAIZ" || exit 1

HOOK=0
if [ "${1:-}" = "--hook" ]; then
  HOOK=1
  shift
  # Segunda passada do Stop, depois de o agente tentar corrigir: deixa terminar em vez de prendê-lo num laço.
  if grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then exit 0; fi
fi

PARTES=("$@")
if [ "${#PARTES[@]}" -eq 0 ]; then
  mudados=$(git status --porcelain --untracked-files=all | cut -c4-)
  for parte in backend cli frontend; do
    if printf '%s\n' "$mudados" | grep -q "^$parte/"; then PARTES+=("$parte"); fi
  done
fi
if [ "${#PARTES[@]}" -eq 0 ]; then
  [ "$HOOK" -eq 1 ] || echo "verificar: nada mudou em backend, cli ou frontend"
  exit 0
fi

SAIDA="$(mktemp)"
RELATORIO="$(mktemp)"
trap 'rm -f "$SAIDA" "$RELATORIO"' EXIT
FALHAS=0
ETAPAS=0
INICIO=$SECONDS

# etapa <nome> <comando...>: roda com a saída guardada e conta uma linha; se falha, junta o começo do erro.
etapa() {
  local nome=$1 inicio=$SECONDS
  shift
  ETAPAS=$((ETAPAS + 1))
  if "$@" >"$SAIDA" 2>&1; then
    printf 'ok      %3ds  %s\n' $((SECONDS - inicio)) "$nome" >>"$RELATORIO"
  else
    FALHAS=$((FALHAS + 1))
    printf 'FALHOU  %3ds  %s\n' $((SECONDS - inicio)) "$nome" >>"$RELATORIO"
    sed -E $'s/\033\\[[0-9;]*[A-Za-z]//g' "$SAIDA" |
      grep -v -E '^[[:space:]]*$|^\* (Try|Get more help|What went wrong)|^> (Run with|Task :|Get more help)|^BUILD FAILED|^FAILURE:|^WARNING:|^Successfully generated|^[0-9]+ actionable|^Consider enabling|^\[Incubating\]|^[0-9]+: Task failed|^[-=]{5,}$|^[ >]*(Execution failed|A failure occurred|KtLint found|Analysis failed)|^ +- .*build/reports' |
      sed "s#$RAIZ/##g" | head -20 | sed 's/^/        /' >>"$RELATORIO"
  fi
}

gradle_lint() { (cd "$1" && ./gradlew --continue --console=plain ktlintCheck detekt compileTestKotlin); }
sem_dependencias() { echo "frontend/node_modules não existe: rode (cd frontend && npm ci)"; return 1; }
frontend_i18n() { (cd frontend && npx ng extract-i18n && git diff --exit-code src/locale/messages.json); }

for parte in "${PARTES[@]}"; do
  case "$parte" in
    backend) etapa "backend: ktlint, detekt, compilação" gradle_lint backend ;;
    cli) etapa "cli: ktlint, detekt, compilação" gradle_lint cli ;;
    frontend)
      if [ ! -d frontend/node_modules ]; then
        etapa "frontend: dependências" sem_dependencias
      else
        etapa "frontend: ng lint" bash -c 'cd frontend && npx ng lint'
        etapa "frontend: tipos dos E2E" bash -c 'cd frontend && npx tsc --noEmit -p e2e/tsconfig.json'
        etapa "frontend: stylelint" bash -c 'cd frontend && npm run -s lint:styles'
        etapa "frontend: i18n extraído" frontend_i18n
        etapa "frontend: prettier" bash -c 'cd frontend && npx prettier --check .'
        etapa "frontend: ng test" bash -c 'cd frontend && npx ng test --watch=false'
      fi
      ;;
    *)
      echo "verificar: parte desconhecida '$parte' (backend, cli ou frontend)" >&2
      exit 64
      ;;
  esac
done

if [ "$FALHAS" -eq 0 ]; then
  [ "$HOOK" -eq 1 ] && exit 0
  cat "$RELATORIO"
  printf 'verificar: tudo certo, %d etapas em %ds\n' "$ETAPAS" $((SECONDS - INICIO))
  exit 0
fi

saida_final() {
  cat "$RELATORIO"
  printf 'verificar: %d de %d etapas falharam, em %ds\n' "$FALHAS" "$ETAPAS" $((SECONDS - INICIO))
}
if [ "$HOOK" -eq 1 ]; then
  saida_final >&2
  exit 2
fi
saida_final
exit 1
