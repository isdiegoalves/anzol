package site.webhook.ai

import site.webhook.RequestId
import site.webhook.rules.Parsed
import site.webhook.rules.Violations
import site.webhook.rules.given
import site.webhook.rules.readJson
import tools.jackson.databind.JsonNode
import java.util.UUID

private const val MAX_PROMPT = 2000
private const val DEFAULT_LANG = "en"

/** Etiqueta de idioma no formato BCP 47 (`en`, `pt-BR`, `zh-Hant-TW`), como o navegador manda. */
private val LANG = Regex("[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,4}")
private val UUID_TEXT = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

/** Corpo do `POST /token/{id}/rules/suggest`, já validado; [requestId] é a mensagem de exemplo, opcional. */
data class SuggestInput(
    val prompt: String,
    val lang: String,
    val requestId: RequestId?,
)

/** `{"prompt", "lang"?, "request_id"?}`: `prompt` de 1 a 2000 caracteres; o que não é objeto JSON cai em `suggest`. */
fun parseSuggest(body: String): Parsed<SuggestInput> {
    val tree = jsonObject(body) ?: return Parsed.Invalid(mapOf("suggest" to listOf("The suggest must be an object.")))
    val violations = Violations()
    val prompt = violations.prompt(tree["prompt"])
    val lang = violations.lang(tree["lang"])
    val requestId = violations.requestId(tree["request_id"])
    return violations.result { SuggestInput(checkNotNull(prompt), checkNotNull(lang), requestId) }
}

/** `{"lang"?}` do `POST /token/{id}/request/{rid}/explain`; corpo vazio vale `{}`. */
fun parseExplain(body: String): Parsed<String> {
    val tree = jsonObject(body) ?: return Parsed.Invalid(mapOf("explain" to listOf("The explain must be an object.")))
    val violations = Violations()
    val lang = violations.lang(tree["lang"])
    return violations.result { checkNotNull(lang) }
}

private fun jsonObject(body: String): JsonNode? = (if (body.isBlank()) readJson("{}") else readJson(body))?.takeIf { it.isObject }

private fun Violations.prompt(node: JsonNode?): String? {
    val given = node.given() ?: return fail("prompt", "The prompt field is required.")
    val prompt = text(given, "prompt")
    return when {
        prompt == null -> null
        prompt.isBlank() -> fail("prompt", "The prompt field is required.")
        prompt.codePointCount(0, prompt.length) > MAX_PROMPT -> fail("prompt", "The prompt may not be greater than $MAX_PROMPT characters.")
        else -> prompt
    }
}

private fun Violations.lang(node: JsonNode?): String? {
    val given = node.given() ?: return DEFAULT_LANG
    val lang = text(given, "lang")
    return if (lang == null || LANG.matches(lang)) lang else fail("lang", "The lang format is invalid.")
}

private fun Violations.requestId(node: JsonNode?): RequestId? {
    val text = node.given()?.let { text(it, "request_id") }
    return when {
        text == null -> null
        UUID_TEXT.matches(text) -> RequestId(UUID.fromString(text))
        else -> fail("request_id", "The request id must be a valid UUID.")
    }
}
