package site.webhook.cli.support

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/** O que o app local recebeu, com os nomes de header em minúsculas. */
data class Received(
    val method: String,
    val path: String,
    val query: String?,
    val headers: Map<String, List<String>>,
    val body: String,
)

/** App local do desenvolvedor: grava cada requisição e responde [status] sem corpo. */
class FakeLocalApp(
    @Volatile var status: Int = 200,
    port: Int = 0,
) : AutoCloseable {
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", port), 0)
    val received = CopyOnWriteArrayList<Received>()

    val url: String get() = "http://127.0.0.1:${server.address.port}"

    init {
        server.executor = Executors.newVirtualThreadPerTaskExecutor()
        server.createContext("/", ::handle)
        server.start()
    }

    override fun close() = server.stop(0)

    private fun handle(exchange: HttpExchange) {
        received +=
            Received(
                method = exchange.requestMethod,
                path = exchange.requestURI.rawPath,
                query = exchange.requestURI.rawQuery,
                headers = exchange.requestHeaders.entries.associate { (name, values) -> name.lowercase() to values.toList() },
                body = exchange.requestBody.use { String(it.readAllBytes()) },
            )
        exchange.sendResponseHeaders(status, -1)
        exchange.close()
    }

    companion object {
        /** Porta em que ninguém escuta: o app local fora do ar. */
        fun freePort(): Int = ServerSocket(0).use { it.localPort }
    }
}
