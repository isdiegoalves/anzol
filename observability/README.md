# Observabilidade do Anzol

O app exporta métricas, traces e logs por OTLP quando o ambiente liga (`docker-compose.yml`, variáveis
`OTEL_*`); o destino é o Grafana Alloy do stack de observabilidade local, que grava métricas no Mimir, traces
no Tempo e logs no Loki. Este diretório tem o dashboard desses dados e o script que o importa no Grafana.

| Arquivo | O que é |
|---|---|
| `grafana/anzol.json` | Dashboard `Anzol` (uid `anzol`): capturas, respostas (regras, assinatura, schema, falhas de rede), latência, 507 e limpeza, SSE e esperas, erros 5xx do app, JVM, logs e traces |
| `import-dashboard.sh` | Cria ou atualiza o dashboard pela API do Grafana, na pasta `Anzol` |

O dashboard espera os datasources com os uids `prometheus` (Mimir), `tempo` e `loki`, os do
`observability-stack/grafana/datasources/grafana-datasources.yml`. A variável **Instância** separa o app do
`docker-compose.yml` (`anzol-local`, o padrão) dos stacks de teste (`anzol-dev`).

## Importar pela API

Usuário e senha do Grafana só por variável de ambiente; o script não os grava nem os passa na linha de comando.

```bash
GRAFANA_URL=http://localhost:3000 GRAFANA_USER=admin GRAFANA_PASSWORD='…' ./observability/import-dashboard.sh
```

Rodar de novo atualiza o mesmo dashboard (sobrescreve edições feitas na tela: mude o JSON e importe).

## Alternativa: provisionar pelo diretório

Em vez da API, o Grafana do `observability-stack` pode ler o dashboard direto deste repositório, como já faz
com o `mensageria`: o provisionamento dele usa `foldersFromFilesStructure`, então cada subdiretório montado vira
uma pasta. No `observability-stack/docker-compose.yml`, serviço `grafana`, acrescente o volume (caminho relativo
ao `observability-stack`; ajuste se os repositórios não forem vizinhos):

```yaml
      - ../anzol/observability/grafana:/etc/grafana/provisioning/dashboards/anzol
```

e recrie o Grafana (`docker compose up -d grafana`). O dashboard aparece na pasta `anzol` e
acompanha o arquivo a cada 10 s. Use uma forma só: com os dois, o provisionado e o importado disputam o
mesmo uid.
