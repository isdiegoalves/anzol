package anzol.cli.support

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private const val HEAD_END = "\r\n\r\n"

/**
 * Uma requisição como chegou no socket: o corpo até o `Content-Length` ou até a conexão fechar antes, e o instante
 * (nanoTime) de cada leitura do corpo. [started] é o fim dos cabeçalhos.
 */
data class RawArrival(
    val method: String,
    val target: String,
    val headers: Map<String, List<String>>,
    val body: ByteArray,
    val declared: Int,
    val started: Long,
    val reads: List<Long>,
) {
    val complete: Boolean get() = body.size == declared

    fun text(): String = String(body, Charsets.UTF_8)
}

/**
 * App local que lê HTTP/1.1 direto do socket, para ver o que o cliente HTTP esconde: corpo cortado no meio e
 * corpo que chega aos pedaços. Responde, na ordem, as [replies] (depois da última, repete a última), só às
 * requisições completas, sempre com `Connection: close`.
 */
class RawReceiver(
    private val replies: List<Reply> = listOf(Reply(200)),
) : AutoCloseable {
    private val server = ServerSocket(0, 0, InetAddress.getLoopbackAddress())
    private val released = CountDownLatch(1)
    val arrivals = CopyOnWriteArrayList<RawArrival>()

    val url: String get() = "http://127.0.0.1:${server.localPort}"

    init {
        Thread.ofVirtual().start {
            while (!server.isClosed) {
                val socket =
                    try {
                        server.accept()
                    } catch (_: IOException) {
                        break
                    }
                Thread.ofVirtual().start { socket.use(::handle) }
            }
        }
    }

    override fun close() {
        released.countDown()
        server.close()
    }

    private fun handle(socket: Socket) {
        try {
            val input = socket.getInputStream()
            val head = readHead(input) ?: return
            val started = System.nanoTime()
            val lines = head.split("\r\n")
            val (method, target) = lines.first().split(' ')
            val headers =
                lines
                    .drop(1)
                    .map { it.substringBefore(':').lowercase() to it.substringAfter(':').trim() }
                    .groupBy({ it.first }, { it.second })
            val declared = headers["content-length"]?.single()?.toInt() ?: 0
            val (body, reads) = readBody(input, declared)
            val reply = record(RawArrival(method, target, headers, body, declared, started, reads))
            if (body.size == declared) answer(socket, reply)
        } catch (_: IOException) {
            // O cliente desistiu antes da resposta (o timeout do caos): nada a responder.
        }
    }

    @Synchronized
    private fun record(arrival: RawArrival): Reply {
        arrivals += arrival
        return replies[minOf(arrivals.size, replies.size) - 1]
    }

    private fun answer(
        socket: Socket,
        reply: Reply,
    ) {
        if (!reply.delay.isZero) released.await(reply.delay.toMillis(), TimeUnit.MILLISECONDS)
        val headers = reply.headers.entries.joinToString("") { (name, value) -> "$name: $value\r\n" }
        val response = "HTTP/1.1 ${reply.status} X\r\n${headers}Content-Length: 0\r\nConnection: close\r\n\r\n"
        socket.getOutputStream().apply {
            write(response.toByteArray(Charsets.US_ASCII))
            flush()
        }
    }

    private fun readHead(input: InputStream): String? {
        val head = StringBuilder()
        while (!head.endsWith(HEAD_END)) {
            val byte = input.read()
            if (byte < 0) return null
            head.append(byte.toChar())
        }
        return head.removeSuffix(HEAD_END).toString()
    }

    private fun readBody(
        input: InputStream,
        declared: Int,
    ): Pair<ByteArray, List<Long>> {
        val body = ByteArrayOutputStream()
        val reads = mutableListOf<Long>()
        val buffer = ByteArray(8192)
        while (body.size() < declared) {
            val read = input.read(buffer, 0, minOf(buffer.size, declared - body.size()))
            if (read < 0) break
            reads += System.nanoTime()
            body.write(buffer, 0, read)
        }
        return body.toByteArray() to reads
    }
}
