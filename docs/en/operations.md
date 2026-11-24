# Operations

[![English](https://img.shields.io/badge/English-1B5A68?style=flat-square)](operations.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-6B737C?style=flat-square)](../operacao.md)

How to configure and keep an eye on the Anzol server you start with `docker-compose.yml`: variables, health and
version, Redis memory and observability. This is a how-to page, with the variables table as reference, for whoever runs
and maintains the server.

**On this page:** [Configuration](#configuration) · [Health and version](#health-and-version) ·
[Redis memory](#redis-memory) · [Observability](#observability)

## Configuration

| Variable (`app` service) | Default | What it does |
|---|---|---|
| `ANZOL_MAX_REQUESTS` | `10000` | Messages kept per URL without auto cleanup (`auto_cleanup` null). Past the limit, the oldest one goes; the URL never stops receiving. With `auto_cleanup`, the URL's limit applies |
| `ANZOL_EXPIRY` | `604800` | Seconds until a token and its messages expire (renewed on every use) |
| `ANZOL_FAULT_HOLD_MAX` | `300` | Maximum seconds that the rules' `hang` and `stall_after_headers` failures hold the connection; it closes earlier if the client gives up |
| `ANZOL_OUTBOUND_ALLOW_PRIVATE` | `false` | Replay and send can go out to loopback, private networks, CGNAT and ULA (see [Replay and server-side send](api.md#replay-and-server-side-send)). `docker-compose.yml` publishes the port only on `127.0.0.1` (`"127.0.0.1:8084:8080"`), so that turning the variable on does not open send to anyone on the same network; **leave it `false` when publishing** |
| `ANZOL_OUTBOUND_LOCALHOST_ALIAS` | empty | Name that replaces `localhost`/`127.0.0.1`/`::1` in the target of replay and send. In the compose file, `host.docker.internal` (the machine where the local app runs) |
| `ANZOL_MCP_ENABLED` | `false` | MCP server at `/mcp` (see [MCP](mcp-and-ai.md#mcp)) |
| `ANZOL_AI_ENABLED`, `ANZOL_AI_*` | `false` | Local AI: `rules/suggest` and `explain` with an OpenAI-compatible LLM (see [Local AI](mcp-and-ai.md#local-ai)) |
| `ANZOL_ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1],host.docker.internal` | Names accepted in the `Host` of the management routes and of `/mcp`, against DNS rebinding; the `Origin` of state-changing methods only passes on the same port as the `Host` or with `name:port` in the list, against CSRF (see [DNS rebinding/CSRF protection](privacy.md#dns-rebindingcsrf-protection)). Empty means the default. `*` turns off the management check: **insecure** |

### Turning things on in compose

`docker-compose.yml` starts only the defaults in the table. To turn on outbound to the local network, [MCP](glossary.md#agents-and-cli),
[local AI](glossary.md#agents-and-cli) or OTLP export, create a `docker-compose.override.yml` next to it with the variables you want from this template and run
`docker compose up -d` again. Compose loads that file on its own, and git ignores it:

```yaml
services:
  app:
    environment:
      # Replay and send reach your machine and the private network; `localhost` in the target becomes the Docker host.
      - ANZOL_OUTBOUND_ALLOW_PRIVATE=true
      - ANZOL_OUTBOUND_LOCALHOST_ALIAS=host.docker.internal
      - ANZOL_MCP_ENABLED=true
      # OpenAI-compatible LLM on your machine; the key comes from the `.env` next to it (see docs/en/mcp-and-ai.md).
      - ANZOL_AI_ENABLED=true
      - ANZOL_AI_BASE_URL=http://host.docker.internal:8000
      - ANZOL_AI_API_KEY=${ANZOL_AI_API_KEY:-}
      # Metrics, traces and logs over OTLP HTTP to a collector on your machine (see Observability, below).
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318
      - OTEL_METRICS_EXPORTER=otlp
      - OTEL_SERVICE_NAME=anzol
      - OTEL_RESOURCE_ATTRIBUTES=deployment.environment=local,service.instance.id=anzol-local
    extra_hosts:
      # host.docker.internal on Linux Docker too (Docker Desktop and OrbStack already resolve it).
      - "host.docker.internal:host-gateway"
```

## Health and version

`GET /health` responds `200` only while Redis answers a `PING` within 2 s; otherwise, `503` with
`"status": "unavailable"` and `"redis": "down"`. `GET /version` tells you the version that is running and also responds
with Redis down. Neither one checks the `Host`: they serve probes and load balancers, which arrive by IP.

```console
$ curl -s http://localhost:8084/health
{"status":"ok","version":"0.6.1","redis":"ok","ai":"off","mcp":"off"}
$ curl -s http://localhost:8084/version
{"version":"0.6.1"}
```

`ai` and `mcp` say whether local AI and the MCP server are on (`on` or `off`); the LLM itself is not queried. On
Kubernetes, the chart's readiness probe uses `/health` (see [Helm](helm.md)).

The version is the tag's: the published image receives it at build time. Built without it, as in
`docker compose up --build`, the image says `dev`. To make a local build say which point of the repository it came
from:

```bash
docker compose build --build-arg ANZOL_VERSION="$(git describe --tags | sed 's/^v//')" app
docker compose up -d app
```

On the tag it comes out as `0.6.1`; a few commits after it, `0.6.1-3-g1a2b3c4`. The CLI reads the same variable when it
is built (`cd cli && ANZOL_VERSION=… ./gradlew installDist`).

The image ships a `HEALTHCHECK` that reads `/health` every 30 s (every 2 s while the app starts): `docker ps` shows
`(healthy)` or, after three reads without the 200, `(unhealthy)`, and `docker compose up -d --wait` only returns with
the app ready.

## Redis memory

Redis starts with `--maxmemory 1gb --maxmemory-policy noeviction`: when full, it refuses writes (the webhook responds
`507 Insufficient Storage`) instead of deleting keys, so no token disappears and what is already stored stays readable.
With [requests](glossary.md#capture) of ~15 KB, 1 GB holds about 60 thousand; `ANZOL_MAX_REQUESTS` and `auto_cleanup`
limit each [URL](glossary.md#the-same-object-four-names).

The web UI warns you: every URL's `GET /token/{id}/stream` sends the `storage` event with `"full": true` after the
first 507, and with `"full": false` when a request is stored again and 30 s pass without another refusal. The warnings
go out together with the heartbeat, at most one every 15 s, however many requests arrive.

The app only knows there is space again when a write goes through: once memory is freed, the warning stays until the
next request arrives, on any URL.

Changing Redis's `command` in the compose file recreates the container, and the data stays in the volume.

## Observability

With the `OTEL_*` variables from the [template above](#turning-things-on-in-compose), the app sends metrics, traces and logs over
OTLP HTTP to a Grafana Alloy at `host.docker.internal:4318` (`service.name=anzol`, `deployment.environment=local`).
Without them (the app's default, `docker-compose.yml`, the tests and `./ci.sh`) nothing is exported, and with Alloy down
the app carries on as normal.

Business metrics:

- `anzol_requests_captured_total`, by `method`, `status_class`, `rule`, `signature`, `schema` and `fault`, never with a
  token;
- `anzol_capture_duration_seconds`, `anzol_storage_full_total`, `anzol_cleanup_removed_total`, `anzol_sse_subscribers`
  and `anzol_wait_active`;
- `anzol_outbound_total`: [replay](glossary.md#outbound-and-automation) and send, by `kind` and `outcome` (`2xx`…`5xx`,
  `blocked`, `error`); never with a URL or token;
- `anzol_ai_calls_total` and `anzol_ai_duration_seconds`: local AI, by `kind` `suggest`/`explain`, `outcome`
  `ok`/`invalid`/`error` and `model`; nothing from the prompt or the message.

Each LLM call also becomes a Spring AI span. Each capture becomes a trace with the token in `span.anzol.token`, and the
logs carry the `trace_id`.

The dashboard and the Grafana import are in [`observability/`](../../observability/README.md) (in Portuguese).
