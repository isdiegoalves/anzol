# Operação

## Memória do Redis

O Redis sobe com `--maxmemory 1gb --maxmemory-policy noeviction`: cheio, recusa gravação (o
webhook responde `507 Insufficient Storage`) em vez de apagar chaves, então nenhum token some e o que já está gravado
continua legível. Com mensagens de ~15 KB, 1 GB guarda cerca de 60 mil; `ANZOL_MAX_REQUESTS` e
`auto_cleanup` limitam cada URL. Mudar o `command` do Redis no compose recria o container, e os
dados ficam no volume.

## Observabilidade

O `docker-compose.yml` manda métricas, traces e logs por OTLP HTTP para um Grafana Alloy em
`host.docker.internal:4318` (`service.name=anzol`, `deployment.environment=local`). São as variáveis
`OTEL_*` do serviço `app`: sem elas (o padrão do app, os testes e o `./ci.sh`) nada é exportado, e com o Alloy
fora do ar o app segue normal. Métricas de negócio: `anzol_requests_captured_total` (por `method`,
`status_class`, `rule`, `signature`, `schema` e `fault`, nunca com token), `anzol_capture_duration_seconds`,
`anzol_storage_full_total`, `anzol_cleanup_removed_total`, `anzol_sse_subscribers`, `anzol_wait_active` e
`anzol_outbound_total` (replay e send, por `kind` e `outcome`: `2xx`…`5xx`, `blocked`, `error`; nunca com URL ou token),
`anzol_ai_calls_total` e `anzol_ai_duration_seconds` (IA local, por `kind` `suggest`/`explain`, `outcome`
`ok`/`invalid`/`error` e `model`; nada do prompt nem da mensagem). Cada chamada ao LLM vira também um span do Spring AI.
Cada captura vira um trace com o token em `span.anzol.token`, e os logs levam o `trace_id`. O dashboard e a
importação no Grafana estão em [`observability/`](../observability/README.md).
