package anzol.rules

import anzol.RequestId
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.time.Instant

/** Chave do near miss para a condição de cenário, que não está em `match`. */
const val SCENARIO_CONDITION = "scenario"

/** Chaves do near miss para a janela e o sorteio, que também não estão em `match`. */
const val ACTIVE_FROM_CONDITION = "active_from"
const val ACTIVE_UNTIL_CONDITION = "active_until"
const val CHANCE_CONDITION = "chance"

private const val PERCENT = 100

/** Uma condição que falhou: a chave dela ([Condition.key] ou [SCENARIO_CONDITION]) e a frase do `failed`. */
data class Failure(
    val condition: String,
    val phrase: String,
)

fun Condition.key(): String =
    when (this) {
        is Condition.Method -> "match.method"
        is Condition.Path -> "match.path"
        is Condition.Query -> "match.query.$name"
        is Condition.Header -> "match.headers.$original"
        is Condition.Body -> "match.body.$index"
        is Condition.Signature -> "match.signature"
        is Condition.Schema -> "match.schema"
        is Condition.Decryption -> "match.decryption"
    }

/** As condições que falharam, na ordem delas; vazia quando todas casam. */
fun List<Condition>.failures(input: MatchInput): List<Failure> =
    mapNotNull { condition -> condition.failure(input)?.let { Failure(condition.key(), it) } }

/**
 * As condições da regra que falharam, a janela e o sorteio, sem o cenário (o `rules/test`); vazia quando a regra casa
 * (sem olhar `enabled`).
 */
fun Rule.failures(input: MatchInput): List<Failure> = judged(match.conditions().failures(input), input)

/**
 * As condições da regra que falharam, a do cenário contra [states] (ausente = [STARTED]), a janela e o sorteio; vazia
 * quando a regra casa (sem olhar `enabled`). As frases e chaves do near miss.
 */
fun Rule.failures(
    input: MatchInput,
    states: Map<String, String>,
): List<Failure> = judged(match.conditions().failures(input) + listOfNotNull(scenarioFailure(states)), input)

/** Depois das condições (e do cenário), a janela; o sorteio só conta quando nada mais falhou. */
private fun Rule.judged(
    failed: List<Failure>,
    input: MatchInput,
): List<Failure> {
    val outside = failed + listOfNotNull(windowFailure(input.receivedAt))
    return outside.ifEmpty { listOfNotNull(chanceFailure(input.request)) }
}

private fun Rule.windowFailure(receivedAt: Instant): Failure? {
    val from = activeFrom
    val until = activeUntil
    return when {
        from != null && receivedAt < from -> Failure(ACTIVE_FROM_CONDITION, "window: opens at $from, received at $receivedAt")
        until != null && receivedAt >= until -> Failure(ACTIVE_UNTIL_CONDITION, "window: closed at $until, received at $receivedAt")
        else -> null
    }
}

private fun Rule.chanceFailure(request: RequestId): Failure? {
    val chance = chance ?: return null
    val rolled = roll(request, id)
    return if (rolled <= chance) null else Failure(CHANCE_CONDITION, "chance $chance%: rolled $rolled, not applied")
}

/**
 * O número de 1 a 100 do sorteio da [rule] para a mensagem [request]: `1 + (8 primeiros bytes do SHA-256 de
 * "uuid:id", sem sinal) mod 100`. Fixo por mensagem e regra, a captura, o trace e o `rules/test` sorteiam o mesmo
 * número sem gravar nada na mensagem.
 */
fun roll(
    request: RequestId,
    rule: RuleId,
): Int {
    val digest = MessageDigest.getInstance("SHA-256").digest("$request:$rule".toByteArray(UTF_8))
    return (ByteBuffer.wrap(digest).long.toULong() % PERCENT.toULong()).toInt() + 1
}

private fun Rule.scenarioFailure(states: Map<String, String>): Failure? {
    val name = scenario?.name
    val required = scenario?.requiredState
    val current = states[name] ?: STARTED
    return when {
        name == null || required == null || current == required -> null
        else -> Failure(SCENARIO_CONDITION, "scenario $name: expected state ${quote(required)}, got ${quote(current)}")
    }
}
