package site.webhook.cli.support

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.io.OutputStream
import java.net.InetSocketAddress
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

private val TOKEN_ROUTE = Regex("/token/([^/]+)")
private val STREAM_ROUTE = Regex("/token/([^/]+)/stream")
private val LIST_ROUTE = Regex("/token/([^/]+)/requests")
private val FIND_ROUTE = Regex("/token/([^/]+)/request/([^/]+)")
private const val DEFAULT_PER_PAGE = 50
private const val UNAVAILABLE = 503
private const val TOKEN_NOT_FOUND = """{"success":false,"error":{"message":"Token not found","id":null}}"""

/**
 * Servidor webhook.site falso, só com as rotas que o CLI usa, no formato de `tests/contract/`:
 * `POST /token`, `GET /token/{id}` (410 se não existe), o SSE `request.created`, a listagem
 * paginada e `GET /token/{id}/request/{rid}`.
 */
class FakeWebhookSite : AutoCloseable {
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    private val messages = ConcurrentHashMap<String, MutableList<JsonObject>>()
    private val subscribers = CopyOnWriteArrayList<Subscriber>()

    /** Com true, o `/stream` responde 503: o servidor "caiu" para o CLI, mas ainda grava mensagens. */
    @Volatile var streamsRefused = false

    /** Roda uma vez logo depois de registrar o próximo assinante, antes de o CLI ver a conexão. */
    @Volatile var onNextSubscribe: (() -> Unit)? = null

    val base: String get() = "http://127.0.0.1:${server.address.port}"

    init {
        server.executor = Executors.newVirtualThreadPerTaskExecutor()
        server.createContext("/", ::handle)
        server.start()
    }

    fun createToken(): String = UUID.randomUUID().toString().also { messages[it] = CopyOnWriteArrayList() }

    fun tokens(): Set<String> = messages.keys

    fun subscriberCount(): Int = subscribers.size

    /** Apaga a mensagem, como a limpeza automática ou o DELETE da tela. */
    fun remove(message: JsonObject) {
        messages.getValue(message.token()).remove(message)
    }

    fun deleteToken(token: String) {
        messages.remove(token)
    }

    /** Grava a mensagem sem avisar ninguém: ela chegou enquanto o CLI estava desconectado. */
    fun store(message: JsonObject) {
        messages.getValue(message.token()).add(message)
    }

    /** Grava e manda `request.created`; truncado, o evento vai sem `content`, `headers` e `user_agent`. */
    fun publish(
        message: JsonObject,
        truncated: Boolean = false,
    ) {
        store(message)
        val request = if (truncated) JsonObject(message - setOf("content", "headers", "user_agent")) else message
        val data =
            buildJsonObject {
                put("request", request)
                put("total", messages.getValue(message.token()).size)
                put("truncated", truncated)
                putJsonArray("removed") {}
            }
        subscribers.filter { it.token == message.token() }.forEach { it.send("event:request.created\ndata:$data\n\n") }
    }

    /** Derruba as conexões SSE abertas: o CLI vê o fim do stream. */
    fun dropConnections() {
        subscribers.forEach { it.close() }
        subscribers.clear()
    }

    override fun close() {
        dropConnections()
        server.stop(0)
    }

    private fun handle(exchange: HttpExchange) {
        val path = exchange.requestURI.path
        val method = exchange.requestMethod
        when {
            method == "POST" && path == "/token" -> exchange.respond(201, """{"uuid":"${createToken()}"}""")
            method != "GET" -> exchange.respond(405, "")
            else -> handleGet(exchange, path)
        }
    }

    private fun handleGet(
        exchange: HttpExchange,
        path: String,
    ) {
        val token =
            TOKEN_ROUTE
                .find(path)
                ?.groupValues
                ?.get(1)
                .orEmpty()
        val stored = messages[token]
        when {
            stored == null -> exchange.respond(410, TOKEN_NOT_FOUND)
            TOKEN_ROUTE.matches(path) -> exchange.respond(200, """{"uuid":"$token"}""")
            STREAM_ROUTE.matches(path) -> stream(exchange, token)
            LIST_ROUTE.matches(path) -> list(exchange, stored)
            FIND_ROUTE.matches(path) -> find(exchange, stored, FIND_ROUTE.matchEntire(path)?.groupValues?.get(2))
            else -> exchange.respond(404, "")
        }
    }

    private fun stream(
        exchange: HttpExchange,
        token: String,
    ) {
        if (streamsRefused) return exchange.respond(UNAVAILABLE, "")
        exchange.responseHeaders.add("Content-Type", "text/event-stream")
        exchange.sendResponseHeaders(200, 0)
        val subscriber = Subscriber(token, exchange)
        subscriber.send(":conectado\n\n")
        subscribers += subscriber
        onNextSubscribe?.also { onNextSubscribe = null }?.invoke()
        subscriber.closed.await()
    }

    private fun list(
        exchange: HttpExchange,
        stored: List<JsonObject>,
    ) {
        val query =
            exchange.requestURI.query
                .orEmpty()
                .split('&')
                .associate { it.substringBefore('=') to it.substringAfter('=') }
        val page = query["page"]?.toInt() ?: 1
        val perPage = query["per_page"]?.toInt() ?: DEFAULT_PER_PAGE
        val sorted = if (query["sorting"] == "newest") stored.reversed() else stored.toList()
        val data = sorted.drop((page - 1) * perPage).take(perPage)
        val body =
            buildJsonObject {
                put("data", kotlinx.serialization.json.JsonArray(data))
                put("total", sorted.size)
                put("per_page", perPage)
                put("current_page", page)
                put("is_last_page", data.size + (page - 1) * perPage >= sorted.size)
            }
        exchange.respond(200, body.toString())
    }

    private fun find(
        exchange: HttpExchange,
        stored: List<JsonObject>,
        requestId: String?,
    ) {
        val message = stored.firstOrNull { it["uuid"] == JsonPrimitive(requestId) }
        if (message == null) {
            exchange.respond(404, """{"success":false,"error":{"message":"Request not found","id":null}}""")
        } else {
            exchange.respond(200, message.toString())
        }
    }

    private class Subscriber(
        val token: String,
        private val exchange: HttpExchange,
    ) {
        val closed = CountDownLatch(1)
        private val body: OutputStream = exchange.responseBody

        @Synchronized
        fun send(chunk: String) {
            body.write(chunk.toByteArray())
            body.flush()
        }

        fun close() {
            exchange.close()
            closed.countDown()
        }
    }
}

private fun JsonObject.token(): String = (getValue("token_id") as JsonPrimitive).content

private fun HttpExchange.respond(
    status: Int,
    body: String,
) {
    val bytes = body.toByteArray()
    responseHeaders.add("Content-Type", "application/json")
    sendResponseHeaders(status, if (bytes.isEmpty()) -1 else bytes.size.toLong())
    responseBody.use { it.write(bytes) }
}
