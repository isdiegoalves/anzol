package site.webhook.http

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpHeaders
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import tools.jackson.databind.json.JsonMapper

/** `client_max_body_size` padrão do nginx do app antigo (1 MiB). */
const val MAX_BODY_BYTES = 1024 * 1024

/** `large_client_header_buffers 4 8k` do nginx: a linha `Nome: valor` cabe em 8190 bytes (+ CRLF). */
private const val MAX_HEADER_LINE = 8190

private const val TOO_LARGE_PAGE =
    "<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n" +
        "<center><h1>413 Request Entity Too Large</h1></center>\r\n</body>\r\n</html>\r\n"

private const val HEADER_TOO_LARGE_PAGE =
    "<html>\r\n<head><title>400 Request Header Or Cookie Too Large</title></head>\r\n<body>\r\n" +
        "<center><h1>400 Bad Request</h1></center>\r\n<center>Request Header Or Cookie Too Large</center>\r\n" +
        "</body>\r\n</html>\r\n"

/**
 * Faz o que o nginx e o PHP faziam antes do controller: recusa linha de cabeçalho acima de 8 KB
 * (400) e corpo acima de 1 MiB (413), lê o
 * corpo cru uma vez, monta o [LegacyInput] e aplica o `X-HTTP-Method-Override` / `_method` do
 * Symfony. Roda antes de tudo para que ninguém consuma o corpo antes dele.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class LegacyRequestFilter(
    private val jsonMapper: JsonMapper,
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        if (request.hasHeaderLineAbove(MAX_HEADER_LINE)) {
            response.rejectLikeNginx(HttpServletResponse.SC_BAD_REQUEST, HEADER_TOO_LARGE_PAGE)
            return
        }
        val body =
            when {
                request.contentLengthLong > MAX_BODY_BYTES -> null
                request.isPhpMultipartPost() -> ByteArray(0)
                else -> request.inputStream.readNBytes(MAX_BODY_BYTES + 1).takeIf { it.size <= MAX_BODY_BYTES }
            }
        if (body == null) {
            response.rejectTooLarge()
        } else {
            val input = request.readLegacyInput(body, jsonMapper)
            request.setAttribute(LegacyInput.ATTRIBUTE, input)
            response.setHeader(HttpHeaders.CACHE_CONTROL, "no-cache, private")
            filterChain.doFilter(request.withMethodOverride(input), response)
        }
    }
}

fun HttpServletResponse.rejectTooLarge() = rejectLikeNginx(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE, TOO_LARGE_PAGE)

/** Página de erro do próprio nginx, que respondia antes de a requisição chegar ao PHP. */
private fun HttpServletResponse.rejectLikeNginx(
    status: Int,
    page: String,
) {
    this.status = status
    contentType = "text/html; charset=utf-8"
    setHeader(HttpHeaders.CONNECTION, "close")
    outputStream.write(page.toByteArray())
}

private fun HttpServletRequest.hasHeaderLineAbove(limit: Int): Boolean =
    headerNames.asSequence().any { name -> getHeaders(name).asSequence().any { value -> name.length + 2 + value.length > limit } }

/** `Request::getMethod()` do Symfony: só um POST pode virar outro método. */
private fun HttpServletRequest.withMethodOverride(input: LegacyInput): HttpServletRequest {
    val override =
        (getHeader("X-HTTP-Method-Override") ?: input.inputBag()["_method"] ?: input.query["_method"])
            ?.let { it as? String }
            ?.uppercase()
            ?.takeIf { method == "POST" && it.isNotEmpty() }
            ?: return this
    return object : HttpServletRequestWrapper(this) {
        override fun getMethod(): String = override
    }
}
