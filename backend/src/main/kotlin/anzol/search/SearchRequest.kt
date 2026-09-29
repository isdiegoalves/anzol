package anzol.search

import anzol.capture.Sorting
import anzol.rules.MatchReader
import anzol.rules.Parsed
import anzol.rules.RuleMatch
import anzol.rules.Violations
import anzol.rules.given
import anzol.rules.readJson
import tools.jackson.databind.JsonNode

private const val MAX_TEXT = 200
private const val DEFAULT_PER_PAGE = 50L
private val PAGE_RANGE = 1L..Long.MAX_VALUE
private val PER_PAGE_RANGE = 1L..100L
private val SORTINGS = mapOf("newest" to Sorting.NEWEST, "oldest" to Sorting.OLDEST)

/**
 * Corpo do `POST /token/{id}/requests/search`, já validado; [text] vazio e [outcome], [signatureReason] e [schemaPath]
 * nulos são sem filtro.
 */
data class SearchRequest(
    val text: String = "",
    val match: RuleMatch = RuleMatch(),
    val outcome: SearchOutcome? = null,
    val signatureReason: String? = null,
    val schemaPath: String? = null,
    val sorting: Sorting = Sorting.NEWEST,
    val page: Long = 1,
    val perPage: Long = DEFAULT_PER_PAGE,
)

/**
 * `{"text", "match", "outcome", "signature_reason", "schema_path", "sorting", "page", "per_page"}`, todos opcionais;
 * corpo vazio vale `{}`. `match` passa pelo leitor das regras (chaves `match.path.regex`…); os outros erros ficam na
 * chave do campo, e o corpo que não é objeto JSON, em `search`.
 */
fun parseSearch(body: String): Parsed<SearchRequest> {
    val tree = if (body.isBlank()) readJson("{}") else readJson(body)
    if (tree == null || !tree.isObject) return Parsed.Invalid(mapOf("search" to listOf("The search must be an object.")))
    val violations = Violations()
    val text = violations.searchText(tree["text"])
    val match = MatchReader(violations).match(tree["match"], "match")
    val outcome = violations.outcome(tree["outcome"])
    val signatureReason = violations.signatureReason(tree["signature_reason"])
    val schemaPath = violations.schemaPath(tree["schema_path"])
    val sorting = violations.sorting(tree["sorting"])
    val page = violations.whole(tree["page"], "page", PAGE_RANGE, default = 1)
    val perPage = violations.whole(tree["per_page"], "per_page", PER_PAGE_RANGE, default = DEFAULT_PER_PAGE)
    return violations.result {
        SearchRequest(
            text = checkNotNull(text),
            match = checkNotNull(match),
            outcome = outcome,
            signatureReason = signatureReason,
            schemaPath = schemaPath,
            sorting = checkNotNull(sorting),
            page = checkNotNull(page),
            perPage = checkNotNull(perPage),
        )
    }
}

/** Texto de até [MAX_TEXT] caracteres (contados como o `mb_strlen` do Laravel); ausente ou nulo é `""`. */
private fun Violations.searchText(node: JsonNode?): String? {
    val given = node.given() ?: return ""
    val text = text(given, "text")
    return when {
        text == null || text.codePointCount(0, text.length) <= MAX_TEXT -> text
        else -> fail("text", "The text may not be greater than $MAX_TEXT characters.")
    }
}

/** `newest` ou `oldest`, com a mensagem da regra `in` do Laravel; ausente ou nulo é `newest`. */
private fun Violations.sorting(node: JsonNode?): Sorting? {
    val given = node.given() ?: return Sorting.NEWEST
    return SORTINGS[given.takeIf { it.isString }?.stringValue()] ?: fail("sorting", "The selected sorting is invalid.")
}
