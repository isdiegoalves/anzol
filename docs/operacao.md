# Operação

## Configuração

| Variável (serviço `app`) | Padrão | O que faz |
|---|---|---|
| `ANZOL_MAX_REQUESTS` | `10000` | Mensagens guardadas por URL sem limpeza automática (`auto_cleanup` nulo). Ao passar, a mais antiga sai; a URL nunca para de receber. Com `auto_cleanup`, vale o limite da URL |
| `ANZOL_EXPIRY` | `604800` | Segundos até um token e suas mensagens expirarem (renovado a cada uso) |
| `ANZOL_FAULT_HOLD_MAX` | `300` | Segundos, no máximo, que as falhas `hang` e `stall_after_headers` das regras prendem a conexão; ela fecha antes se o cliente desistir |
| `ANZOL_OUTBOUND_ALLOW_PRIVATE` | `false` | Replay e send podem sair para loopback, redes privadas, CGNAT e ULA (ver [Reenvio e envio pelo servidor](api.md#reenvio-e-envio-pelo-servidor)). O `docker-compose.yml` liga e por isso publica a porta só em `127.0.0.1` (`"127.0.0.1:8084:8080"`); **deixe `false` ao publicar** |
| `ANZOL_OUTBOUND_LOCALHOST_ALIAS` | vazio | Nome que substitui `localhost`/`127.0.0.1`/`::1` no alvo do replay e do send. O `docker-compose.yml` usa `host.docker.internal` (o Mac, onde roda o app local) |
| `ANZOL_MCP_ENABLED` | `false` | Servidor MCP em `/mcp` (ver [MCP](mcp-e-ia.md#mcp)). O `docker-compose.yml` liga |
| `ANZOL_AI_ENABLED`, `ANZOL_AI_*` | `false` | IA local: `rules/suggest` e `explain` com um LLM OpenAI-compatível (ver [IA local](mcp-e-ia.md#ia-local)). O `docker-compose.yml` liga, apontando para o oMLX do Mac |
| `ANZOL_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1],host.docker.internal` | Nomes aceitos no `Host` das rotas de gestão e do `/mcp`, contra DNS rebinding; o `Origin` dos métodos que mudam estado só passa na mesma porta do `Host` ou com `nome:porta` na lista, contra CSRF (ver [Proteção contra DNS rebinding/CSRF](privacidade.md#proteção-contra-dns-rebindingcsrf)). Vazio vale o padrão. `*` desliga a conferência da gestão: **inseguro** |

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
