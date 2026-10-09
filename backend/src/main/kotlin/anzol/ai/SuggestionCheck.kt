package anzol.ai

import anzol.capture.CapturedRequest
import anzol.e2ee.DecryptionState
import anzol.rules.Condition
import anzol.rules.Rule
import anzol.rules.failure
import anzol.rules.failures
import anzol.rules.toMatchInput
import com.fasterxml.jackson.annotation.JsonValue

/** A regra contra a mensagem de exemplo, com as frases e chaves do `rules/test` (vazias quando casa). */
data class ExampleCheck(
    val matches: Boolean,
    val failed: List<String>,
    val conditions: List<String>,
)

/** A regra contra as mensagens recentes da URL (a janela do `rules/test`): quantas foram avaliadas e quantas casariam. */
data class RecentCheck(
    val evaluated: Int,
    val matched: Int,
)

/** Os avisos da conferência: conjunto fechado. */
enum class WarningCode(
    @get:JsonValue val code: String,
    val message: String,
) {
    EXAMPLE_NOT_MATCHED("example_not_matched", "The rule does not match the example request."),
    TEMPLATE_DISABLED(
        "template_disabled",
        "The response uses {{…}} but template is false: the text is sent as written, without being rendered.",
    ),
    PATH_NEVER_SEEN("path_never_seen", "None of the recent requests of this URL has the path the rule requires."),
    SEQUENCE_AS_SINGLE_RULE(
        "sequence_as_single_rule",
        "The request describes a sequence of responses, but this is a single rule without a scenario: it always answers the same.",
    ),
    DECRYPTION_MATCHES_OTHER_REASONS(
        "decryption_matches_other_reasons",
        "match.decryption invalid answers every refused decryption.",
    ),
}

data class CheckWarning(
    val code: WarningCode,
    val message: String,
)

/**
 * `check` do `rules/suggest`: a regra devolvida pelo modelo conferida pelo servidor, sem o modelo. O validador cobra a
 * forma da regra; isto confere se ela serve ao que foi pedido, até onde dá para saber sem executar nada.
 */
data class SuggestionCheck(
    val example: ExampleCheck?,
    val recent: RecentCheck,
    val warnings: List<CheckWarning>,
)

/** Abertura de expressão do template (`{{`): num texto que não será renderizado, sai literal na resposta. */
private const val TEMPLATE_OPENING = "{{"

/**
 * Pedido com forma de sequência: "N vezes … depois" (`falhe 3 vezes com 503 e depois responda 200`, `fail 3 times
 * with 503 then respond 200`, `2x e em seguida…`). Uma regra só, sem cenário, responde sempre igual.
 */
private val SEQUENCE =
    Regex(
        """\b\d+\s*(?:x|vez(?:es)?|times?)\b.*\b(?:depois|então|entao|em seguida|then|afterwards?|after that|next)\b""",
        setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
    )

/**
 * Confere [rule] contra o [example] (a mensagem do `request_id`, se veio) e contra as [recent] (as mais novas da URL),
 * como o `rules/test`: sem olhar `enabled`, cenário nem as outras regras. Só lê; nada é gravado nem muda de estado.
 */
fun checkSuggestion(
    rule: Rule,
    prompt: String,
    example: CapturedRequest?,
    recent: List<CapturedRequest>,
): SuggestionCheck {
    val onExample = example?.let { rule.failures(it.toMatchInput()) }
    val matched = recent.filter { rule.failures(it.toMatchInput()).isEmpty() }
    val warnings =
        listOfNotNull(
            WarningCode.EXAMPLE_NOT_MATCHED.takeIf { onExample?.isNotEmpty() == true },
            WarningCode.TEMPLATE_DISABLED.takeIf { rule.hasUnrenderedTemplate() },
            WarningCode.PATH_NEVER_SEEN.takeIf { rule.requiresPathNeverSeenIn(recent) },
            WarningCode.SEQUENCE_AS_SINGLE_RULE.takeIf { rule.scenario == null && SEQUENCE.containsMatchIn(prompt) },
        ).map { CheckWarning(it, it.message) }
    return SuggestionCheck(
        example = onExample?.let { failed -> ExampleCheck(failed.isEmpty(), failed.map { it.phrase }, failed.map { it.condition }) },
        recent = RecentCheck(evaluated = recent.size, matched = matched.size),
        warnings = warnings + listOfNotNull(rule.otherDecryptionReasons(example, matched, recent.size)),
    )
}

/**
 * `match.decryption: invalid` casa toda decifra recusada, qualquer que seja o motivo: avisa quando as recentes que a regra
 * casa têm motivo diferente do exemplo (ou, sem exemplo, mais de um motivo). Os motivos são os códigos que o servidor
 * gravou na decifra; nada vem do remetente.
 */
private fun Rule.otherDecryptionReasons(
    example: CapturedRequest?,
    matched: List<CapturedRequest>,
    evaluated: Int,
): CheckWarning? {
    val asked = example?.refusedReason()
    val reasons = if (match.decryption == DecryptionState.INVALID) matched.refusedReasons() else emptyList()
    val broader = if (asked != null) reasons.any { (reason) -> reason != asked } else reasons.size > 1
    if (!broader) return null
    val code = WarningCode.DECRYPTION_MATCHES_OTHER_REASONS
    val opening = code.message.removeSuffix(".") + asked?.let { ", not only $it" }.orEmpty()
    val counted = reasons.joinToString { (reason, count) -> "$reason ($count)" }
    return CheckWarning(code, "$opening: ${matched.size} of the last $evaluated requests match, with reasons $counted.")
}

private fun CapturedRequest.refusedReason(): String? = decryption?.takeIf { it.state == DecryptionState.INVALID }?.reason

/** Os motivos das decifras recusadas, do mais frequente ao menos; no empate, pelo código. */
private fun List<CapturedRequest>.refusedReasons(): List<Pair<String, Int>> =
    mapNotNull { it.refusedReason() }
        .groupingBy { it }
        .eachCount()
        .toList()
        .sortedWith(compareByDescending<Pair<String, Int>> { it.second }.thenBy { it.first })

/** A regra tem condição de caminho, há mensagens recentes e nenhuma delas a satisfaz. */
private fun Rule.requiresPathNeverSeenIn(recent: List<CapturedRequest>): Boolean {
    val path = match.path?.let(Condition::Path)
    return path != null && recent.isNotEmpty() && recent.none { message -> path.failure(message.toMatchInput()) == null }
}

private fun Rule.hasUnrenderedTemplate(): Boolean =
    !response.template && (TEMPLATE_OPENING in response.body || response.headers.values.any { TEMPLATE_OPENING in it })
