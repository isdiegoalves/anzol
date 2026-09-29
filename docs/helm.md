# Helm

O chart `anzol` em `helm/` sobe no Kubernetes o mesmo que o `docker-compose.yml`: o app (imagem
`ghcr.io/isdiegoalves/anzol`, porta 8080, uma réplica) e um Redis 8 como StatefulSet com PVC, `--maxmemory` e
`noeviction`, gravando o `dump.rdb` em `/data`. O workflow `imagem` (`.github/workflows/imagem.yml`) publica a imagem no
`ghcr.io`, para amd64 e arm64, a cada tag de versão `vX.Y.Z` enviada ao GitHub (tags `X.Y.Z`, `X.Y` e `latest`); informe
a tag publicada. Sem tag de versão publicada, construa com o `Dockerfile` da raiz e publique você mesmo.

```bash
helm install anzol ./helm -f valores.yaml
# chave da IA, se houver, sem passar por arquivo:
helm install anzol ./helm -f valores.yaml --set-string anzol.ai.apiKey="$ANZOL_AI_API_KEY"
```

Um `valores.yaml` mínimo para publicar atrás do ingress-nginx:

```yaml
image:
  tag: <tag publicada>
ingress:
  enabled: true
  hosts: [anzol.example.com]
  tls:
    - secretName: anzol-tls
      hosts: [anzol.example.com]
```

- **`ANZOL_ALLOWED_HOSTS`** é montado pelo chart: loopback (o `kubectl port-forward`), cada host de `ingress.hosts`
  (com `:443` os que têm TLS) e o que vier em `anzol.allowedHosts`. Um nome fora dessa lista abre a tela, mas a API
  responde 403 (ver [Proteção contra DNS rebinding/CSRF](privacidade.md#proteção-contra-dns-rebindingcsrf)); outro acesso que não o
  Ingress (um LoadBalancer, um DNS a mais) vai em `anzol.allowedHosts`.
- **Ingress**: os annotations do `values.yaml` são do ingress-nginx e são necessários: `proxy-buffering: "off"` para o
  SSE, `proxy-read-timeout` longo para o SSE, o `requests/wait` (até 300 s) e a IA (até 90 s), `proxy-body-size: 2m`
  para o app ser quem corta o corpo e `proxy-buffer-size: 64k` para os cabeçalhos das regras de resposta.
- **Redis externo**: `redis.external.host` (e `port`) no lugar do StatefulSet; a senha, se houver, vai em `extraEnv`
  como `SPRING_DATA_REDIS_PASSWORD` com `valueFrom.secretKeyRef`.
- **IA**: `anzol.ai.*`; a chave vem de um Secret (`anzol.ai.existingSecret`, ou o criado a partir de
  `anzol.ai.apiKey` na instalação), nunca em texto no Deployment nem num values versionado.
- **Observabilidade**: as variáveis `OTEL_*` da [Observabilidade](operacao.md#observabilidade) vão no mapa `otel`.
- `anzol.outbound.allowPrivate` e `anzol.mcp.enabled` ficam `false` no chart: no cluster, o primeiro abre o replay e
  o send para o Redis e qualquer Service, e o MCP não tem autenticação.

Sem actuator, as probes usam `GET /` (o `index.html`, lido do jar). O container do app roda como o usuário `anzol`
(uid 999), sem privilégios e com o sistema de arquivos só-leitura, com um `emptyDir` em `/tmp` para o Tomcat e a JVM.
Cada opção está comentada em [`helm/values.yaml`](../helm/values.yaml).
