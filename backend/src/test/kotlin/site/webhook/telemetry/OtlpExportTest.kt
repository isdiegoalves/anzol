package site.webhook.telemetry

import io.micrometer.registry.otlp.OtlpMeterRegistry
import io.opentelemetry.exporter.otlp.http.logs.OtlpHttpLogRecordExporter
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.context.ApplicationContext
import org.springframework.context.ConfigurableApplicationContext
import org.testcontainers.containers.GenericContainer
import org.testcontainers.utility.DockerImageName
import site.webhook.BackendApplication
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import tools.jackson.databind.json.JsonMapper
import java.net.ServerSocket
import java.time.Duration

private const val REDIS_PORT = 6379

/**
 * Com o coletor fora do ar, captura e desligamento terminam neste prazo, bem abaixo dos 10 s do `docker stop`
 * (o desligamento espera no máximo o envio pendente, que desiste em 2 s: `otlp.timeout` do application.yaml).
 */
private val NO_WAIT = Duration.ofSeconds(5)

private fun ApplicationContext.otlpExporters(): List<Any> =
    listOf(OtlpMeterRegistry::class.java, OtlpHttpSpanExporter::class.java, OtlpHttpLogRecordExporter::class.java)
        .flatMap { getBeansOfType(it).values }

private fun <T> timed(call: () -> T): Pair<T, Duration> {
    val started = System.nanoTime()
    val result = call()
    return result to Duration.ofNanos(System.nanoTime() - started)
}

@ApiTest
@DisplayName("Exportação OTLP desligada por padrão")
class OtlpExportOffByDefaultTest(
    private val context: ApplicationContext,
) {
    @Test
    @DisplayName("Dada a configuração padrão (testes, ./ci.sh), quando o app sobe, então não há exportador OTLP de métricas, traces e logs")
    fun contexto_semConfiguracao_naoDeveTerExportadorOtlp() {
        assertThat(context.otlpExporters()).isEmpty()
    }
}

@DisplayName("Exportação OTLP com o coletor fora do ar")
class OtlpCollectorDownTest {
    @Test
    @DisplayName(
        "Dado o endpoint OTLP numa porta fechada, quando captura e desliga, então a captura responde e o desligamento termina sem travar",
    )
    fun exportacao_coletorForaDoAr_naoDeveTravarCapturaNemDesligamento() {
        val closedPort = ServerSocket(0).use { it.localPort }
        val endpoint = "http://127.0.0.1:$closedPort"
        GenericContainer(DockerImageName.parse("redis:7-alpine")).withExposedPorts(REDIS_PORT).use { redis ->
            redis.start()
            val app = start(redis, endpoint)
            val port = checkNotNull(app.environment.getProperty("local.server.port", Int::class.java))
            val api = ApiClient(port, app.getBean(JsonMapper::class.java))
            val tokenId = api.tokenId()

            val exporters = app.otlpExporters()

            val (captures, captureTook) = timed { (1..20).map { api.send("POST", "/$tokenId", "{}".toByteArray()).statusCode() } }
            // Deixa o registro de métricas (passo de 1 s) e os lotes de spans e logs tentarem exportar.
            Thread.sleep(Duration.ofSeconds(2))
            val (_, closeTook) = timed { app.close() }

            assertThat(exporters).hasSize(3)
            assertThat(captures).containsOnly(200)
            assertThat(captureTook).isLessThan(NO_WAIT)
            assertThat(closeTook).isLessThan(NO_WAIT)
        }
    }

    private fun start(
        redis: GenericContainer<*>,
        endpoint: String,
    ): ConfigurableApplicationContext =
        // Argumentos de linha de comando: vencem o application.yaml (as `properties` do builder perderiam para ele).
        SpringApplicationBuilder(BackendApplication::class.java).run(
            "--server.port=0",
            "--spring.data.redis.host=${redis.host}",
            "--spring.data.redis.port=${redis.getMappedPort(REDIS_PORT)}",
            "--management.otlp.metrics.export.enabled=true",
            "--management.otlp.metrics.export.url=$endpoint/v1/metrics",
            "--management.otlp.metrics.export.step=1s",
            "--management.opentelemetry.tracing.export.otlp.endpoint=$endpoint/v1/traces",
            "--management.opentelemetry.tracing.export.schedule-delay=200ms",
            "--management.opentelemetry.logging.export.otlp.endpoint=$endpoint/v1/logs",
            "--management.opentelemetry.logging.export.schedule-delay=200ms",
        )
}
