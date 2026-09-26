package site.webhook.telemetry

import io.opentelemetry.api.OpenTelemetry
import io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender
import org.springframework.beans.factory.InitializingBean
import org.springframework.stereotype.Component

/**
 * Liga o appender `OTEL` do `logback-spring.xml` ao OpenTelemetry do Spring: cada log sai também por OTLP,
 * com o `trace_id`/`span_id` do span corrente. Sem endpoint de logs configurado não há exportador, e o log
 * fica só no console.
 */
@Component
class OpenTelemetryLogging(
    private val openTelemetry: OpenTelemetry,
) : InitializingBean {
    override fun afterPropertiesSet() = OpenTelemetryAppender.install(openTelemetry)
}
