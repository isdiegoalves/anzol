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

private const val TOO_LARGE_PAGE =
    "<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n" +
        "<center><h1>413 Request Entity Too Large</h1></center>\r\n</body>\r\n</html>\r\n"

/**
 * Faz o que o nginx e o PHP faziam antes do controller: recusa corpo acima de 1 MiB (413), lê o
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

fun HttpServletResponse.rejectTooLarge() {
    status = HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE
    contentType = "text/html; charset=utf-8"
    setHeader(HttpHeaders.CONNECTION, "close")
    outputStream.write(TOO_LARGE_PAGE.toByteArray())
}

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
