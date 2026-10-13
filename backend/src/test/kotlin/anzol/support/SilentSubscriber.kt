package anzol.support

import java.net.InetSocketAddress
import java.net.Socket
import java.nio.charset.StandardCharsets.ISO_8859_1
import kotlin.concurrent.thread

private const val RECEIVE_BUFFER = 4096
private const val BIG_MESSAGES = 8
private const val BIG_MESSAGE_BYTES = 900_000

/**
 * Assinante do stream de [tokenId] que não lê. Com o buffer de recepção mínimo, as mensagens grandes mandadas para a
 * URL dele (sem esperar a resposta, que fica presa no envio a ele) enchem o caminho até o envio parar. [startReading]
 * faz dele um cliente que voltou a ler, e [received] é o que chegou desde então.
 */
class SilentSubscriber(
    api: ApiClient,
    port: Int,
    tokenId: String,
) : AutoCloseable {
    private val socket = Socket()
    private val heard = StringBuffer()

    init {
        socket.receiveBufferSize = RECEIVE_BUFFER
        socket.connect(InetSocketAddress("localhost", port))
        socket.getOutputStream().write("GET /token/$tokenId/stream HTTP/1.1\r\nHost: localhost:$port\r\n\r\n".toByteArray())
        val big = ByteArray(BIG_MESSAGE_BYTES) { 'x'.code.toByte() }
        repeat(BIG_MESSAGES) { thread(isDaemon = true) { runCatching { api.send("POST", "/$tokenId", big) } } }
    }

    fun startReading() {
        thread(isDaemon = true) {
            runCatching {
                val buffer = ByteArray(RECEIVE_BUFFER * RECEIVE_BUFFER)
                val input = socket.getInputStream()
                generateSequence { input.read(buffer).takeIf { it >= 0 } }.forEach { heard.append(String(buffer, 0, it, ISO_8859_1)) }
            }
        }
    }

    fun received(): String = heard.toString()

    override fun close() = socket.close()
}
