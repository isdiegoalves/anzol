plugins {
    kotlin("jvm") version "2.4.20"
    kotlin("plugin.spring") version "2.4.20"
    id("org.springframework.boot") version "4.1.1"
    id("io.spring.dependency-management") version "1.1.7"
    id("org.jlleitschuh.gradle.ktlint") version "14.2.0"
    id("dev.detekt") version "2.0.0-alpha.6"
}

group = "anzol"
version = "0.0.1-SNAPSHOT"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
}

dependencyManagement {
    imports {
        // Spring AI 2.0.1 é compilado contra o Spring Boot 4.1.1 (o mesmo deste projeto) e o Spring Framework 7.0.9.
        mavenBom("org.springframework.ai:spring-ai-bom:2.0.1")
    }
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-opentelemetry")
    // Logs do Logback também por OTLP; a versão compilada com a mesma API do OpenTelemetry (1.62) do Spring Boot.
    implementation("io.opentelemetry.instrumentation:opentelemetry-logback-appender-1.0:2.28.1-alpha")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("tools.jackson.module:jackson-module-kotlin")
    implementation("com.jayway.jsonpath:json-path")
    // Cache dos templates de regra já compilados (versão do Spring Boot).
    implementation("com.github.ben-manes.caffeine:caffeine")
    // Templates das regras de resposta. Sem o Nashorn: helpers em JavaScript nunca são registrados.
    implementation("com.github.jknack:handlebars:4.5.5") {
        exclude(group = "org.openjdk.nashorn")
    }
    // JSON Schema da URL (drafts 7, 2019-09 e 2020-12) sobre o Jackson 3. A 3.0.6 é compilada com o
    // Jackson 3.1.4, a mesma linha 3.1 que o Spring Boot impõe; a 3.0.7 já exige o 3.2.
    implementation("com.networknt:json-schema-validator:3.0.6")
    // Motor de saída do replay/send: aceita o IP já validado (HttpHost com endereço) e mantém o nome no Host e no
    // SNI, sem resolver de novo. Versão do Spring Boot (5.6).
    implementation("org.apache.httpcomponents.client5:httpclient5")
    // Servidor MCP (Streamable HTTP sobre o Spring MVC), desligado por padrão (anzol.mcp.enabled).
    implementation("org.springframework.ai:spring-ai-starter-mcp-server-webmvc")
    // Cliente de LLM OpenAI-compatível (o oMLX local), montado à mão só com anzol.ai.enabled: sem o starter, nada de
    // autoconfiguração exigindo chave na inicialização.
    implementation("org.springframework.ai:spring-ai-openai")
    implementation("org.springframework.ai:spring-ai-client-chat")
    testImplementation("org.springframework.boot:spring-boot-starter-data-redis-test")
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.awaitility:awaitility")
    // Exportadores em memória: os testes conferem os spans e os logs sem mandar nada para fora.
    testImplementation("io.opentelemetry:opentelemetry-sdk-testing")
    // Os tipos dos exportadores OTLP (o starter os traz só em runtime), para conferir que ficam desligados.
    testImplementation("io.micrometer:micrometer-registry-otlp")
    testImplementation("io.opentelemetry:opentelemetry-exporter-otlp")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
    compilerOptions {
        freeCompilerArgs.addAll("-Xjsr305=strict")
    }
}

tasks.withType<Test> {
    useJUnitPlatform()
    // O Spring Boot lê as variáveis OTEL_* do ambiente: um shell com exportação ligada não pode fazer os testes exportarem.
    environment = environment.filterKeys { !it.startsWith("OTEL_") }
}

ktlint {
    version = "1.8.0"
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(files("config/detekt.yml"))
}

// Regras como UnsafeCallOnNullableType e NestedScopeFunctions só rodam com resolução de tipos.
tasks.check {
    dependsOn("detektMain", "detektTest")
}

// O plugin de dependências do Spring impõe a versão do Kotlin do projeto a toda configuração.
// detekt e ktlint embutem o compilador Kotlin e só funcionam com a versão com que foram
// compilados: detekt 2.0.0-alpha.6 → 2.4.10, ktlint 1.8.0 → 2.2.21.
val kotlinOfLintTool = mapOf("detekt" to "2.4.10", "ktlint" to "2.2.21")
configurations.configureEach {
    val toolKotlin = kotlinOfLintTool.entries.firstOrNull { name.startsWith(it.key) }?.value
    if (toolKotlin != null) {
        resolutionStrategy.eachDependency {
            if (requested.group == "org.jetbrains.kotlin") useVersion(toolKotlin)
        }
    }
}

tasks.jar {
    enabled = false
}
