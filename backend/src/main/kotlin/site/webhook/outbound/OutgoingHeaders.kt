package site.webhook.outbound

import site.webhook.TokenId
import site.webhook.capture.CapturedRequest
import site.webhook.rules.HEADER_NAME
import java.nio.charset.StandardCharsets.UTF_8
import java.util.HexFormat

/**
 * Cabeçalhos que o cliente HTTP escreve (`host`, `content-length`, `transfer-encoding`) ou que valem só para a
 * conexão de origem (hop-by-hop, `proxy-*`). Não saem nem no replay nem no send.
 */
private val CONNECTION_HEADERS =
    setOf("host", "content-length", "connection", "transfer-encoding", "keep-alive", "upgrade", "te", "trailer")
private val CONNECTION_PREFIXES = listOf("proxy-")

/** Além dos de conexão, o replay tira os que o proxy de entrada acrescentou à mensagem gravada (§1). */
private val PROXY_HEADERS = setOf("x-real-ip")
private val PROXY_PREFIXES = listOf("x-forwarded-", "cf-")

private fun String.isConnectionHeader(): Boolean =
    lowercase().let { name ->
        name in CONNECTION_HEADERS ||
            CONNECTION_PREFIXES.any(name::startsWith)
    }

private fun String.isProxyHeader(): Boolean = lowercase().let { name -> name in PROXY_HEADERS || PROXY_PREFIXES.any(name::startsWith) }

/** Os cabeçalhos gravados que o replay reenvia, cada valor da lista, na ordem gravada. */
fun CapturedRequest.replayHeaders(): List<Pair<String, String>> =
    headers
        .filterKeys { name -> HEADER_NAME.matches(name) && !name.isConnectionHeader() && !name.isProxyHeader() }
        .flatMap { (name, values) -> values.filter { it.isHeaderValue() }.map { name to it } }

/** Os do send, sem os de conexão, e com os da assinatura no lugar dos de mesmo nome (sem caixa). */
fun sendHeaders(
    given: List<Pair<String, String>>,
    signature: Map<String, String>,
): List<Pair<String, String>> {
    val signed = signature.keys.map { it.lowercase() }.toSet()
    return given.filterNot { (name, _) -> name.isConnectionHeader() || name.lowercase() in signed } + signature.toList()
}

/**
 * O alvo do replay com `keep_path`: a URL dada (sem fragmento e sem a barra final do caminho) mais o caminho após o
 * token e a query da `url` gravada; as duas queries se juntam com `&`. No que vem da mensagem, caractere que não
 * vale numa URI (o webhook aceita `"`, `{`, `|`… crus) sai escapado em `%XX`.
 */
fun CapturedRequest.keepPathTarget(
    target: String,
    token: TokenId,
): String {
    val afterToken = url.substringAfter("/$token", missingDelimiterValue = "")
    val path = afterToken.substringBefore('?').uriSafe()
    val query = afterToken.substringAfter('?', missingDelimiterValue = "").uriSafe()
    val base = target.substringBefore('#')
    val basePath = base.substringBefore('?')
    val baseQuery = base.substringAfter('?', missingDelimiterValue = "")
    val joinedQuery = listOf(baseQuery, query).filter { it.isNotEmpty() }.joinToString("&")
    val joinedPath = if (path.isEmpty()) basePath else basePath.trimEnd('/') + path
    return joinedPath + joinedQuery.takeIf { it.isNotEmpty() }?.let { "?$it" }.orEmpty()
}

/** RFC 3986: o que pode aparecer cru no caminho e na query (o `%` só como início de escape `%XX`). */
private const val URI_SAFE = "-._~!$&'()*+,;=:@/?"
private val ESCAPE = Regex("%[0-9A-Fa-f]{2}")
private const val ASCII_END = 0x80
private val HEX = HexFormat.of().withUpperCase()

private fun String.uriSafe(): String =
    buildString {
        val source = this@uriSafe
        var index = 0
        while (index < source.length) {
            val codePoint = source.codePointAt(index)
            val char = source[index]
            val raw =
                codePoint < ASCII_END &&
                    (char.isLetterOrDigit() || char in URI_SAFE || (char == '%' && ESCAPE.matchesAt(source, index)))
            if (raw) {
                append(char)
            } else {
                Character.toString(codePoint).toByteArray(UTF_8).forEach { append('%').append(HEX.toHexDigits(it)) }
            }
            index += Character.charCount(codePoint)
        }
    }
