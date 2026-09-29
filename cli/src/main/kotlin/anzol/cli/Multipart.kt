package anzol.cli

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.UUID

private const val MULTIPART = "multipart/form-data"
private val BOUNDARY = Regex("""boundary=("[^"]+"|[^;\s]+)""", RegexOption.IGNORE_CASE)

/** Sufixo da linha de um multipart: o servidor não guarda os arquivos (nem o corpo cru). */
const val FILES_NOT_FORWARDED = " [files were not forwarded: not stored by the server]"

/**
 * Multipart remontado para o reenvio: o Content-Type (com o boundary do corpo) e o corpo.
 */
data class RebuiltMultipart(
    val contentType: String,
    val body: String,
)

/**
 * Multipart cujo corpo o servidor não guardou (`content` vazio e os campos em `request`), remontado
 * com os campos de texto; `null` para as demais mensagens, inclusive multipart sem boundary, que o
 * servidor grava cru em `content`. Arrays do PHP viram nomes com colchetes: `tags[0]`, `end[rua]`.
 *
 * Quem envia o webhook controla nomes e valores, então o boundary é novo e sorteado até não
 * aparecer em nenhum deles, e o nome é escapado como o navegador faz (`"` CR LF → `%22` `%0D`
 * `%0A`): nenhum texto recebido cria parte ou cabeçalho novo no corpo entregue ao app local.
 */
fun CapturedRequest.rebuiltMultipart(randomBoundary: () -> String = ::randomBoundary): RebuiltMultipart? {
    if (!isStoredMultipart()) return null
    val fields = request.fields(prefix = null).map { (name, value) -> name.escapedFieldName() to value }
    val boundary =
        generateSequence(randomBoundary).first { candidate ->
            fields.none { (name, value) -> candidate in name || candidate in value }
        }
    val body =
        fields.joinToString("") { (name, value) ->
            "--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n"
        } + "--$boundary--\r\n"
    return RebuiltMultipart("$MULTIPART; boundary=$boundary", body)
}

private fun CapturedRequest.isStoredMultipart(): Boolean {
    val contentType = headers["content-type"]?.lastOrNull().orEmpty()
    return content.isEmpty() &&
        contentType.trimStart().startsWith(MULTIPART, ignoreCase = true) &&
        BOUNDARY.containsMatchIn(contentType)
}

private fun String.escapedFieldName(): String = replace("\"", "%22").replace("\r", "%0D").replace("\n", "%0A")

private fun randomBoundary(): String = "----anzolcli" + UUID.randomUUID().toString().replace("-", "")

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
