package site.webhook.http

import jakarta.servlet.FilterChain
import jakarta.servlet.ReadListener
import jakarta.servlet.ServletInputStream
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpHeaders
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import site.webhook.UUID_PATTERN
import tools.jackson.databind.json.JsonMapper
import java.io.BufferedReader
import java.io.ByteArrayInputStream
import java.io.InputStreamReader

/** Rota do servidor MCP (`spring.ai.mcp.server.streamable-http.mcp-endpoint`). */
const val MCP_ENDPOINT = "/mcp"

/** `client_max_body_size` padrão do nginx do app antigo (1 MiB). */
const val MAX_BODY_BYTES = 1024 * 1024

/**
 * `POST /token/{id}/send`: o `body` a enviar tem até 1 MiB e vai dentro de um JSON, com aspas e escapes; o pedido
 * inteiro pode ter o dobro. Só esta rota: capturas e demais rotas seguem com 1 MiB.
 */
private const val MAX_SEND_REQUEST_BYTES = 2 * MAX_BODY_BYTES
private val SEND_ROUTE = Regex("/token/$UUID_PATTERN/send")

/** `large_client_header_buffers 4 8k` do nginx: a linha `Nome: valor` cabe em 8190 bytes (+ CRLF). */
private const val MAX_HEADER_LINE = 8190

/** Página 413 do nginx, que respondia antes de a requisição chegar ao PHP, para qualquer cliente. */
const val TOO_LARGE_PAGE =
    "<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n" +
        "<center><h1>413 Request Entity Too Large</h1></center>\r\n</body>\r\n</html>\r\n"

private const val HEADER_TOO_LARGE_PAGE =
    "<html>\r\n<head><title>400 Request Header Or Cookie Too Large</title></head>\r\n<body>\r\n" +
        "<center><h1>400 Bad Request</h1></center>\r\n<center>Request Header Or Cookie Too Large</center>\r\n" +
        "</body>\r\n</html>\r\n"

/**
 * Faz o que o nginx e o PHP faziam antes do controller: recusa linha de cabeçalho acima de 8 KB
 * (400) e corpo acima de 1 MiB (413), lê o corpo cru uma vez, monta o [LegacyInput] e aplica o
 * `X-HTTP-Method-Override` / `_method` do Symfony. Roda antes de tudo para que ninguém consuma o
 * corpo antes dele. Só o transporte do MCP lê o corpo pelo stream: para ele, o corpo lido volta ([ReplayedBody]).
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
        val limit = request.bodyLimit()
        val body =
            if (request.contentLengthLong > limit) {
                null
            } else {
                request.inputStream.readNBytes(limit + 1).takeIf { it.size <= limit }
            }
        if (body == null) {
            response.rejectTooLarge()
        } else {
            val input = request.readLegacyInput(body, jsonMapper)
            request.setAttribute(LegacyInput.ATTRIBUTE, input)
            request.setAttribute(RAW_BODY_ATTRIBUTE, body)
            response.setHeader(HttpHeaders.CACHE_CONTROL, "no-cache, private")
            val forward = request.withMethodOverride(input)
            filterChain.doFilter(if (request.requestURI == MCP_ENDPOINT) ReplayedBody(forward, body) else forward, response)
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

private fun HttpServletRequest.bodyLimit(): Int =
    if (method == "POST" && SEND_ROUTE.matches(requestURI)) MAX_SEND_REQUEST_BYTES else MAX_BODY_BYTES

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

/** O corpo que o filtro já leu, de novo no stream, para quem o lê por ali (o transporte do MCP em [MCP_ENDPOINT]). */
private class ReplayedBody(
    request: HttpServletRequest,
    private val body: ByteArray,
) : HttpServletRequestWrapper(request) {
    private val stream = ByteArrayInputStream(body)

    override fun getInputStream(): ServletInputStream =
        object : ServletInputStream() {
            override fun read(): Int = stream.read()

            override fun read(
                buffer: ByteArray,
                offset: Int,
                length: Int,
            ): Int = stream.read(buffer, offset, length)

            override fun isFinished(): Boolean = stream.available() == 0

            override fun isReady(): Boolean = true

            override fun setReadListener(listener: ReadListener) = throw UnsupportedOperationException("corpo já lido pelo filtro")
        }

    override fun getReader(): BufferedReader = BufferedReader(InputStreamReader(inputStream, characterEncoding ?: "UTF-8"))

    override fun getContentLengthLong(): Long = body.size.toLong()
}
