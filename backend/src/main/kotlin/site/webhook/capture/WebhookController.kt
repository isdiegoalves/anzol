package site.webhook.capture

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestMethod
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import site.webhook.STATUS_IN_PATH
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.WebhookProperties
import site.webhook.http.PHP_DEFAULT_CONTENT_TYPE
import site.webhook.legacy.phpIntval
import site.webhook.legacy.urlDecode
import site.webhook.token.Token
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import site.webhook.token.legacyNow
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Clock
import java.time.Duration

/** Os 4 cabeçalhos de `Controller::corsHeaders`. */
val CORS_HEADERS =
    linkedMapOf(
        "Access-Control-Allow-Origin" to "*",
        "Access-Control-Allow-Methods" to "GET, PUT, PATCH, POST, OPTIONS",
        "Access-Control-Allow-Headers" to "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range",
        "Access-Control-Expose-Headers" to "Content-Length,Content-Range",
    )

/** `charset_types` padrão do nginx que não começam com `text/` (esses o Symfony já cobre). */
private val NGINX_CHARSET_TYPES = setOf("application/javascript", "application/rss+xml")
private val VALID_FINAL_STATUS = 200..599
private const val FALLBACK_STATUS = 200

/**
 * Status da resposta: o 2º segmento do caminho quando contém `[1-5][0-9][0-9]` e o `(int)` dele
 * é um status válido, senão o padrão do token, senão 200. O app antigo respondia 500 nos dois
 * últimos casos (ex.: `/12345`, `default_status` 999); o contrato exige que não quebre.
 */
fun responseStatus(
    pathSegment: String?,
    defaultStatus: Long,
): Int {
    val fromPath = pathSegment?.takeIf { STATUS_IN_PATH.containsMatchIn(it) }?.let(::phpIntval)
    return listOfNotNull(fromPath, defaultStatus).firstOrNull { it in VALID_FINAL_STATUS }?.toInt() ?: FALLBACK_STATUS
}

/**
 * Content-Type da resposta: o Symfony acrescenta `; charset=UTF-8` a `text/...` sem charset e o
 * nginx acrescenta `; charset=utf-8` aos seus `charset_types`. Vazio ou 304: sem cabeçalho. No 204
 * o Symfony remove o cabeçalho e o PHP-FPM põe o padrão dele (`default_mimetype`).
 */
fun responseContentType(
    configured: String,
    status: Int,
): String? {
    val mediaType = configured.substringBefore(';').trim().lowercase()
    val hasCharset = configured.contains("charset", ignoreCase = true)
    return when {
        status == HttpServletResponse.SC_NO_CONTENT -> PHP_DEFAULT_CONTENT_TYPE
        configured.isEmpty() || status == HttpServletResponse.SC_NOT_MODIFIED -> null
        configured.startsWith("text/", ignoreCase = true) && !hasCharset -> "$configured; charset=UTF-8"
        mediaType in NGINX_CHARSET_TYPES && !hasCharset -> "$configured; charset=utf-8"
        else -> configured
    }
}

/** `$request->segment(2)`: segmentos decodificados, sem os vazios nem os `"0"` (`array_filter`). */
private fun HttpServletRequest.secondSegment(): String? =
    urlDecode(requestURI)
        .split('/')
        .filter { it.isNotEmpty() && it != "0" }
        .getOrNull(1)

@RestController
class WebhookController(
    private val tokens: TokenStore,
    private val requests: RequestStore,
    private val properties: WebhookProperties,
    private val clock: Clock,
) {
    /** `any {tokenId}/{statusCode?}` e `any {tokenId}/{any}` de `routes.php`. */
    @RequestMapping(
        path = ["/{tokenId:$UUID_PATTERN}", "/{tokenId:$UUID_PATTERN}/**"],
        method = [
            RequestMethod.GET, RequestMethod.HEAD, RequestMethod.POST, RequestMethod.PUT,
            RequestMethod.PATCH, RequestMethod.DELETE, RequestMethod.OPTIONS,
        ],
    )
    fun capture(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ) {
        val token = tokens.findOrGone(tokenId)
        if (requests.count(token) >= properties.maxRequests) {
            throw ResponseStatusException(HttpStatus.GONE, "Too many requests, please create a new URL/token")
        }
        if (token.timeout > 0) Thread.sleep(Duration.ofSeconds(token.timeout))
        val captured = request.toCapturedRequest(tokenId, clock.legacyNow())
        requests.store(token, captured)
        response.writeConfiguredResponse(token, captured, responseStatus(request.secondSegment(), token.defaultStatus))
    }

    private fun HttpServletResponse.writeConfiguredResponse(
        token: Token,
        captured: CapturedRequest,
        status: Int,
    ) {
        this.status = status
        responseContentType(token.defaultContentType, status)?.let { contentType = it }
        setHeader("X-Request-Id", captured.uuid.toString())
        setHeader("X-Token-Id", token.uuid.toString())
        if (token.cors) CORS_HEADERS.forEach(::setHeader)
        if (status != HttpServletResponse.SC_NO_CONTENT && status != HttpServletResponse.SC_NOT_MODIFIED) {
            outputStream.write(token.defaultContent.toByteArray(UTF_8))
        }
    }
}
