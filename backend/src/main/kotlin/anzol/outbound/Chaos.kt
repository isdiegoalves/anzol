package anzol.outbound

import anzol.rules.Violations
import anzol.rules.given
import com.fasterxml.jackson.annotation.JsonValue
import tools.jackson.databind.JsonNode
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming

private val DELAY_MS = 0L..30_000L
private val SLOW_BODY_BPS = 1L..1_048_576L
private val TIMEOUT_MS = 1L..30_000L

/**
 * O `chaos` do replay, já validado: espera antes de sair, uma segunda cópia, corpo cortado ao meio, corpo lento e
 * desistência de esperar a resposta. `Chaos()` não muda nada.
 */
data class Chaos(
    val delayMs: Long = 0,
    val duplicate: Boolean = false,
    val abortMidBody: Boolean = false,
    val slowBodyBps: Long? = null,
    val timeoutMs: Long? = null,
)

/** O que o caos fez de fato, na ordem em que o resultado lista. */
enum class Injection(
    @get:JsonValue val id: String,
) {
    DELAY_MS("delay_ms"),
    SLOW_BODY_BPS("slow_body_bps"),
    ABORT_MID_BODY("abort_mid_body"),
    TIMEOUT_MS("timeout_ms"),
    DUPLICATE("duplicate"),
}

/** A segunda cópia do `duplicate`: sem `status` nem `error` quando o caos cortou o corpo ou desistiu. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DuplicateResult(
    val status: Int?,
    val durationMs: Long,
    val error: OutboundError?,
)

/** O `chaos` do resultado: o pedido com os padrões, o que foi injetado, os bytes antes do corte e a segunda cópia. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class ChaosReport(
    val delayMs: Long,
    val duplicate: Boolean,
    val abortMidBody: Boolean,
    val slowBodyBps: Long?,
    val timeoutMs: Long?,
    val injected: List<Injection>,
    val bodyBytesSent: Int?,
    val duplicateResult: DuplicateResult?,
)

/** O relatório do [chaos] pedido para este disparo; [bodySize] é o corpo inteiro, em bytes. */
fun Delivery.report(
    chaos: Chaos,
    bodySize: Int,
): ChaosReport {
    val injected = injected()
    return ChaosReport(
        delayMs = chaos.delayMs,
        duplicate = chaos.duplicate,
        abortMidBody = chaos.abortMidBody,
        slowBodyBps = chaos.slowBodyBps,
        timeoutMs = chaos.timeoutMs,
        injected = injected,
        bodyBytesSent = if (Injection.ABORT_MID_BODY in injected) bodySize / 2 else null,
        duplicateResult =
            second?.let { copy ->
                DuplicateResult(
                    status = (copy.answer as? Checked.Ok)?.value?.status,
                    durationMs = copy.duration.toMillis(),
                    error = (copy.answer as? Checked.Refused)?.error,
                )
            },
    )
}

/**
 * O `chaos` do pedido de replay: objeto com as chaves de [Injection], cada uma opcional; `null` vale como ausente.
 * Chave de fora é erro: o CLI tem opções que o servidor não tem, e quem as manda precisa saber que não valeram.
 * [timeout] é o do replay (nulo quando ele mesmo é inválido); [hasBody] diz se a mensagem gravada tem corpo.
 */
fun Violations.chaos(
    node: JsonNode?,
    timeout: Long?,
    hasBody: Boolean,
): Chaos? {
    val given = node.given() ?: return null
    return if (given.isObject) chaosOf(given, timeout, hasBody) else fail("chaos", "The chaos must be an object.")
}

private fun Violations.chaosOf(
    given: JsonNode,
    timeout: Long?,
    hasBody: Boolean,
): Chaos? {
    val known = Injection.entries.map { it.id }
    given.propertyNames().filter { it !in known }.forEach { fail("chaos.$it", "The $it option is not supported.") }
    val delay = whole(given["delay_ms"], "chaos.delay_ms", DELAY_MS, default = 0)
    val duplicate = boolean(given["duplicate"], "chaos.duplicate", default = false)
    val abort = boolean(given["abort_mid_body"], "chaos.abort_mid_body", default = false)
    if (abort == true && !hasBody) fail("chaos.abort_mid_body", "The abort mid body field requires a request body.")
    val slow = optional(given["slow_body_bps"], "chaos.slow_body_bps", SLOW_BODY_BPS)
    val giveUp = optional(given["timeout_ms"], "chaos.timeout_ms", TIMEOUT_MS)
    if (giveUp != null && timeout != null && giveUp >= timeout) fail("chaos.timeout_ms", "The timeout ms must be less than the timeout.")
    return if (hasErrorsUnder("chaos")) {
        null
    } else {
        Chaos(checkNotNull(delay), checkNotNull(duplicate), checkNotNull(abort), slow, giveUp)
    }
}

/** Inteiro em [range], ausente ou nulo como `null` (o erro, quando há, já registrado). */
private fun Violations.optional(
    node: JsonNode?,
    key: String,
    range: LongRange,
): Long? = node.given()?.let { whole(it, key, range, default = range.first) }
