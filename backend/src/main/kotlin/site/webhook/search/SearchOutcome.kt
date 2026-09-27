package site.webhook.search

import site.webhook.UUID_PATTERN
import site.webhook.capture.CapturedRequest
import site.webhook.rules.RuleId
import site.webhook.rules.Violations
import site.webhook.rules.given
import tools.jackson.databind.JsonNode
import java.util.UUID

/** O UUID de sempre ([UUID_PATTERN]), sem diferenciar caixa, como o `id` das regras. */
private val RULE_ID = Regex(UUID_PATTERN, RegexOption.IGNORE_CASE)
private const val TYPE_KEY = "outcome.type"
private const val RULE_KEY = "outcome.rule"

/**
 * `outcome` da busca: o desfecho gravado na mensagem. [Rule], respondida pela regra (`rule.id`); [NearMiss], a regra
 * foi o near miss (`near_miss.id`); [Default], sem `rule` (a resposta padrão da URL, com ou sem near miss).
 */
sealed interface SearchOutcome {
    data class Rule(
        val id: RuleId,
    ) : SearchOutcome

    data class NearMiss(
        val id: RuleId,
    ) : SearchOutcome

    data object Default : SearchOutcome

    fun matches(message: CapturedRequest): Boolean =
        when (this) {
            is Rule -> message.rule?.id == id
            is NearMiss -> message.nearMiss?.id == id
            Default -> message.rule == null
        }
}

/**
 * `{"type": "rule"|"near_miss", "rule": uuid}` ou `{"type": "default"}`; ausente ou nulo é `null` (sem filtro). Erros
 * em `outcome` (não é objeto), `outcome.type` e `outcome.rule`.
 */
fun Violations.outcome(node: JsonNode?): SearchOutcome? {
    val given = node.given() ?: return null
    return if (given.isObject) outcomeOf(given) else fail("outcome", "The outcome must be an object.")
}

private fun Violations.outcomeOf(given: JsonNode): SearchOutcome? {
    val type = given["type"].given()
    val rule = given["rule"].given()
    return when (type?.takeIf { it.isString }?.stringValue()) {
        "rule" -> ruleId(rule)?.let(SearchOutcome::Rule)
        "near_miss" -> ruleId(rule)?.let(SearchOutcome::NearMiss)
        "default" -> if (rule == null) SearchOutcome.Default else fail(RULE_KEY, "The outcome.rule field is prohibited.")
        else -> fail(TYPE_KEY, if (type == null) "The outcome.type field is required." else "The selected outcome.type is invalid.")
    }
}

private fun Violations.ruleId(node: JsonNode?): RuleId? {
    val text = node?.takeIf { it.isString }?.stringValue()
    return when {
        node == null -> fail(RULE_KEY, "The outcome.rule field is required.")
        text == null || !RULE_ID.matches(text) -> fail(RULE_KEY, "The outcome.rule must be a valid UUID.")
        else -> RuleId(UUID.fromString(text))
    }
}
