package site.webhook.capture

import jakarta.servlet.http.HttpServletRequest
import site.webhook.RequestId
import site.webhook.TokenId
import site.webhook.http.LegacyInput
import site.webhook.http.legacyInput
import site.webhook.http.rawPath
import site.webhook.legacy.latin1ToUtf8
import site.webhook.legacy.normalizeQueryString
import site.webhook.legacy.toJson
import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.NullNode
import java.nio.charset.StandardCharsets.UTF_8
import java.time.LocalDateTime
import java.util.Base64
import java.util.UUID

private const val HTTP_DEFAULT_PORT = 80
private const val HTTPS_DEFAULT_PORT = 443
private const val BASIC_PREFIX = "basic "

/**
 * A única forma de criar um [CapturedRequest]: o que `Storage/Request::createFromRequest` grava,
 * com o corpo e os campos lidos pelo `LegacyRequestFilter`. Bytes que não são UTF-8 viram U+FFFD
 * (o app antigo respondia 500 e deixava uma mensagem fantasma).
 */
fun HttpServletRequest.toCapturedRequest(
    tokenId: TokenId,
    receivedAt: LocalDateTime,
): CapturedRequest {
    val input = legacyInput()
    val headers = legacyHeaders(bodySize = input.body.size)
    return CapturedRequest(
        uuid = RequestId(UUID.randomUUID()),
        tokenId = tokenId,
        ip = remoteAddr,
        hostname = serverName.lowercase(),
        method = method,
        userAgent = headers["user-agent"]?.firstOrNull(),
        content = String(input.body, UTF_8),
        query = input.query.takeIf { it.isNotEmpty() }?.toJson(),
        headers = headers,
        url = legacyUrl(),
        createdAt = receivedAt,
        updatedAt = receivedAt,
        request = input.formField(),
    )
}

/** Chave `request`: ausente em requisição JSON, `null` sem campos, senão os campos. */
private fun LegacyInput.formField(): JsonNode? =
    when {
        isJson -> null
        form.isEmpty() -> NullNode.instance
        else -> form.toJson()
    }

/**
 * `$request->headers->all()` atrás do nginx + PHP-FPM: nome em minúsculas com `_` virando `-`,
 * um valor só (o último), ordem inversa à de chegada, `content-length` e `content-type` vazios
 * quando ausentes e, com Basic Auth, `php-auth-user`/`php-auth-pw` no fim. Com corpo chunked o
 * nginx junta os pedaços e repassa o tamanho lido como `content-length`.
 */
fun HttpServletRequest.legacyHeaders(bodySize: Int): Map<String, List<String>> {
    val arrived =
        headerNames.toList().map { name ->
            name.lowercase().replace('_', '-') to getHeaders(name).toList().last().latin1ToUtf8()
        }
    val headers = LinkedHashMap<String, List<String>>()
    arrived.asReversed().forEach { (name, value) -> headers[name] = listOf(value) }
    if ("transfer-encoding" in headers) headers.putIfAbsent("content-length", listOf(bodySize.toString()))
    headers.putIfAbsent("content-length", listOf(""))
    headers.putIfAbsent("content-type", listOf(""))
    val credentials = headers["authorization"]?.first()?.let(::basicCredentials)
    if (credentials != null) {
        headers["php-auth-user"] = listOf(credentials.first)
        headers["php-auth-pw"] = listOf(credentials.second)
    }
    return headers
}

/** `ServerBag::getHeaders`: `explode(':', base64_decode(...), 2)` de um `Authorization: Basic`. */
private fun basicCredentials(authorization: String): Pair<String, String>? {
    val decoded =
        if (authorization.lowercase().startsWith(
                BASIC_PREFIX,
            )
        ) {
            decodeBase64(authorization.substring(BASIC_PREFIX.length))
        } else {
            null
        }
    return if (decoded != null && ':' in decoded) decoded.substringBefore(':') to decoded.substringAfter(':') else null
}

/** `base64_decode` tolerante; `null` quando nem o decodificador MIME aceita. */
private fun decodeBase64(encoded: String): String? =
    try {
        String(Base64.getMimeDecoder().decode(encoded), UTF_8)
    } catch (_: IllegalArgumentException) {
        null
    }

/** `$request->fullUrl()`: host do cabeçalho Host, caminho cru (como chegou) sem `/` no fim, query normalizada. */
private fun HttpServletRequest.legacyUrl(): String {
    val defaultPort = if (scheme == "https") HTTPS_DEFAULT_PORT else HTTP_DEFAULT_PORT
    val port = if (serverPort == defaultPort) "" else ":$serverPort"
    val query = normalizeQueryString(queryString)
    val base = "$scheme://${serverName.lowercase()}$port${rawPath().trimEnd('/')}"
    return if (query.isEmpty()) base else "$base?$query"
}
