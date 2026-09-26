# Imagem única: o Spring Boot serve a API, o webhook, o SSE e a tela Angular.
# Todas as bases são multi-arquitetura (amd64/arm64): roda nativa no Mac com Apple Silicon.

FROM node:24-slim AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx ng build

FROM eclipse-temurin:25-jdk AS backend
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
RUN useradd --system --no-create-home webhook
COPY --from=backend /src/build/libs/backend-*.jar app.jar
USER webhook
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
