# Imagem multi-arquitetura (amd64/arm64): roda nativa no Mac com Apple Silicon.

FROM eclipse-temurin:25-jdk AS build
WORKDIR /src
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle gradle
RUN ./gradlew --no-daemon dependencies > /dev/null
COPY config config
COPY src src
# Os testes precisam de Docker (Testcontainers) e rodam fora da imagem: ./gradlew check
RUN ./gradlew --no-daemon bootJar

FROM eclipse-temurin:25-jre
WORKDIR /app
RUN useradd --system --no-create-home webhook
COPY --from=build /src/build/libs/backend-*.jar app.jar
USER webhook
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
