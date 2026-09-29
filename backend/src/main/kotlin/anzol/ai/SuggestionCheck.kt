package anzol.ai

import anzol.capture.CapturedRequest
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
    val warnings =
        listOfNotNull(
            WarningCode.EXAMPLE_NOT_MATCHED.takeIf { onExample?.isNotEmpty() == true },
            WarningCode.TEMPLATE_DISABLED.takeIf { rule.hasUnrenderedTemplate() },
            WarningCode.PATH_NEVER_SEEN.takeIf { rule.requiresPathNeverSeenIn(recent) },
            WarningCode.SEQUENCE_AS_SINGLE_RULE.takeIf { rule.scenario == null && SEQUENCE.containsMatchIn(prompt) },
        )
    return SuggestionCheck(
        example = onExample?.let { failed -> ExampleCheck(failed.isEmpty(), failed.map { it.phrase }, failed.map { it.condition }) },
        recent = RecentCheck(evaluated = recent.size, matched = recent.count { rule.failures(it.toMatchInput()).isEmpty() }),
        warnings = warnings.map { CheckWarning(it, it.message) },
    )
}

/** A regra tem condição de caminho, há mensagens recentes e nenhuma delas a satisfaz. */
private fun Rule.requiresPathNeverSeenIn(recent: List<CapturedRequest>): Boolean {
    val path = match.path?.let(Condition::Path)
    return path != null && recent.isNotEmpty() && recent.none { message -> path.failure(message.toMatchInput()) == null }
}

private fun Rule.hasUnrenderedTemplate(): Boolean =
    !response.template && (TEMPLATE_OPENING in response.body || response.headers.values.any { TEMPLATE_OPENING in it })
