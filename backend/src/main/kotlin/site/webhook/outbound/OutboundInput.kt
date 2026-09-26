package site.webhook.outbound

import site.webhook.rules.HEADER_NAME
import site.webhook.rules.Parsed
import site.webhook.rules.Violations
import site.webhook.rules.given
import site.webhook.rules.readJson
import tools.jackson.databind.JsonNode
import java.net.URI
import java.net.URISyntaxException
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration

/** Tamanho máximo da URL de destino. */
const val MAX_URL_LENGTH = 2048

/** Corpo enviado (o da mensagem gravada ou o montado), em bytes UTF-8. */
const val MAX_OUTBOUND_BODY = 1024 * 1024

private val TIMEOUT_MS = 1_000L..MAX_TIMEOUT.toMillis()
private const val DEFAULT_TIMEOUT_MS = 10_000L
private val METHODS = listOf("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")
private const val DEFAULT_METHOD = "POST"

/** Corpo do `POST /token/{id}/request/{rid}/replay`, já validado. */
data class ReplayInput(
    val url: String,
    val keepPath: Boolean,
    val timeout: Duration,
)

/** Corpo do `POST /token/{id}/send`, já validado; [headers] na ordem e na caixa em que vieram. */
data class SendInput(
    val url: String,
    val method: String,
    val headers: List<Pair<String, String>>,
    val body: String,
    val sign: Boolean,
    val timeout: Duration,
)

/** `{"url", "keep_path"?, "timeout"?}`; corpo vazio vale `{}`; o que não é objeto JSON cai em `replay`. */
fun parseReplay(body: String): Parsed<ReplayInput> {
    val tree = jsonObject(body) ?: return Parsed.Invalid(mapOf("replay" to listOf("The replay must be an object.")))
    val violations = Violations()
    val url = violations.url(tree["url"])
    val keepPath = violations.boolean(tree["keep_path"], "keep_path", default = true)
    val timeout = violations.whole(tree["timeout"], "timeout", TIMEOUT_MS, default = DEFAULT_TIMEOUT_MS)
    return violations.result { ReplayInput(checkNotNull(url), checkNotNull(keepPath), Duration.ofMillis(checkNotNull(timeout))) }
}

/**
 * `{"url", "method"?, "headers"?, "body"?, "sign"?, "timeout"?}`. `sign: true` exige a `signature` da URL
 * ([hasSignature]); o corpo passa de 1 MiB em bytes UTF-8 → 422 em `body`.
 */
fun parseSend(
    body: String,
    hasSignature: Boolean,
): Parsed<SendInput> {
    val tree = jsonObject(body) ?: return Parsed.Invalid(mapOf("send" to listOf("The send must be an object.")))
    val violations = Violations()
    val url = violations.url(tree["url"])
    val method = violations.method(tree["method"])
    val headers = violations.headers(tree["headers"])
    val content = violations.body(tree["body"])
    val sign = violations.boolean(tree["sign"], "sign", default = false)
    if (sign == true && !hasSignature) violations.fail("sign", "The sign field requires a signature configured on this URL.")
    val timeout = violations.whole(tree["timeout"], "timeout", TIMEOUT_MS, default = DEFAULT_TIMEOUT_MS)
    return violations.result {
        SendInput(
            url = checkNotNull(url),
            method = checkNotNull(method),
            headers = checkNotNull(headers),
            body = checkNotNull(content),
            sign = checkNotNull(sign),
            timeout = Duration.ofMillis(checkNotNull(timeout)),
        )
    }
}

private fun jsonObject(body: String): JsonNode? = (if (body.isBlank()) readJson("{}") else readJson(body))?.takeIf { it.isObject }

private fun Violations.url(node: JsonNode?): String? {
    val given = node.given() ?: return fail("url", "The url field is required.")
    val url = text(given, "url")?.trim()
    return when {
        url == null -> null
        url.isEmpty() -> fail("url", "The url field is required.")
        url.length > MAX_URL_LENGTH -> fail("url", "The url may not be greater than $MAX_URL_LENGTH characters.")
        !url.isAbsoluteUrl() -> fail("url", "The url format is invalid.")
        else -> url
    }
}

/**
 * Texto que é URL absoluta (tem esquema). O resto (esquema proibido, host ou porta inválidos) passa daqui e vira o
 * `error` do resultado: `blocked` ou `invalid_url` ([parseTarget]).
 */
private fun String.isAbsoluteUrl(): Boolean =
    try {
        URI(this).isAbsolute
    } catch (_: URISyntaxException) {
        false
    }

private fun Violations.method(node: JsonNode?): String? {
    val given = node.given() ?: return DEFAULT_METHOD
    val method = given.takeIf { it.isString }?.stringValue()?.uppercase()
    return method?.takeIf { it in METHODS } ?: fail("method", "The selected method is invalid.")
}

private fun Violations.headers(node: JsonNode?): List<Pair<String, String>>? {
    val given = node.given() ?: return emptyList()
    return if (given.isObject) headerList(given) else fail("headers", "The headers must be an object.")
}

private fun Violations.headerList(given: JsonNode): List<Pair<String, String>>? {
    val headers =
        given.properties().map { (name, value) ->
            val key = "headers.$name"
            when {
                !HEADER_NAME.matches(name) -> fail(key, "The header name is invalid.")
                !value.isString -> fail(key, "The header value must be a string.")
                !value.stringValue().isHeaderValue() -> fail(key, "The header value is invalid.")
                else -> name to value.stringValue()
            }
        }
    return if (hasErrorsUnder("headers")) null else headers.filterNotNull()
}

private fun Violations.body(node: JsonNode?): String? {
    val given = node.given() ?: return ""
    val body = text(given, "body")
    return if (body != null && body.toByteArray(UTF_8).size > MAX_OUTBOUND_BODY) {
        fail("body", "The body may not be greater than $MAX_OUTBOUND_BODY bytes.")
    } else {
        body
    }
}

/** Valor que cabe numa linha de cabeçalho: sem CR, LF nem NUL. */
fun String.isHeaderValue(): Boolean = none { it == '\r' || it == '\n' || it == '\u0000' }
