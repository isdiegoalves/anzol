package site.webhook.rules

/** Chave do near miss para a condição de cenário, que não está em `match`. */
const val SCENARIO_CONDITION = "scenario"

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
    }

/** As condições que falharam, na ordem delas; vazia quando todas casam. */
fun List<Condition>.failures(input: MatchInput): List<Failure> =
    mapNotNull { condition -> condition.failure(input)?.let { Failure(condition.key(), it) } }

/** As condições da regra que falharam; vazia quando a regra casa (sem olhar `enabled`). */
fun Rule.failures(input: MatchInput): List<Failure> = match.conditions().failures(input)

/**
 * As condições da regra que falharam e, por último, a do cenário contra [states] (ausente = [STARTED]); vazia quando a
 * regra casa (sem olhar `enabled`). As frases e chaves do near miss.
 */
fun Rule.failures(
    input: MatchInput,
    states: Map<String, String>,
): List<Failure> = failures(input) + listOfNotNull(scenarioFailure(states))

private fun Rule.scenarioFailure(states: Map<String, String>): Failure? {
    val name = scenario?.name
    val required = scenario?.requiredState
    val current = states[name] ?: STARTED
    return when {
        name == null || required == null || current == required -> null
        else -> Failure(SCENARIO_CONDITION, "scenario $name: expected state ${quote(required)}, got ${quote(current)}")
    }
}
