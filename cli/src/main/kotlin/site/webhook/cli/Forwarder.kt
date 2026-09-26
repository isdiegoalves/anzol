package site.webhook.cli

import java.io.IOException
import java.net.ConnectException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpRequest.BodyPublishers
import java.net.http.HttpResponse.BodyHandlers
import java.net.http.HttpTimeoutException
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * Headers gravados que não são reenviados: hop-by-hop (valem só para a conexão original), `host`
 * e `content-length` (o cliente HTTP recalcula) e `expect` (o `java.net.http` o recusa).
 * Mais os que começam com `proxy-`.
 */
private val DROPPED_HEADERS =
    setOf("connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "host", "content-length", "expect")
private const val PROXY_PREFIX = "proxy-"
private val CLOCK_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss")
private val FORWARD_TIMEOUT: Duration = Duration.ofSeconds(30)
private const val NANOS_PER_MILLI = 1_000_000

/** Caminho após o token e query crua, tirados da `url` gravada. */
data class Route(
    val path: String,
    val query: String?,
) {
    override fun toString(): String = path.ifEmpty { "/" } + query?.let { "?$it" }.orEmpty()
}

fun CapturedRequest.route(token: TokenId): Route {
    val afterToken = url.substringAfter("/$token", missingDelimiterValue = "")
    val query = afterToken.substringAfter('?', missingDelimiterValue = "")
    return Route(path = afterToken.substringBefore('?'), query = query.ifEmpty { null })
}

/** Linha de saída de um reenvio; [delivered] é false quando o app local não respondeu. */
data class Forwarding(
    val line: String,
    val delivered: Boolean,
)

/**
 * Reenvia uma mensagem gravada ao app local e devolve a linha de saída:
 * `HH:mm:ss MÉTODO caminho?query -> status (n ms)` ou `... -> error: motivo`, com o sufixo
 * [FILES_NOT_FORWARDED] no multipart.
 */
class Forwarder(
    private val target: String,
    private val http: HttpClient,
) {
    fun forward(
        token: TokenId,
        message: CapturedRequest,
    ): Forwarding {
        val route = message.route(token)
        val prefix = "${LocalTime.now().format(CLOCK_FORMAT)} ${message.method} $route -> "
        val boundary = message.multipartBoundary()
        val suffix = if (boundary == null) "" else FILES_NOT_FORWARDED
        val body = if (boundary == null) message.content else message.multipartBody(boundary)
        val started = System.nanoTime()
        return try {
            val status = http.send(request(message, route, body), BodyHandlers.discarding()).statusCode()
            Forwarding(prefix + "$status (${(System.nanoTime() - started) / NANOS_PER_MILLI} ms)" + suffix, delivered = true)
        } catch (e: IOException) {
            Forwarding(prefix + "error: ${e.reason()}" + suffix, delivered = false)
        } catch (e: IllegalArgumentException) {
            Forwarding(prefix + "error: ${e.message}" + suffix, delivered = false)
        }
    }

    private fun request(
        message: CapturedRequest,
        route: Route,
        text: String,
    ): HttpRequest {
        val body = text.toByteArray(UTF_8)
        val builder =
            HttpRequest
                .newBuilder(URI.create(target.trimEnd('/') + route.path + route.query?.let { "?$it" }.orEmpty()))
                .timeout(FORWARD_TIMEOUT)
                .method(message.method, if (body.isEmpty()) BodyPublishers.noBody() else BodyPublishers.ofByteArray(body))
        message.headers
            .filterKeys { it.lowercase() !in DROPPED_HEADERS && !it.lowercase().startsWith(PROXY_PREFIX) }
            .forEach { (name, values) -> values.forEach { builder.header(name, it) } }
        return builder.build()
    }
}

/** Motivo curto de uma falha de rede (o `ConnectException` do `java.net.http` vem sem mensagem). */
fun IOException.reason(): String =
    when (this) {
        is ConnectException -> "connection refused"
        is HttpTimeoutException -> "timed out"
        else -> message ?: javaClass.simpleName
    }
