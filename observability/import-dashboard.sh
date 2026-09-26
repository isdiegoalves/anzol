#!/usr/bin/env bash
# Importa (cria ou atualiza) o dashboard grafana/webhook-site.json no Grafana pela API, na pasta "webhook.site".
# Credenciais só por variável de ambiente (nunca neste arquivo); a senha vai ao curl pela entrada padrão,
# fora da linha de comando (não aparece no `ps`).
#
#   GRAFANA_URL=http://localhost:3000 GRAFANA_USER=admin GRAFANA_PASSWORD=... ./observability/import-dashboard.sh
#
# Requer curl e python3. Rodar de novo atualiza o mesmo dashboard (uid fixo `webhook-site`).

set -euo pipefail

: "${GRAFANA_URL:?defina GRAFANA_URL (ex.: http://localhost:3000)}"
: "${GRAFANA_USER:?defina GRAFANA_USER}"
: "${GRAFANA_PASSWORD:?defina GRAFANA_PASSWORD}"

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD="$AQUI/grafana/webhook-site.json"
PASTA_UID="webhook-site"
PASTA_TITULO="webhook.site"
URL="${GRAFANA_URL%/}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# api <método> <caminho> [arquivo do corpo]: grava a resposta em $TMP/resposta e imprime o status HTTP.
api() {
  local corpo=() credencial="$GRAFANA_USER:$GRAFANA_PASSWORD"
  [ $# -ge 3 ] && corpo=(-H 'Content-Type: application/json' --data-binary "@$3")
  # Aspas e barras invertidas escapadas: o valor vai entre aspas no arquivo de configuração do curl.
  credencial=${credencial//\\/\\\\}
  credencial=${credencial//\"/\\\"}
  printf 'user = "%s"\n' "$credencial" |
    curl -sS -K - -X "$1" ${corpo[@]+"${corpo[@]}"} -o "$TMP/resposta" -w '%{http_code}' "$URL$2"
}

status=$(api GET "/api/folders/$PASTA_UID")
if [ "$status" = 404 ]; then
  printf '{"uid":"%s","title":"%s"}' "$PASTA_UID" "$PASTA_TITULO" > "$TMP/pasta.json"
  status=$(api POST /api/folders "$TMP/pasta.json")
fi
case "$status" in
  200) ;;
  401 | 403) echo "Grafana recusou as credenciais ($status) ao ler/criar a pasta." >&2; exit 1 ;;
  *) echo "Falha ao preparar a pasta $PASTA_TITULO ($status): $(cat "$TMP/resposta")" >&2; exit 1 ;;
esac

python3 - "$DASHBOARD" "$PASTA_UID" > "$TMP/payload.json" <<'PY'
import json, sys
dashboard = json.load(open(sys.argv[1], encoding="utf-8"))
dashboard.pop("id", None)
json.dump({"dashboard": dashboard, "folderUid": sys.argv[2], "overwrite": True,
           "message": "import-dashboard.sh"}, sys.stdout)
PY

status=$(api POST /api/dashboards/db "$TMP/payload.json")
if [ "$status" != 200 ]; then
  echo "Falha ao importar o dashboard ($status): $(cat "$TMP/resposta")" >&2
  exit 1
fi
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); print("Importado:", sys.argv[2] + r["url"], "(versão", str(r["version"]) + ")")' \
  "$TMP/resposta" "$URL"
