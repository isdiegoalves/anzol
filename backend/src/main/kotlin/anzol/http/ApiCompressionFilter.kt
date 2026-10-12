package anzol.http

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.server.PathContainer
import org.springframework.http.server.RequestPath
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.util.ContentCachingResponseWrapper
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

/** Depois do `LegacyRequestFilter`, da barra final, do `AllowedHostFilter` e do `RegexScopeFilter`. */
private const val API_COMPRESSION_ORDER = Ordered.HIGHEST_PRECEDENCE + 4

/** Abaixo de 1 kB o gzip não paga o cabeçalho que acrescenta. */
private const val MIN_COMPRESSED_BYTES = 1024

private const val MANAGEMENT_ROOT = "token"
private const val STREAM_SEGMENT = "stream"
private const val STREAM_DEPTH = 3
private const val GZIP = "gzip"

/**
 * Comprime em gzip as respostas JSON da API de gestão (`/token/...`) acima de 1 kB, para o cliente que manda
 * `Accept-Encoding: gzip`: a listagem de 500 mensagens pesa meio megabyte e cai a menos de um décimo.
 *
 * Só essas rotas. A captura (`/{id}/...`) responde ao remetente do webhook o que a URL manda responder, byte a byte, e
 * o `/mcp` tem o transporte dele; por isso não serve o `server.compression` do Tomcat, que vale por tipo de conteúdo e
 * pegaria a captura que responde JSON. O `/token/{id}/stream` fica de fora porque a resposta é guardada inteira antes
 * de sair, e ele entrega evento por evento: uma rota assíncrona nova em `/token/...` precisa da mesma exceção.
 */
@Component
@Order(API_COMPRESSION_ORDER)
class ApiCompressionFilter : OncePerRequestFilter() {
    override fun shouldNotFilter(request: HttpServletRequest): Boolean {
        val segments = request.segments()
        val stream = segments.size == STREAM_DEPTH && segments.last() == STREAM_SEGMENT
        return segments.firstOrNull() != MANAGEMENT_ROOT || stream || !request.acceptsCoding(GZIP)
    }

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val buffered = ContentCachingResponseWrapper(response)
        filterChain.doFilter(request, buffered)
        val body = buffered.contentAsByteArray
        if (!buffered.isCompressible(body.size)) return buffered.copyBodyToResponse()
        val zipped = ByteArrayOutputStream().also { bytes -> GZIPOutputStream(bytes).use { it.write(body) } }.toByteArray()
        response.setHeader(HttpHeaders.CONTENT_ENCODING, GZIP)
        response.addHeader(HttpHeaders.VARY, HttpHeaders.ACCEPT_ENCODING)
        response.setContentLength(zipped.size)
        response.outputStream.write(zipped)
    }
}

private fun HttpServletResponse.isCompressible(size: Int): Boolean =
    size >= MIN_COMPRESSED_BYTES && !isCommitted && getHeader(HttpHeaders.CONTENT_ENCODING) == null && isJson()

private fun HttpServletResponse.isJson(): Boolean {
    val subtype = contentType?.let { runCatching { MediaType.parseMediaType(it).subtype }.getOrNull() }.orEmpty()
    return subtype == "json" || subtype.endsWith("+json")
}

/** O cliente aceita esta codificação: ela está no `Accept-Encoding` e não com `q=0`. */
fun HttpServletRequest.acceptsCoding(coding: String): Boolean =
    getHeaders(HttpHeaders.ACCEPT_ENCODING)
        .asSequence()
        .flatMap { it.split(',') }
        .map { it.split(';').map(String::trim) }
        .any { parts -> parts.first().equals(coding, ignoreCase = true) && parts.drop(1).none { it.isZeroWeight() } }

private fun String.isZeroWeight(): Boolean = startsWith("q=", ignoreCase = true) && substring(2).trim().toDoubleOrNull() == 0.0

/** Os segmentos não vazios do caminho, como o Spring MVC os compara: decodificados e sem `;x=y`. */
private fun HttpServletRequest.segments(): List<String> =
    RequestPath
        .parse(requestURI, contextPath)
        .pathWithinApplication()
        .elements()
        .filterIsInstance<PathContainer.PathSegment>()
        .map { it.decodedOrRaw() }
        .filter { it.isNotEmpty() }

private fun PathContainer.PathSegment.decodedOrRaw(): String =
    try {
        valueToMatch()
    } catch (_: IllegalArgumentException) {
        value()
    }
