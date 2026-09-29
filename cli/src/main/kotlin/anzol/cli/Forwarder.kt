package anzol.cli

import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpConnectTimeoutException
import java.net.http.HttpRequest
import java.net.http.HttpRequest.BodyPublisher
import java.net.http.HttpRequest.BodyPublishers
import java.net.http.HttpResponse.BodyHandlers
import java.net.http.HttpTimeoutException
import java.nio.charset.StandardCharsets.US_ASCII
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.time.LocalTime

/**
 * Headers gravados que não são reenviados: hop-by-hop (valem só para a conexão original), `host`
 * e `content-length` (o cliente HTTP recalcula) e `expect` (o `java.net.http` o recusa).
 * Mais os que começam com `proxy-`.
 */
private val DROPPED_HEADERS =
    setOf("connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "host", "content-length", "expect")
private const val PROXY_PREFIX = "proxy-"
private val FORWARD_TIMEOUT: Duration = Duration.ofSeconds(30)
private const val CUT_CONNECT_TIMEOUT_MS = 10_000
private const val HTTP_PORT = 80
private const val NANOS_PER_MILLI = 1_000_000

/** O `User-Agent` que o `java.net.http` põe quando a mensagem não trouxe um; o corte manda o mesmo. */
private val CLIENT_USER_AGENT = "Java-http-client/" + System.getProperty("java.version")

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

/** O que uma tentativa de entrega obteve do app local. */
sealed interface Outcome {
    data class Answered(
        val answer: Answer.Status,
        val millis: Long,
    ) : Outcome

    /** Sem resposta; [gaveUp] quando foi o `--chaos-timeout` que desistiu. */
    data class Failed(
        val reason: String,
        val gaveUp: Boolean = false,
    ) : Outcome

    /** O `--chaos-abort` fechou a conexão depois de [sent] dos [total] bytes do corpo. */
    data class Cut(
        val sent: Int,
        val total: Int,
    ) : Outcome

    fun text(): String =
        when (this) {
            is Answered -> "${answer.code} ($millis ms)"
            is Failed -> "error: $reason"
            is Cut -> "cut after $sent of $total bytes"
        }

    fun retryable(): Boolean =
        when (this) {
            is Answered -> answer.retryable()
            is Failed, is Cut -> true
        }
}

/** Uma tentativa: quando começou, o caminho, o resultado, se era um multipart remontado e o caos que ela sofreu. */
data class Attempt(
    val started: LocalTime,
    val route: Route,
    val outcome: Outcome,
    val multipart: Boolean,
    val injected: List<String>,
)

/**
 * Entrega uma mensagem gravada ao app local: `<target>` + caminho após o token + query, com os headers gravados.
 * [drip] manda o corpo em gotejamento; [timeout] é quanto esperar pela resposta depois do corpo (padrão 30 s).
 */
class Forwarder(
    private val target: String,
    private val http: HttpClient,
    private val drip: Drip? = null,
    private val timeout: Duration? = null,
) {
    /** Com [cut], manda cabeçalhos e metade do corpo e fecha a conexão, sem esperar resposta. */
    fun attempt(
        token: TokenId,
        message: CapturedRequest,
        cut: Boolean = false,
    ): Attempt {
        val route = message.route(token)
        val started = LocalTime.now()
        val multipart = message.rebuiltMultipart()
        val body = (multipart?.body ?: message.content).toByteArray(UTF_8)
        val outcome =
            try {
                val request = request(message, route, multipart, body)
                if (cut) cut(request, body) else send(request)
            } catch (e: IOException) {
                Outcome.Failed(e.reason())
            } catch (e: IllegalArgumentException) {
                Outcome.Failed(e.message.orEmpty())
            }
        val injected =
            listOfNotNull(
                drip?.takeIf { body.isNotEmpty() }?.let { "slow ${it.bytesPerSecond} B/s" },
                "abort".takeIf { outcome is Outcome.Cut },
                "timeout".takeIf { outcome is Outcome.Failed && outcome.gaveUp },
            )
        return Attempt(started, route, outcome, multipart = multipart != null, injected)
    }

    private fun send(request: HttpRequest): Outcome {
        val started = System.nanoTime()
        return try {
            val response = http.send(request, BodyHandlers.discarding())
            val retryAfter = parseRetryAfter(response.headers().firstValue("Retry-After").orElse(null))
            Outcome.Answered(Answer.Status(response.statusCode(), retryAfter), (System.nanoTime() - started) / NANOS_PER_MILLI)
        } catch (e: HttpConnectTimeoutException) {
            Outcome.Failed(e.reason())
        } catch (e: HttpTimeoutException) {
            timeout?.let { Outcome.Failed("timed out after ${it.toMillis()} ms", gaveUp = true) } ?: Outcome.Failed(e.reason())
        }
    }

    /**
     * Pelo socket, e não pelo `java.net.http`: só assim a metade do corpo chega inteira antes do FIN (o cliente
     * HTTP descarta o que ainda não escreveu quando a requisição falha).
     */
    private fun cut(
        request: HttpRequest,
        body: ByteArray,
    ): Outcome {
        val uri = request.uri()
        val half = body.size / 2
        val address = InetSocketAddress(uri.host.removeSurrounding("[", "]"), uri.port.takeIf { it != -1 } ?: HTTP_PORT)
        Socket().use { socket ->
            socket.connect(address, CUT_CONNECT_TIMEOUT_MS)
            val output = socket.getOutputStream()
            output.write(head(request, body.size))
            val dripping = drip
            if (dripping == null) output.write(body, 0, half) else DripStream(body.copyOf(half), dripping).transferTo(output)
            output.flush()
            socket.shutdownOutput()
        }
        return Outcome.Cut(half, body.size)
    }

    private fun head(
        request: HttpRequest,
        length: Int,
    ): ByteArray {
        val uri = request.uri()
        val lines =
            buildList {
                add("${request.method()} ${uri.rawPath.ifEmpty { "/" }}${uri.rawQuery?.let { "?$it" }.orEmpty()} HTTP/1.1")
                add("Host: ${uri.host}${if (uri.port == -1) "" else ":${uri.port}"}")
                request.headers().map().forEach { (name, values) -> values.forEach { add("$name: $it") } }
                if (request.headers().firstValue("user-agent").isEmpty) add("User-Agent: $CLIENT_USER_AGENT")
                if (length > 0) add("Content-Length: $length")
            }
        return lines.joinToString("\r\n", postfix = "\r\n\r\n").toByteArray(US_ASCII)
    }

    private fun request(
        message: CapturedRequest,
        route: Route,
        multipart: RebuiltMultipart?,
        body: ByteArray,
    ): HttpRequest {
        val dripping = drip?.pause(body.size) ?: Duration.ZERO
        val builder =
            HttpRequest
                .newBuilder(URI.create(target.trimEnd('/') + route.path + route.query?.let { "?$it" }.orEmpty()))
                .timeout((timeout ?: FORWARD_TIMEOUT) + dripping)
                .method(message.method, publisher(body))
        message.headers
            .filterKeys { it.lowercase() !in DROPPED_HEADERS && !it.lowercase().startsWith(PROXY_PREFIX) }
            .filterKeys { multipart == null || !it.equals("content-type", ignoreCase = true) }
            .forEach { (name, values) -> values.forEach { builder.header(name, it) } }
        multipart?.let { builder.header("content-type", it.contentType) }
        return builder.build()
    }

    private fun publisher(body: ByteArray): BodyPublisher {
        val dripping = drip
        return when {
            body.isEmpty() -> BodyPublishers.noBody()
            dripping == null -> BodyPublishers.ofByteArray(body)
            else -> BodyPublishers.fromPublisher(BodyPublishers.ofInputStream { DripStream(body, dripping) }, body.size.toLong())
        }
    }
}

/** O corpo lido aos pedaços do [drip], cada um depois da pausa dele. */
private class DripStream(
    private val body: ByteArray,
    private val drip: Drip,
) : InputStream() {
    private var position = 0

    override fun read(): Int {
        val one = ByteArray(1)
        return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and BYTE_MASK
    }

    override fun read(
        buffer: ByteArray,
        offset: Int,
        length: Int,
    ): Int {
        if (position == body.size) return -1
        val size = minOf(length, drip.chunk, body.size - position)
        try {
            Thread.sleep(drip.pause(size))
        } catch (e: InterruptedException) {
            throw InterruptedIOException(e.message)
        }
        body.copyInto(buffer, offset, position, position + size)
        position += size
        return size
    }

    private companion object {
        const val BYTE_MASK = 0xFF
    }
}

/** Motivo curto de uma falha de rede (o `ConnectException` do `java.net.http` vem sem mensagem). */
fun IOException.reason(): String =
    when (this) {
        is ConnectException -> "connection refused"
        is HttpTimeoutException -> "timed out"
        else -> message ?: javaClass.simpleName
    }
