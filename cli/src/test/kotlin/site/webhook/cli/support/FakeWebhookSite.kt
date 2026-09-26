package site.webhook.cli.support

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.io.OutputStream
import java.net.InetSocketAddress
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

private val TOKEN_ROUTE = Regex("/token/([^/]+)")
private val STREAM_ROUTE = Regex("/token/([^/]+)/stream")
private val LIST_ROUTE = Regex("/token/([^/]+)/requests")
private val FIND_ROUTE = Regex("/token/([^/]+)/request/([^/]+)")
private val RULES_ROUTE = Regex("/token/([^/]+)/rules")
private const val DEFAULT_PER_PAGE = 50
private const val UNPROCESSABLE = 422
private const val UNAVAILABLE = 503
private const val TOKEN_NOT_FOUND = """{"success":false,"error":{"message":"Token not found","id":null}}"""

/**
 * Servidor webhook.site falso, só com as rotas que o CLI usa, no formato de `tests/contract/`:
 * `POST /token`, `GET /token/{id}` (410 se não existe), o SSE `request.created`, a listagem
 * paginada (e a incremental, `after=<seq>`), `GET /token/{id}/request/{rid}` e `GET`/`PUT /token/{id}/rules`.
 * Cada mensagem gravada ganha `seq` crescente, como o índice do servidor real.
 */
class FakeWebhookSite : AutoCloseable {
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    private val messages = ConcurrentHashMap<String, MutableList<JsonObject>>()
    private val subscribers = CopyOnWriteArrayList<Subscriber>()
    private val ruleLists = ConcurrentHashMap<String, JsonArray>()
    private val lastSeq = AtomicLong()

    /** Quantos `PUT /token/{id}/rules` chegaram, válidos ou não. */
    val rulePuts = AtomicLong()

    /** Com true, o `/stream` responde 503: o servidor "caiu" para o CLI, mas ainda grava mensagens. */
    @Volatile var streamsRefused = false

    /** Roda uma vez logo depois de registrar o próximo assinante, antes de o CLI ver a conexão. */
    @Volatile var onNextSubscribe: (() -> Unit)? = null

    /** Roda a cada listagem (com a query dela), antes de responder: ex. um DELETE no meio da recuperação. */
    @Volatile var onList: ((String) -> Unit)? = null

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
        messages.getValue(message.token()).removeIf { it["uuid"] == message["uuid"] }
    }

    fun deleteToken(token: String) {
        messages.remove(token)
        ruleLists.remove(token)
    }

    /** As regras da URL, como o `GET /token/{id}/rules` devolve (lista vazia quando não há). */
    fun rules(token: String): JsonArray = ruleLists[token] ?: JsonArray(emptyList())

    fun storeRules(
        token: String,
        list: JsonArray,
    ) {
        ruleLists[token] = list
    }

    /**
     * Grava a mensagem com o próximo `seq`, sem avisar ninguém (ela chegou enquanto o CLI estava
     * desconectado, ou o evento dela ainda vai sair por [notify]); devolve a mensagem gravada.
     */
    @Synchronized
    fun store(message: JsonObject): JsonObject {
        val stored = message.with("seq", JsonPrimitive(lastSeq.incrementAndGet()))
        messages.getValue(message.token()).add(stored)
        return stored
    }

    /** Grava e manda `request.created`. */
    fun publish(
        message: JsonObject,
        truncated: Boolean = false,
    ) = notify(store(message), truncated)

    /**
     * Manda o `request.created` de uma mensagem já gravada, na ordem que o teste quiser (no servidor
     * real, gravações simultâneas publicam fora da ordem do índice). Truncado, o evento vai sem
     * `content`, `headers` e `user_agent`.
     */
    fun notify(
        message: JsonObject,
        truncated: Boolean = false,
    ) {
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
            method == "PUT" && RULES_ROUTE.matches(path) -> replaceRules(exchange, RULES_ROUTE.matchEntire(path)?.groupValues?.get(1))
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
            LIST_ROUTE.matches(path) -> list(exchange, stored.toList())
            FIND_ROUTE.matches(path) -> find(exchange, stored, FIND_ROUTE.matchEntire(path)?.groupValues?.get(2))
            RULES_ROUTE.matches(path) -> exchange.respond(200, rules(token).toString())
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
        val rawQuery = exchange.requestURI.query.orEmpty()
        onList?.invoke(rawQuery)
        val query = rawQuery.split('&').associate { it.substringBefore('=') to it.substringAfter('=') }
        val perPage = query["per_page"]?.toInt() ?: DEFAULT_PER_PAGE
        val after = query["after"]?.toLong()
        val page = if (after != null) 1 else query["page"]?.toInt() ?: 1
        val remaining =
            when {
                after != null -> stored.filter { it.seq() > after }
                query["sorting"] == "newest" -> stored.reversed()
                else -> stored
            }
        val skipped = (page - 1) * perPage
        val data = remaining.drop(skipped).take(perPage)
        val body =
            buildJsonObject {
                put("data", JsonArray(data))
                put("total", stored.size)
                put("per_page", perPage)
                put("current_page", page)
                put("is_last_page", data.size + skipped >= remaining.size)
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

    /**
     * Como o servidor real: 410 sem o token; 422 com chaves em notação de ponto quando o corpo não é
     * lista (`rules`) ou uma regra não tem `name` (`N.name`); senão grava, dando `id` a quem não tem,
     * e devolve a lista salva.
     */
    private fun replaceRules(
        exchange: HttpExchange,
        token: String?,
    ) {
        rulePuts.incrementAndGet()
        val body = exchange.requestBody.use { String(it.readAllBytes()) }
        val list = runCatching { Json.parseToJsonElement(body) }.getOrNull() as? JsonArray
        val missingName = list?.indices?.filter { "name" !in list[it].jsonObject }.orEmpty()
        when {
            token == null || !messages.containsKey(token) -> {
                exchange.respond(410, TOKEN_NOT_FOUND)
            }

            list == null -> {
                exchange.respond(UNPROCESSABLE, """{"rules":["The rules must be an array."]}""")
            }

            missingName.isNotEmpty() -> {
                val errors =
                    buildJsonObject {
                        missingName.forEach {
                            putJsonArray(
                                "$it.name",
                            ) { add(JsonPrimitive("The name field is required.")) }
                        }
                    }
                exchange.respond(UNPROCESSABLE, errors.toString())
            }

            else -> {
                val saved = JsonArray(list.map { rule -> rule.jsonObject.withId() })
                ruleLists[token] = saved
                exchange.respond(200, saved.toString())
            }
        }
    }

    private fun JsonObject.withId(): JsonObject = if ("id" in this) this else with("id", JsonPrimitive(UUID.randomUUID().toString()))

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

private fun JsonObject.seq(): Long = getValue("seq").jsonPrimitive.long

private fun HttpExchange.respond(
    status: Int,
    body: String,
) {
    val bytes = body.toByteArray()
    responseHeaders.add("Content-Type", "application/json")
    sendResponseHeaders(status, if (bytes.isEmpty()) -1 else bytes.size.toLong())
    responseBody.use { it.write(bytes) }
}
