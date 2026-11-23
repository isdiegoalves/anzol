# Helm

[![English](https://img.shields.io/badge/English-1B5A68?style=flat-square)](helm.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-6B737C?style=flat-square)](../helm.md)

The `anzol` chart in `helm/` brings up on Kubernetes the same thing as `docker-compose.yml`: the app (image
`ghcr.io/isdiegoalves/anzol`, port 8080, one replica) and a Redis 8 as a StatefulSet with a PVC, `--maxmemory` and
`noeviction`, writing `dump.rdb` to `/data`. The `imagem` workflow (`.github/workflows/imagem.yml`) publishes the image
to `ghcr.io`, for amd64 and arm64, on every version tag `vX.Y.Z` pushed to GitHub (tags `X.Y.Z`, `X.Y` and `latest`).
The chart uses the image of its own version (the `appVersion` in `helm/Chart.yaml`, the release it came from);
`image.tag` swaps it for another. With no published version tag, build with the `Dockerfile` at the root and publish it
yourself.

```bash
helm install anzol ./helm -f values.yaml
# the AI key, if you have one, without going through a file:
helm install anzol ./helm -f values.yaml --set-string anzol.ai.apiKey="$ANZOL_AI_API_KEY"
```

A minimal `values.yaml` to publish behind ingress-nginx:

```yaml
ingress:
  enabled: true
  hosts: [anzol.example.com]
  tls:
    - secretName: anzol-tls
      hosts: [anzol.example.com]
```

- **`ANZOL_ALLOWED_HOSTS`** is assembled by the chart: loopback (`kubectl port-forward`), each host in `ingress.hosts`
  (with `:443` for the ones that have TLS) and whatever comes in `anzol.allowedHosts`. A name outside this list opens
  the web UI, but the API answers 403 (see [DNS rebinding/CSRF protection](privacy.md#dns-rebindingcsrf-protection));
  any access other than the Ingress (a LoadBalancer, an extra DNS name) goes in `anzol.allowedHosts`.
- **Ingress**: the annotations in `values.yaml` are for ingress-nginx and are required: `proxy-buffering: "off"` for
  SSE, a long `proxy-read-timeout` for SSE, `requests/wait` (up to 300 s) and the AI (up to 90 s), `proxy-body-size: 2m`
  so the app is the one that cuts the body and `proxy-buffer-size: 64k` for the response rules' headers.
- **External Redis**: `redis.external.host` (and `port`) in place of the StatefulSet; the password, if any, goes in
  `extraEnv` as `SPRING_DATA_REDIS_PASSWORD` with `valueFrom.secretKeyRef`.
- **AI**: `anzol.ai.*`; the key comes from a Secret (`anzol.ai.existingSecret`, or the one created from
  `anzol.ai.apiKey` at install time), never as plain text in the Deployment or in a versioned values file.
- **Observability**: the `OTEL_*` variables from [Observability](operations.md#observability) go in the `otel` map.
- `anzol.outbound.allowPrivate` and `anzol.mcp.enabled` stay `false` in the chart: in the cluster, the first opens
  replay and send to Redis and any Service, and MCP has no authentication.

Readiness uses `GET /health`, which only answers 200 with Redis up: without it the pod leaves the Service. Startup and
liveness use `GET /` (the `index.html`, read from the jar, without touching Redis), so that Redis being down does not
restart the app. The app container runs as the `anzol` user
(uid 999), unprivileged and with a read-only file system, with an `emptyDir` at `/tmp` for Tomcat and the JVM.
Each option is commented in [`helm/values.yaml`](../../helm/values.yaml).
