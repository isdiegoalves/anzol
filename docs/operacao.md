# Operação

## Configuração

| Variável (serviço `app`) | Padrão | O que faz |
|---|---|---|
| `ANZOL_MAX_REQUESTS` | `10000` | Mensagens guardadas por URL sem limpeza automática (`auto_cleanup` nulo). Ao passar, a mais antiga sai; a URL nunca para de receber. Com `auto_cleanup`, vale o limite da URL |
| `ANZOL_EXPIRY` | `604800` | Segundos até um token e suas mensagens expirarem (renovado a cada uso) |
| `ANZOL_FAULT_HOLD_MAX` | `300` | Segundos, no máximo, que as falhas `hang` e `stall_after_headers` das regras prendem a conexão; ela fecha antes se o cliente desistir |
| `ANZOL_OUTBOUND_ALLOW_PRIVATE` | `false` | Replay e send podem sair para loopback, redes privadas, CGNAT e ULA (ver [Reenvio e envio pelo servidor](api.md#reenvio-e-envio-pelo-servidor)). O `docker-compose.yml` publica a porta só em `127.0.0.1` (`"127.0.0.1:8084:8080"`), para que ligar a variável não abra o send a quem está na mesma rede; **deixe `false` ao publicar** |
| `ANZOL_OUTBOUND_LOCALHOST_ALIAS` | vazio | Nome que substitui `localhost`/`127.0.0.1`/`::1` no alvo do replay e do send. No compose, `host.docker.internal` (a máquina onde roda o app local) |
| `ANZOL_MCP_ENABLED` | `false` | Servidor MCP em `/mcp` (ver [MCP](mcp-e-ia.md#mcp)) |
| `ANZOL_AI_ENABLED`, `ANZOL_AI_*` | `false` | IA local: `rules/suggest` e `explain` com um LLM OpenAI-compatível (ver [IA local](mcp-e-ia.md#ia-local)) |
| `ANZOL_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1],host.docker.internal` | Nomes aceitos no `Host` das rotas de gestão e do `/mcp`, contra DNS rebinding; o `Origin` dos métodos que mudam estado só passa na mesma porta do `Host` ou com `nome:porta` na lista, contra CSRF (ver [Proteção contra DNS rebinding/CSRF](privacidade.md#proteção-contra-dns-rebindingcsrf)). Vazio vale o padrão. `*` desliga a conferência da gestão: **inseguro** |

### Ligar no compose

O `docker-compose.yml` sobe só o padrão da tabela. Para ligar a saída para a rede local, o MCP, a IA local ou a
exportação OTLP, crie um `docker-compose.override.yml` ao lado dele com as variáveis que quiser deste modelo e rode
`docker compose up -d` de novo. O compose carrega esse arquivo sozinho, e o git o ignora:

```yaml
services:
  app:
    environment:
      # Replay e send alcançam a sua máquina e a rede privada; `localhost` no alvo vira a máquina do Docker.
      - ANZOL_OUTBOUND_ALLOW_PRIVATE=true
      - ANZOL_OUTBOUND_LOCALHOST_ALIAS=host.docker.internal
      - ANZOL_MCP_ENABLED=true
      # LLM OpenAI-compatível na sua máquina; a chave vem do `.env` ao lado (ver docs/mcp-e-ia.md).
      - ANZOL_AI_ENABLED=true
      - ANZOL_AI_BASE_URL=http://host.docker.internal:8000
      - ANZOL_AI_API_KEY=${ANZOL_AI_API_KEY:-}
      # Métricas, traces e logs por OTLP HTTP para um coletor na sua máquina (ver Observabilidade, abaixo).
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318
      - OTEL_METRICS_EXPORTER=otlp
      - OTEL_SERVICE_NAME=anzol
      - OTEL_RESOURCE_ATTRIBUTES=deployment.environment=local,service.instance.id=anzol-local
    extra_hosts:
      # host.docker.internal também no Docker do Linux (Docker Desktop e OrbStack já o resolvem).
      - "host.docker.internal:host-gateway"
```

## Saúde e versão

`GET /health` responde `200` só enquanto o Redis responde a um `PING` em até 2 s; fora disso, `503` com
`"status": "unavailable"` e `"redis": "down"`. `GET /version` diz a versão que está rodando e responde também com o
Redis fora do ar. Nenhuma das duas confere o `Host`: servem a probes e a balanceadores, que chegam por IP.

```console
$ curl -s http://localhost:8084/health
{"status":"ok","version":"0.6.1","redis":"ok","ai":"off","mcp":"off"}
$ curl -s http://localhost:8084/version
{"version":"0.6.1"}
```

`ai` e `mcp` dizem se a IA local e o servidor MCP estão ligados (`on` ou `off`); o LLM em si não é consultado. No
Kubernetes, a readiness do chart usa `/health` (ver [Helm](helm.md)).

A versão é a da tag: a imagem publicada a recebe no build. Construída sem ela, como no `docker compose up --build`,
a imagem diz `dev`. Para um build local dizer de que ponto do repositório saiu:

```bash
docker compose build --build-arg ANZOL_VERSION="$(git describe --tags | sed 's/^v//')" app
docker compose up -d app
```

Na tag sai `0.6.1`; alguns commits depois dela, `0.6.1-3-g1a2b3c4`. O CLI lê a mesma variável ao ser construído
(`cd cli && ANZOL_VERSION=… ./gradlew installDist`).

A imagem traz um `HEALTHCHECK` que lê `/health` a cada 30 s (a cada 2 s enquanto o app sobe): o `docker ps` mostra
`(healthy)` ou, depois de três leituras sem o 200, `(unhealthy)`, e `docker compose up -d --wait` só volta com o app
pronto.

## Memória do Redis

O Redis sobe com `--maxmemory 1gb --maxmemory-policy noeviction`: cheio, recusa gravação (o
webhook responde `507 Insufficient Storage`) em vez de apagar chaves, então nenhum token some e o que já está gravado
continua legível. A tela avisa: o `GET /token/{id}/stream` de toda URL manda o evento `storage` com `"full": true`
no primeiro 507, e com `"full": false` quando a primeira mensagem volta a ser gravada. O app só sabe que há espaço de
novo quando uma gravação passa: liberada a memória, o aviso fica até a próxima mensagem chegar, em qualquer URL. Com
mensagens de ~15 KB, 1 GB guarda cerca de 60 mil; `ANZOL_MAX_REQUESTS` e `auto_cleanup` limitam cada URL. Mudar o `command` do Redis no compose recria o container, e os
dados ficam no volume.

## Observabilidade

Com as variáveis `OTEL_*` do [modelo acima](#ligar-no-compose), o app manda métricas, traces e logs por OTLP HTTP
para um Grafana Alloy em `host.docker.internal:4318` (`service.name=anzol`, `deployment.environment=local`). Sem elas
(o padrão do app, o `docker-compose.yml`, os testes e o `./ci.sh`) nada é exportado, e com o Alloy fora do ar o app
segue normal. Métricas de negócio: `anzol_requests_captured_total` (por `method`,
`status_class`, `rule`, `signature`, `schema` e `fault`, nunca com token), `anzol_capture_duration_seconds`,
`anzol_storage_full_total`, `anzol_cleanup_removed_total`, `anzol_sse_subscribers`, `anzol_wait_active` e
`anzol_outbound_total` (replay e send, por `kind` e `outcome`: `2xx`…`5xx`, `blocked`, `error`; nunca com URL ou token),
`anzol_ai_calls_total` e `anzol_ai_duration_seconds` (IA local, por `kind` `suggest`/`explain`, `outcome`
`ok`/`invalid`/`error` e `model`; nada do prompt nem da mensagem). Cada chamada ao LLM vira também um span do Spring AI.
Cada captura vira um trace com o token em `span.anzol.token`, e os logs levam o `trace_id`. O dashboard e a
importação no Grafana estão em [`observability/`](../observability/README.md).
