package site.webhook.telemetry

import io.micrometer.common.KeyValue
import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.Tags
import io.micrometer.core.instrument.Timer
import jakarta.servlet.http.HttpServletRequest
import org.springframework.stereotype.Component
import org.springframework.web.filter.ServerHttpObservationFilter
import site.webhook.TokenId
import site.webhook.rules.Fault
import site.webhook.schema.SchemaState
import site.webhook.signature.SignatureState
import java.time.Duration

/** Valor das labels quando o item não se aplica (sem regra, sem assinatura, sem schema, sem falha, sem resposta HTTP). */
private const val NONE = "none"

/** O que uma captura respondeu: só valores de conjunto fechado, nada que identifique a URL, a mensagem ou o cliente. */
data class CaptureOutcome(
    val method: String,
    /** Status HTTP dado; nulo quando a regra derrubou a conexão ([fault]). */
    val status: Int?,
    val ruleMatched: Boolean,
    val signature: SignatureState?,
    val schema: SchemaState?,
    val fault: Fault?,
) {
    fun statusClass(): String = status?.let { "${it.toString().first()}xx" } ?: NONE

    fun rule(): String = if (ruleMatched) "matched" else NONE

    /** Ausente (faltou o cabeçalho que a verificação exige) conta como inválida: a verificação falhou. */
    fun signature(): String =
        when (signature) {
            SignatureState.VALID -> "valid"
            SignatureState.INVALID, SignatureState.ABSENT -> "invalid"
            null -> NONE
        }

    fun schema(): String = schema?.id ?: NONE

    fun fault(): String = fault?.value ?: NONE
}

/**
 * Cronômetro da captura que desconta as esperas programadas (o `timeout` da URL, o `delay` e o `dribble` da
 * regra): o que sobra é o tempo que o app gastou. As esperas passam por [sleep].
 */
class CaptureStopwatch {
    private val started = System.nanoTime()
    private var programmed = 0L

    fun sleep(duration: Duration) {
        val before = System.nanoTime()
        Thread.sleep(duration)
        programmed += System.nanoTime() - before
    }

    fun elapsed(): Duration = Duration.ofNanos(System.nanoTime() - started - programmed)
}

/**
 * Métricas de negócio (Micrometer) e atributos do span da captura; os gauges de SSE e wait ficam no
 * [site.webhook.stream.RequestStream], dono do estado. Nenhuma label carrega token, id de
 * mensagem, IP ou valor livre; o token vai só para o span, que é o que permite achar o trace de uma URL.
 * Com a exportação OTLP desligada (padrão), tudo fica no registro em memória e nada sai do processo.
 */
@Component
class WebhookTelemetry(
    private val registry: MeterRegistry,
) {
    private val storageFull =
        Counter
            .builder("webhook.storage.full")
            .description("Gravações recusadas com 507: o Redis atingiu o maxmemory")
            .register(registry)
    private val cleanupRemoved =
        Counter
            .builder("webhook.cleanup.removed")
            .description("Mensagens removidas pela limpeza automática (auto_cleanup ou WEBHOOK_MAX_REQUESTS)")
            .register(registry)
    private val captureDuration =
        Timer
            .builder("webhook.capture.duration")
            .description("Do recebimento até a resposta da captura, sem as esperas programadas da URL e da regra")
            .publishPercentileHistogram()
            .register(registry)

    fun captured(
        request: HttpServletRequest,
        tokenId: TokenId,
        outcome: CaptureOutcome,
        duration: Duration,
    ) {
        Counter
            .builder("webhook.requests.captured")
            .description("Mensagens capturadas, pelo que a URL respondeu")
            .tags(
                Tags.of(
                    "method",
                    outcome.method,
                    "status_class",
                    outcome.statusClass(),
                    "rule",
                    outcome.rule(),
                    "signature",
                    outcome.signature(),
                    "schema",
                    outcome.schema(),
                    "fault",
                    outcome.fault(),
                ),
            ).register(registry)
            .increment()
        captureDuration.record(duration)
        ServerHttpObservationFilter.findObservationContext(request).ifPresent { context ->
            context.addHighCardinalityKeyValue(KeyValue.of("webhook.token", tokenId.toString()))
            context.addHighCardinalityKeyValue(KeyValue.of("webhook.rule.matched", outcome.ruleMatched.toString()))
            context.addHighCardinalityKeyValue(KeyValue.of("webhook.signature", outcome.signature()))
            context.addHighCardinalityKeyValue(KeyValue.of("webhook.schema", outcome.schema()))
            context.addHighCardinalityKeyValue(KeyValue.of("webhook.status", outcome.status?.toString() ?: NONE))
            context.addHighCardinalityKeyValue(KeyValue.of("webhook.fault", outcome.fault()))
        }
    }

    /**
     * Um replay ou send: [kind] é `replay` ou `send` e [outcome] a classe do status (`2xx`…`5xx`), `blocked` ou
     * `error`. Nada da URL de destino nem do token.
     */
    fun outbound(
        kind: String,
        outcome: String,
    ) {
        Counter
            .builder("webhook.outbound")
            .description("Replays e sends que o servidor disparou, pelo resultado")
            .tags(Tags.of("kind", kind, "outcome", outcome))
            .register(registry)
            .increment()
    }

    fun storageFull() = storageFull.increment()

    fun cleanupRemoved(count: Int) {
        if (count > 0) cleanupRemoved.increment(count.toDouble())
    }
}
