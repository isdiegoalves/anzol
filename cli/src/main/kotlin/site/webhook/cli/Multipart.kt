package site.webhook.cli

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private const val MULTIPART = "multipart/form-data"
private val BOUNDARY = Regex("""boundary=("[^"]+"|[^;\s]+)""", RegexOption.IGNORE_CASE)

/** Sufixo da linha de um multipart: o servidor não guarda os arquivos (nem o corpo cru). */
const val FILES_NOT_FORWARDED = " [files were not forwarded: not stored by the server]"

/**
 * Boundary de um multipart cujo corpo o servidor não guardou (`content` vazio e os campos em
 * `request`); `null` para as demais mensagens, inclusive multipart sem boundary, que o servidor
 * grava cru em `content`.
 */
fun CapturedRequest.multipartBoundary(): String? {
    val contentType = headers["content-type"]?.lastOrNull().orEmpty()
    if (content.isNotEmpty() || !contentType.trimStart().startsWith(MULTIPART, ignoreCase = true)) return null
    return BOUNDARY
        .find(contentType)
        ?.groupValues
        ?.get(1)
        ?.trim('"')
}

/**
 * Multipart remontado com os campos de texto de `request` e o boundary gravado (o Content-Type
 * gravado segue valendo). Arrays do PHP viram nomes com colchetes: `tags[0]`, `end[rua]`.
 */
fun CapturedRequest.multipartBody(boundary: String): String =
    request.fields(prefix = null).joinToString("") { (name, value) ->
        "--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n"
    } + "--$boundary--\r\n"

private fun JsonElement?.fields(prefix: String?): List<Pair<String, String>> =
    when (this) {
        null, JsonNull -> emptyList()
        is JsonObject -> entries.flatMap { (key, value) -> value.fields(nested(prefix, key)) }
        is JsonArray -> flatMapIndexed { index, value -> value.fields(nested(prefix, index.toString())) }
        is JsonPrimitive -> listOf(prefix.orEmpty() to content)
    }

private fun nested(
    prefix: String?,
    key: String,
): String = if (prefix == null) key else "$prefix[$key]"
