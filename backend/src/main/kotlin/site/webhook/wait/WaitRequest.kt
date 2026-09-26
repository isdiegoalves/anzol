package site.webhook.wait

import site.webhook.rules.MatchReader
import site.webhook.rules.Parsed
import site.webhook.rules.RuleMatch
import site.webhook.rules.Violations
import site.webhook.rules.readJson
import java.time.Duration

private val COUNT_RANGE = 1L..100L
private val TIMEOUT_RANGE = 0L..300_000L
private val AFTER_RANGE = 0L..Long.MAX_VALUE
private const val DEFAULT_COUNT = 1L
private const val DEFAULT_TIMEOUT_MS = 30_000L

/**
 * Sem `after`: o histórico inteiro, inclusive a mensagem gravada antes do índice com `created_at`
 * ilegível, que tem `seq` 0.
 */
const val FROM_START = -1L

/** Corpo do `POST /token/{id}/requests/wait`, já validado. */
data class WaitRequest(
    val match: RuleMatch = RuleMatch(),
    val after: Long = FROM_START,
    val count: Int = DEFAULT_COUNT.toInt(),
    val timeout: Duration = Duration.ofMillis(DEFAULT_TIMEOUT_MS),
)

/**
 * `{"match", "after", "count", "timeout"}`, todos opcionais; corpo vazio vale `{}`. `match` passa pelo
 * leitor das regras (chaves `match.path.regex`…); os outros erros ficam na chave do campo, e o corpo
 * que não é objeto JSON, em `wait`.
 */
fun parseWait(body: String): Parsed<WaitRequest> {
    val tree = if (body.isBlank()) readJson("{}") else readJson(body)
    if (tree == null || !tree.isObject) return Parsed.Invalid(mapOf("wait" to listOf("The wait must be an object.")))
    val violations = Violations()
    val match = MatchReader(violations).match(tree["match"], "match")
    val after = violations.whole(tree["after"], "after", AFTER_RANGE, default = FROM_START)
    val count = violations.whole(tree["count"], "count", COUNT_RANGE, default = DEFAULT_COUNT)
    val timeout = violations.whole(tree["timeout"], "timeout", TIMEOUT_RANGE, default = DEFAULT_TIMEOUT_MS)
    return violations.result {
        WaitRequest(
            match = checkNotNull(match),
            after = checkNotNull(after),
            count = checkNotNull(count).toInt(),
            timeout = Duration.ofMillis(checkNotNull(timeout)),
        )
    }
}
