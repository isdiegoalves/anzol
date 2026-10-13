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
RUN ./gradlew --no-daemon bootJar

FROM eclipse-temurin:25-jre
WORKDIR /app
RUN useradd --system --no-create-home anzol
COPY --from=backend /src/build/libs/backend-*.jar app.jar
USER anzol
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
