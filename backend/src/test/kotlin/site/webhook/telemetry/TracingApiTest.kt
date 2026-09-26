package site.webhook.telemetry

import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.sdk.logs.SdkLoggerProvider
import io.opentelemetry.sdk.testing.exporter.InMemoryLogRecordExporter
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter
import io.opentelemetry.sdk.trace.SdkTracerProvider
import io.opentelemetry.sdk.trace.data.SpanData
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import tools.jackson.databind.json.JsonMapper
import java.util.concurrent.TimeUnit

/** Exportadores em memória no lugar do OTLP: o Spring os liga aos processadores em lote como liga os de verdade. */
@TestConfiguration(proxyBeanMethods = false)
class InMemoryExportersConfiguration {
    @Bean
    fun spanExporter(): InMemorySpanExporter = InMemorySpanExporter.create()

    @Bean
    fun logRecordExporter(): InMemoryLogRecordExporter = InMemoryLogRecordExporter.create()
}

private fun SpanData.attribute(name: String): String? = attributes.get(AttributeKey.stringKey(name))

@ApiTest
@Import(InMemoryExportersConfiguration::class)
@DisplayName("Traces e logs da captura")
class TracingApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val spans: InMemorySpanExporter,
    private val logs: InMemoryLogRecordExporter,
    private val tracerProvider: SdkTracerProvider,
    private val loggerProvider: SdkLoggerProvider,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun serverSpanOf(tokenId: String): SpanData {
        tracerProvider.forceFlush().join(5, TimeUnit.SECONDS)
        return spans.finishedSpanItems.single { it.attribute("webhook.token") == tokenId }
    }

    @Test
    @DisplayName("Dada uma regra que casa, quando captura, então o span da requisição leva o token e o resultado, e o token não vira nome")
    fun capture_regraCasada_deveAnotarOSpan() {
        val tokenId = api.tokenId()
        api.send("PUT", "/token/$tokenId/rules", """[{"name":"ok","response":{"status":201}}]""".toByteArray(), JSON_BODY)

        api.send("POST", "/$tokenId/pedido")

        val span = serverSpanOf(tokenId)
        assertThat(span.attribute("webhook.rule.matched")).isEqualTo("true")
        assertThat(span.attribute("webhook.status")).isEqualTo("201")
        assertThat(span.attribute("webhook.signature")).isEqualTo("none")
        assertThat(span.attribute("webhook.schema")).isEqualTo("none")
        assertThat(span.attribute("webhook.fault")).isEqualTo("none")
        assertThat(span.name).doesNotContain(tokenId)
        assertThat(span.resource.getAttribute(AttributeKey.stringKey("service.name"))).isEqualTo("webhook-site")
    }

    @Test
    @DisplayName("Dado um log dentro de uma requisição, quando exporta, então o registro leva o trace_id e o span_id da requisição")
    fun log_dentroDaRequisicao_deveLevarOTrace() {
        val tokenId = api.tokenId()

        api.send("PUT", "/token/$tokenId/cors/toggle")

        tracerProvider.forceFlush().join(5, TimeUnit.SECONDS)
        loggerProvider.forceFlush().join(5, TimeUnit.SECONDS)
        val record = logs.finishedLogRecordItems.single { it.bodyValue?.asString() == "[CORS] $tokenId toggle" }
        val request = spans.finishedSpanItems.single { it.traceId == record.spanContext.traceId && it.parentSpanId == "0000000000000000" }
        assertThat(record.spanContext.isValid).isTrue()
        assertThat(
            request.attributes
                .asMap()
                .values
                .map { it.toString() },
        ).anyMatch { it.contains("/cors/toggle") }
    }
}
