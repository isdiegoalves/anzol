package anzol.http

import anzol.legacy.PhpArray
import anzol.legacy.parseMultipart
import anzol.legacy.parseStr
import anzol.legacy.phpMultipartBoundary
import jakarta.servlet.http.HttpServletRequest
import tools.jackson.core.JacksonException
import tools.jackson.databind.DeserializationFeature
import tools.jackson.databind.json.JsonMapper
import java.nio.charset.StandardCharsets.ISO_8859_1

private const val FORM_URLENCODED = "application/x-www-form-urlencoded"
private const val MULTIPART = "multipart/form-data"
private val FORM_BODY_METHODS = setOf("PUT", "DELETE", "PATCH")

/**
 * A requisição como o Laravel 5.4 a enxerga: corpo cru (`php://input`), query (`$_GET`) e o
 * "input source" (`$request->request`), que é o JSON do corpo, a própria query num GET, ou os
 * campos de formulário que o PHP e o Symfony decodificam. Num multipart, `php://input` guarda só o
 * que o PHP não chegou a ler (em geral nada); o corpo inteiro como chegou é [rawBody].
 */
class LegacyInput(
    val body: ByteArray,
    val realMethod: String,
    val contentType: String,
    val query: PhpArray,
    val form: PhpArray,
    private val jsonBody: Map<String, Any?>?,
) {
    /** `Request::isJson()` do Laravel. */
    val isJson: Boolean = isLaravelJson(contentType)

    /**
     * O `Content-Type` é JSON e o corpo tem bytes que não são um objeto JSON (truncado, ou lista, texto, número,
     * `null`). O Laravel lia isso como entrada vazia, e é assim que [inputBag] o mostra; as rotas que gravam a
     * configuração da URL o recusam ([requireJsonObject]).
     */
    val malformedJson: Boolean = isJson && jsonBody == null

    /** O que `$request->request` guarda: o JSON do corpo ou o formulário. */
    fun inputBag(): Map<String, Any?> = if (isJson) jsonBody.orEmpty() else form

    /** `$request->get($key)` do Symfony: a query vence o corpo. */
    fun get(key: String): Any? = query[key] ?: inputBag()[key]

    /** O que a validação do `FormRequest` enxerga (`$request->all()`): o corpo vence a query. */
    fun all(): Map<String, Any?> = query + inputBag()

    companion object {
        const val ATTRIBUTE = "anzol.legacyInput"
    }
}

fun HttpServletRequest.legacyInput(): LegacyInput =
    checkNotNull(getAttribute(LegacyInput.ATTRIBUTE) as? LegacyInput) { "LegacyRequestFilter não processou a requisição" }

const val RAW_BODY_ATTRIBUTE = "anzol.rawBody"

/** O corpo inteiro, exatamente como chegou (inclusive num multipart): o que a assinatura HMAC cobre. */
fun HttpServletRequest.rawBody(): ByteArray =
    checkNotNull(getAttribute(RAW_BODY_ATTRIBUTE) as? ByteArray) { "LegacyRequestFilter não processou a requisição" }

/**
 * O boundary quando o PHP decodificaria o corpo como multipart. Sem boundary utilizável no
 * Content-Type o PHP desiste e o corpo fica cru em `php://input`.
 */
private fun HttpServletRequest.phpMultipartPostBoundary(): String? =
    if (method == "POST" && phpPostContentType(contentType) == MULTIPART) phpMultipartBoundary(contentType.orEmpty()) else null

fun HttpServletRequest.readLegacyInput(
    body: ByteArray,
    jsonMapper: JsonMapper,
): LegacyInput {
    val contentType = contentType.orEmpty()
    val query = parseStr(queryString.orEmpty().toByteArray(ISO_8859_1))
    val multipart = phpMultipartPostBoundary()?.let { parseMultipart(body, it) }
    val form =
        when {
            method == "GET" -> query
            method == "POST" && phpPostContentType(contentType) == FORM_URLENCODED -> parseStr(body)
            multipart != null -> multipart.fields
            method in FORM_BODY_METHODS && contentType.startsWith(FORM_URLENCODED) -> parseStr(body)
            else -> PhpArray()
        }
    val json = if (isLaravelJson(contentType)) jsonObject(body, jsonMapper) else emptyMap()
    return LegacyInput(multipart?.unread ?: body, method, contentType, query, form, json)
}

/** O que o filtro montaria para um POST com este corpo JSON, sem requisição HTTP (as ferramentas do MCP). */
fun jsonInput(
    body: ByteArray,
    jsonMapper: JsonMapper,
): LegacyInput = LegacyInput(body, "POST", "application/json", PhpArray(), PhpArray(), jsonObject(body, jsonMapper))

/** `Request::isJson()` do Laravel: `/json` ou `+json` em qualquer ponto do Content-Type. */
fun isLaravelJson(contentType: String): Boolean = "/json" in contentType || "+json" in contentType

/** O PHP compara o tipo em minúsculas, cortado no primeiro `;`, `,` ou espaço. */
private fun phpPostContentType(contentType: String?): String =
    contentType
        .orEmpty()
        .lowercase()
        .split(';', ',', ' ')
        .first()

/** O objeto JSON do corpo; vazio quando o corpo não tem nada (ou só espaços) e `null` quando não é um objeto JSON. */
@Suppress("UNCHECKED_CAST")
private fun jsonObject(
    body: ByteArray,
    jsonMapper: JsonMapper,
): Map<String, Any?>? =
    try {
        if (body.all { it.toInt().toChar().isWhitespace() }) {
            emptyMap()
        } else {
            objectReader(
                jsonMapper,
            ).readValue<Any?>(body) as? Map<String, Any?>
        }
    } catch (_: JacksonException) {
        null
    }

/** Lê um valor só: o que sobra depois dele (`{"a":1} x`) é erro. */
private fun objectReader(jsonMapper: JsonMapper) =
    jsonMapper.readerFor(Any::class.java).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
