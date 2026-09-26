package site.webhook.outbound

import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import site.webhook.RequestId
import site.webhook.telemetry.WebhookTelemetry
import site.webhook.token.Token
import site.webhook.token.legacyNow
import java.time.Clock
import java.time.Duration
import java.util.UUID

@Configuration(proxyBeanMethods = false)
class OutboundConfiguration {
    /** O motor com o resolvedor do sistema; fechado junto com o contexto. */
    @Bean
    fun outboundClient(properties: OutboundProperties): OutboundClient = OutboundClient(properties)
}

/**
 * Um disparo de replay ou send: sai pelo motor, vira [OutboundResult], entra no histórico da URL e conta na métrica.
 * O log leva só o token, o tipo, o resultado e o tempo: nem URL, nem cabeçalhos, nem corpo.
 */
@Component
class OutboundService(
    private val client: OutboundClient,
    private val store: OutboundStore,
    private val telemetry: WebhookTelemetry,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    fun dispatch(
        token: Token,
        kind: OutboundKind,
        request: OutboundRequest,
        source: RequestId? = null,
    ): OutboundResult {
        val at = clock.legacyNow()
        val started = System.nanoTime()
        val exchange = client.exchange(request)
        val duration = Duration.ofNanos(System.nanoTime() - started)
        val answer = (exchange.answer as? Checked.Ok)?.value
        val result =
            OutboundResult(
                id = UUID.randomUUID(),
                kind = kind,
                at = at,
                target = exchange.target,
                method = request.method,
                requestHeaders = request.headers.toMap(),
                status = answer?.status,
                headers = answer?.headers,
                body = answer?.body,
                truncated = answer?.truncated,
                durationMs = duration.toMillis(),
                error = (exchange.answer as? Checked.Refused)?.error,
                sourceRequest = source,
            )
        store.record(token.uuid, result)
        telemetry.outbound(kind.id, result.outcome())
        log.info("[OUTBOUND] {} {} {} ({} ms)", token.uuid, kind.id, result.outcome(), result.durationMs)
        return result
    }
}
