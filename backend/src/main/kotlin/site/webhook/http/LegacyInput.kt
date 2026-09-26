package site.webhook.http

import jakarta.servlet.http.HttpServletRequest
import site.webhook.legacy.PhpArray
import site.webhook.legacy.parseStr
import site.webhook.legacy.register
import tools.jackson.core.JacksonException
import tools.jackson.databind.json.JsonMapper
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.nio.charset.StandardCharsets.UTF_8

private const val FORM_URLENCODED = "application/x-www-form-urlencoded"
private const val MULTIPART = "multipart/form-data"
private val FORM_BODY_METHODS = setOf("PUT", "DELETE", "PATCH")

/**
 * A requisição como o Laravel 5.4 a enxerga: corpo cru (`php://input`), query (`$_GET`) e o
 * "input source" (`$request->request`), que é o JSON do corpo, a própria query num GET, ou os
 * campos de formulário que o PHP e o Symfony decodificam.
 */
class LegacyInput(
    val body: ByteArray,
    val realMethod: String,
    val contentType: String,
    val query: PhpArray,
    val form: PhpArray,
    private val jsonBody: Map<String, Any?>,
) {
    /** `Request::isJson()` do Laravel. */
    val isJson: Boolean = isLaravelJson(contentType)

    /** O que `$request->request` guarda: o JSON do corpo ou o formulário. */
    fun inputBag(): Map<String, Any?> = if (isJson) jsonBody else form

    /** `$request->get($key)` do Symfony: a query vence o corpo. */
    fun get(key: String): Any? = query[key] ?: inputBag()[key]

    /** O que a validação do `FormRequest` enxerga (`$request->all()`): o corpo vence a query. */
    fun all(): Map<String, Any?> = query + inputBag()

    companion object {
        const val ATTRIBUTE = "site.webhook.legacyInput"
    }
}

fun HttpServletRequest.legacyInput(): LegacyInput =
    checkNotNull(getAttribute(LegacyInput.ATTRIBUTE) as? LegacyInput) { "LegacyRequestFilter não processou a requisição" }

/** `true` quando o PHP decodificaria o corpo como multipart (e `php://input` ficaria vazio). */
fun HttpServletRequest.isPhpMultipartPost(): Boolean = method == "POST" && phpPostContentType(contentType) == MULTIPART

fun HttpServletRequest.readLegacyInput(
    body: ByteArray,
    jsonMapper: JsonMapper,
): LegacyInput {
    val contentType = contentType.orEmpty()
    val query = parseStr(queryString.orEmpty().toByteArray(ISO_8859_1))
    val form =
        when {
            method == "GET" -> query
            method == "POST" && phpPostContentType(contentType) == FORM_URLENCODED -> parseStr(body)
            isPhpMultipartPost() -> multipartFields()
            method in FORM_BODY_METHODS && contentType.startsWith(FORM_URLENCODED) -> parseStr(body)
            else -> PhpArray()
        }
    val json = if (isLaravelJson(contentType)) jsonObject(body, jsonMapper) else emptyMap()
    return LegacyInput(body, method, contentType, query, form, json)
}

/** `Request::isJson()` do Laravel: `/json` ou `+json` em qualquer ponto do Content-Type. */
fun isLaravelJson(contentType: String): Boolean = "/json" in contentType || "+json" in contentType

/** O PHP compara o tipo em minúsculas, cortado no primeiro `;`, `,` ou espaço. */
private fun phpPostContentType(contentType: String?): String =
    contentType
        .orEmpty()
        .lowercase()
        .split(';', ',', ' ')
        .first()

/** `$_POST` de um multipart: só os campos de texto; arquivos vão para `$_FILES` e são descartados. */
private fun HttpServletRequest.multipartFields(): PhpArray {
    val fields = PhpArray()
    parts.filter { it.submittedFileName == null }.forEach { part ->
        fields.register(part.name, String(part.inputStream.readAllBytes(), UTF_8))
    }
    return fields
}

@Suppress("UNCHECKED_CAST")
private fun jsonObject(
    body: ByteArray,
    jsonMapper: JsonMapper,
): Map<String, Any?> =
    try {
        (jsonMapper.readValue(body, Any::class.java) as? Map<String, Any?>).orEmpty()
    } catch (_: JacksonException) {
        emptyMap()
    }
