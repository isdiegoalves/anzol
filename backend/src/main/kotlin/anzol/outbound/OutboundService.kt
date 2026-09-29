package anzol.outbound

import anzol.RequestId
import anzol.telemetry.AnzolTelemetry
import anzol.token.Token
import anzol.token.legacyNow
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration
import java.time.LocalDateTime
import java.util.UUID

@Configuration(proxyBeanMethods = false)
class OutboundConfiguration {
    /** O motor com o resolvedor do sistema; fechado junto com o contexto. */
    @Bean
    fun outboundClient(properties: OutboundProperties): OutboundClient = OutboundClient(properties)
}

/** Um disparo que terminou (com resposta ou recusa): quando começou, o que deu, quanto levou e o caos pedido. */
data class Attempt(
    val at: LocalDateTime,
    val exchange: Exchange,
    val duration: Duration,
    val chaos: ChaosReport? = null,
)

/**
 * Um disparo de replay ou send: sai pelo motor, vira [OutboundResult], entra no histórico da URL e conta na métrica.
 * O log leva só o token, o tipo, o resultado e o tempo: nem URL, nem cabeçalhos, nem corpo.
 */
@Component
class OutboundService(
    private val client: OutboundClient,
    private val store: OutboundStore,
    private val telemetry: AnzolTelemetry,
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
        return record(token, kind, request, Attempt(at, exchange, Duration.ofNanos(System.nanoTime() - started)), source)
    }

    /** O replay com [chaos]: a primeira cópia nos campos de sempre, o caos (e a segunda cópia) no `chaos` do resultado. */
    fun replay(
        token: Token,
        request: OutboundRequest,
        source: RequestId,
        chaos: Chaos,
    ): OutboundResult {
        val at = clock.legacyNow()
        val delivery = client.exchange(request, chaos)
        val first = delivery.first
        val attempt = Attempt(at, Exchange(delivery.target, first.answer), first.duration, delivery.report(chaos, request.body.size))
        return record(token, OutboundKind.REPLAY, request, attempt, source)
    }

    /** O destino conferido sem sair (ver [OutboundClient.refused]): a recusa, a gravar com [record], ou nula. */
    fun refusal(request: OutboundRequest): Attempt? {
        val at = clock.legacyNow()
        val started = System.nanoTime()
        val exchange = client.refused(request) ?: return null
        return Attempt(at, exchange, Duration.ofNanos(System.nanoTime() - started))
    }

    /** Grava e conta um disparo que já terminou. */
    fun record(
        token: Token,
        kind: OutboundKind,
        request: OutboundRequest,
        attempt: Attempt,
        source: RequestId? = null,
    ): OutboundResult {
        val (at, exchange, duration) = attempt
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
                chaos = attempt.chaos,
            )
        store.record(token.uuid, result)
        telemetry.outbound(kind.id, result.outcome())
        log.info("[OUTBOUND] {} {} {} ({} ms)", token.uuid, kind.id, result.outcome(), result.durationMs)
        return result
    }
}
