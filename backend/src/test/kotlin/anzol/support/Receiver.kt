package anzol.support

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/** O que chegou ao [Receiver]: alvo cru (caminho e query), cabeçalhos com nome em minúsculas e o corpo. */
class Received(
    val method: String,
    val target: String,
    val headers: Map<String, List<String>>,
    val body: ByteArray,
) {
    fun header(name: String): String? = headers[name.lowercase()]?.lastOrNull()
}

/** Responde [status] com [body] e os [headers]; corpo vazio sai com `Content-Length: 0`. */
fun HttpExchange.reply(
    status: Int,
    body: ByteArray = ByteArray(0),
    headers: Map<String, String> = emptyMap(),
) {
    headers.forEach { (name, value) -> responseHeaders.add(name, value) }
    sendResponseHeaders(status, if (body.isEmpty()) -1 else body.size.toLong())
    if (body.isNotEmpty()) responseBody.use { it.write(body) }
    close()
}

/**
 * Receptor HTTP local, em 127.0.0.1 e porta livre, para o replay e o send: guarda o que chega e responde com
 * [respond]. Os testes de saída nunca vão para fora da máquina.
 */
class Receiver(
    respond: (HttpExchange) -> Unit = { it.reply(200, "ok".toByteArray()) },
) : AutoCloseable {
    val received = CopyOnWriteArrayList<Received>()
    private val server =
        HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0).apply {
            executor = Executors.newVirtualThreadPerTaskExecutor()
            createContext("/") { exchange ->
                val headers = exchange.requestHeaders.entries.associate { (name, values) -> name.lowercase() to values.toList() }
                val target =
                    exchange.requestURI.rawPath +
                        exchange.requestURI.rawQuery
                            ?.let { "?$it" }
                            .orEmpty()
                received.add(Received(exchange.requestMethod, target, headers, exchange.requestBody.readAllBytes()))
                respond(exchange)
            }
            start()
        }

    val port: Int get() = server.address.port

    fun url(path: String = ""): String = "http://127.0.0.1:$port$path"

    override fun close() = server.stop(0)
}
