# Helm

[![English](https://img.shields.io/badge/English-6B737C?style=flat-square)](en/helm.md)
[![Português (Brasil)](https://img.shields.io/badge/Portugu%C3%AAs_%28Brasil%29-1B5A68?style=flat-square)](helm.md)

Como subir o Anzol no Kubernetes com o chart `anzol`, de `helm/`. É uma página de como fazer, para quem opera o
cluster. Antes, você precisa da imagem do app publicada: a da release de onde o chart veio ou uma construída por você
(ver [Imagem e versão](#imagem-e-versão)).

## O que o chart sobe

O chart `anzol` em `helm/` sobe no Kubernetes o mesmo que o `docker-compose.yml`:

- o app: imagem `ghcr.io/isdiegoalves/anzol`, porta 8080, uma réplica;
- um Redis 8 como StatefulSet com PVC, `--maxmemory` e `noeviction`, gravando o `dump.rdb` em `/data`.

A readiness usa `GET /health`, que só responde 200 com o Redis no ar: sem ele o pod sai do Service. A partida e a
liveness usam `GET /` (o `index.html`, lido do jar, sem tocar no Redis), para que o Redis fora do ar não reinicie o
app.

O container do app roda como o usuário `anzol` (uid 999), sem privilégios e com o sistema de arquivos só-leitura, com
um `emptyDir` em `/tmp` para o Tomcat e a JVM.

## Instalar

```bash
helm install anzol ./helm -f valores.yaml
# chave da IA, se houver, sem passar por arquivo:
helm install anzol ./helm -f valores.yaml --set-string anzol.ai.apiKey="$ANZOL_AI_API_KEY"
```

Um `valores.yaml` mínimo para publicar atrás do ingress-nginx:

```yaml
ingress:
  enabled: true
  hosts: [anzol.example.com]
  tls:
    - secretName: anzol-tls
      hosts: [anzol.example.com]
```

## Imagem e versão

O chart usa a imagem da versão dele (o `appVersion` do `helm/Chart.yaml`, a release de onde ele veio); `image.tag`
troca por outra.

O workflow `imagem` (`.github/workflows/imagem.yml`) publica a imagem no `ghcr.io`, para amd64 e arm64, a cada tag de
versão `vX.Y.Z` enviada ao GitHub (tags `X.Y.Z`, `X.Y` e `latest`).

Sem tag de versão publicada, construa com o `Dockerfile` da raiz e publique você mesmo.

## Valores

Cada opção está comentada em [`helm/values.yaml`](../helm/values.yaml).

- **`ANZOL_ALLOWED_HOSTS`** é montado pelo chart: loopback (o `kubectl port-forward`), cada host de `ingress.hosts`
  (com `:443` os que têm TLS) e o que vier em `anzol.allowedHosts`. Um nome fora dessa lista abre a tela, mas a API
  responde 403 (ver [Proteção contra DNS rebinding/CSRF](privacidade.md#proteção-contra-dns-rebindingcsrf)); outro acesso que não o
  Ingress (um LoadBalancer, um DNS a mais) vai em `anzol.allowedHosts`.
- **Ingress**: os annotations do `values.yaml` são do ingress-nginx e são necessários: `proxy-buffering: "off"` para o
  SSE, `proxy-read-timeout` longo para o SSE, o `requests/wait` (até 300 s) e a [IA](glossario.md#agentes-e-cli) (até
  90 s), `proxy-body-size: 2m` para o app ser quem corta o corpo e `proxy-buffer-size: 64k` para os cabeçalhos das
  [regras de resposta](glossario.md#resposta).
- **Redis externo**: `redis.external.host` (e `port`) no lugar do StatefulSet; a senha, se houver, vai em `extraEnv`
  como `SPRING_DATA_REDIS_PASSWORD` com `valueFrom.secretKeyRef`.
- **IA**: `anzol.ai.*`; a chave vem de um Secret (`anzol.ai.existingSecret`, ou o criado a partir de
  `anzol.ai.apiKey` na instalação), nunca em texto no Deployment nem num values versionado.
- **Observabilidade**: as variáveis `OTEL_*` da [Observabilidade](operacao.md#observabilidade) vão no mapa `otel`.
- `anzol.outbound.allowPrivate` e `anzol.mcp.enabled` ficam `false` no chart: no cluster, o primeiro abre o
  [replay](glossario.md#saída-e-automação) e o send para o Redis e qualquer Service, e o
  [MCP](glossario.md#agentes-e-cli) não tem autenticação.
