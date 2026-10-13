# Imagem única: o Spring Boot serve a API, o webhook, o SSE e a tela Angular.
# Todas as bases são multi-arquitetura (amd64/arm64): roda nativa no Mac com Apple Silicon.

# Os estágios frontend e backend rodam na plataforma de quem constrói, não na da imagem: os estáticos e o jar saem iguais
# em qualquer arquitetura, e emulados (QEMU) são muito mais lentos.
FROM --platform=$BUILDPLATFORM node:24-slim AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx ng build
# Antes da compressão: o .gz e o .br do index.html saem dele já com o preload da tradução.
RUN node preload-translation.mjs dist/frontend
# Cada .js e .css do build e o index.html ganham um .gz e um .br ao lado, que o FrontendResources e o IndexController
# entregam a quem os aceita.
RUN node -e "const fs = require('node:fs'), zlib = require('node:zlib'); \
    for (const nome of fs.readdirSync('dist/frontend')) { \
      if (!nome.endsWith('.js') && !nome.endsWith('.css') && nome !== 'index.html') continue; \
      const bytes = fs.readFileSync('dist/frontend/' + nome); \
      fs.writeFileSync('dist/frontend/' + nome + '.gz', zlib.gzipSync(bytes, { level: 9 })); \
      fs.writeFileSync('dist/frontend/' + nome + '.br', zlib.brotliCompressSync(bytes)); \
    }"

FROM --platform=$BUILDPLATFORM eclipse-temurin:25-jdk AS backend
WORKDIR /src
COPY backend/gradlew backend/settings.gradle.kts backend/build.gradle.kts ./
COPY backend/gradle gradle
RUN ./gradlew --no-daemon dependencies > /dev/null
COPY backend/config config
COPY backend/src/main src/main
# O build do Angular vira recurso estático do jar (IndexController e FrontendResources).
COPY --from=frontend /src/dist/frontend/ src/main/resources/static/
# Os testes precisam de Docker (Testcontainers) e rodam fora da imagem: cd backend && ./gradlew check
# A versão que o app diz no /version: a tag, sem o "v", passada por quem constrói. O Gradle a lê do ambiente.
ARG ANZOL_VERSION=dev
RUN ./gradlew --no-daemon bootJar
# O app roda extraído (app.jar fino, com as bibliotecas em lib/ ao lado). Do jar único, com as bibliotecas aninhadas,
# ele para de responder quando a primeira leva de pedidos chega em paralelo logo depois de subir.
RUN cp build/libs/backend-*.jar app.jar && java -Djarmode=tools -jar app.jar extract --destination /extraido

FROM eclipse-temurin:25-jre
WORKDIR /app
RUN useradd --system --no-create-home anzol
COPY --from=backend /extraido/ ./
USER anzol
EXPOSE 8080
# A imagem não tem curl nem wget: o pedido sai pelo /dev/tcp do bash. Saudável só com o 200 do /health (Redis no ar).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=2s --retries=3 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /health HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3 && read -r _ status _ <&3 && [ \"$status\" = 200 ]"]
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
