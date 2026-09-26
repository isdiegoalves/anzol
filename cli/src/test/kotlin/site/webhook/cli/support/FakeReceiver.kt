package site.webhook.cli.support

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Uma resposta do receptor: status, headers e, com [delay], quanto ela demora a sair. */
data class Reply(
    val status: Int,
    val headers: Map<String, String> = emptyMap(),
    val delay: Duration = Duration.ZERO,
)

/** Uma requisição recebida, com os bytes crus do corpo e o instante em que chegou (nanoTime). */
data class Arrival(
    val method: String,
    val path: String,
    val headers: Map<String, List<String>>,
    val body: ByteArray,
    val nanos: Long,
) {
    fun header(name: String): String? = headers[name.lowercase()]?.single()

    fun text(): String = String(body, Charsets.UTF_8)
}

/**
 * O receptor de webhooks do app do dono: grava cada requisição e responde, na ordem, as [replies];
 * depois da última, repete a última. Os três de que o `send` precisa saem das fábricas abaixo.
 */
class FakeReceiver(
    private val replies: List<Reply>,
) : AutoCloseable {
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    private val released = CountDownLatch(1)
    val arrivals = CopyOnWriteArrayList<Arrival>()

    val url: String get() = "http://127.0.0.1:${server.address.port}"

    init {
        server.executor = Executors.newVirtualThreadPerTaskExecutor()
        server.createContext("/", ::handle)
        server.start()
    }

    /** Solta as respostas que ainda esperam o [Reply.delay] (fim do teste). */
    override fun close() {
        released.countDown()
        server.stop(0)
    }

    @Synchronized
    private fun record(exchange: HttpExchange): Reply {
        arrivals +=
            Arrival(
                method = exchange.requestMethod,
                path =
                    exchange.requestURI.rawPath +
                        exchange.requestURI.rawQuery
                            ?.let { "?$it" }
                            .orEmpty(),
                headers = exchange.requestHeaders.entries.associate { (name, values) -> name.lowercase() to values.toList() },
                body = exchange.requestBody.use { it.readAllBytes() },
                nanos = System.nanoTime(),
            )
        return replies[minOf(arrivals.size, replies.size) - 1]
    }

    private fun handle(exchange: HttpExchange) {
        val reply = record(exchange)
        if (!reply.delay.isZero) released.await(reply.delay.toMillis(), TimeUnit.MILLISECONDS)
        reply.headers.forEach { (name, value) -> exchange.responseHeaders.add(name, value) }
        exchange.sendResponseHeaders(reply.status, -1)
        exchange.close()
    }

    companion object {
        /** Aceita tudo com [status]. */
        fun capturing(status: Int = 200) = FakeReceiver(listOf(Reply(status)))

        /** Falha [times] vezes com [status] e depois responde 200. */
        fun failing(
            times: Int,
            status: Int = 503,
        ) = FakeReceiver(List(times) { Reply(status) } + Reply(200))

        /** Responde [status] com `Retry-After: <value>` uma vez e depois 200. */
        fun retryAfter(
            value: String,
            status: Int = 429,
        ) = FakeReceiver(listOf(Reply(status, mapOf("Retry-After" to value)), Reply(200)))
    }
}
