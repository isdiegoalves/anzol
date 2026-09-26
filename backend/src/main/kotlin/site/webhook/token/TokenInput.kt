package site.webhook.token

import site.webhook.http.LegacyInput
import site.webhook.legacy.isPhpInteger
import site.webhook.legacy.phpIntval
import site.webhook.legacy.phpNumericSize

private const val PHP_TRIM = " \t\n\r\u0000\u000B"
private const val MAX_TIMEOUT = 10.0
private const val DEFAULT_STATUS = 200L

/** Regra do `CreateTokenRequest` com a mensagem de `resources/lang/en/validation.php` do Laravel 5.4. */
private enum class Rule(
    val passes: (Any?) -> Boolean,
    val message: (String) -> String,
) {
    STRING({ it is String }, { "The $it must be a string." }),
    INTEGER(::isPhpInteger, { "The $it must be an integer." }),
    MIN_ZERO({ phpNumericSize(it) >= 0 }, { "The $it must be at least 0." }),
    MAX_TEN({ phpNumericSize(it) <= MAX_TIMEOUT }, { "The $it may not be greater than 10." }),
}

private val RULES =
    linkedMapOf(
        "default_content" to listOf(Rule.STRING),
        "default_content_type" to listOf(Rule.STRING),
        "default_status" to listOf(Rule.INTEGER),
        "timeout" to listOf(Rule.INTEGER, Rule.MIN_ZERO, Rule.MAX_TEN),
    )

/**
 * Validação do Laravel 5.4 sobre `$request->all()`: campo ausente ou string em branco não é
 * validado; presente (inclusive `null`) passa por todas as regras, sem parar na primeira.
 */
fun LegacyInput.validateTokenSettings(): Map<String, List<String>> {
    val data = all()
    return RULES
        .filterKeys { it in data && !data[it].isBlankString() }
        .mapValues { (attribute, rules) ->
            rules.filterNot { it.passes(data[attribute]) }.map { it.message(attribute.replace('_', ' ')) }
        }.filterValues { it.isNotEmpty() }
}

private fun Any?.isBlankString(): Boolean = this is String && trim { it in PHP_TRIM }.isEmpty()

/** Valores como `Token::createFromRequest` os lê: `$request->get()` (query primeiro) e cast `(int)`. */
fun LegacyInput.toTokenSettings(): TokenSettings =
    TokenSettings(
        defaultContent = (get("default_content") as? String).orEmpty(),
        defaultStatus = get("default_status")?.let(::phpIntval) ?: DEFAULT_STATUS,
        defaultContentType = get("default_content_type") as? String ?: "text/plain",
        timeout = phpIntval(get("timeout")),
    )
