package anzol.support

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import org.springframework.context.ApplicationContextInitializer
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.core.env.MapPropertySource
import org.springframework.test.context.ContextConfiguration
import org.springframework.test.context.TestPropertySource
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/** Chave dos testes da IA: nunca pode aparecer no log nem numa resposta. */
const val TEST_AI_KEY = "sk-teste-NAO-VAZAR-7f3a9c"
const val TEST_MODEL_JSON = "modelo-json-de-teste"
const val TEST_MODEL_TEXT = "modelo-texto-de-teste"

/** Um pedido que chegou ao LLM falso: caminho, `Authorization` e o corpo JSON. */
class LlmRequest(
    val path: String,
    val authorization: String?,
    val body: JsonNode,
) {
    fun messages(): List<JsonNode> = body["messages"].toList()

    fun text(): String = body.toString()
}

/**
 * LLM falso OpenAI-compatível (`POST /v1/chat/completions`) em 127.0.0.1, porta livre, para os testes da IA: responde
 * na ordem o que o teste programou e guarda os pedidos. Nada vai ao oMLX real. Um só para todos os contextos de
 * [AiApiTest]; cada teste começa com [reset].
 */
object FakeLlm {
    private val mapper = JsonMapper.builder().build()
    private val script = ConcurrentLinkedQueue<(HttpExchange) -> Unit>()
    val received = CopyOnWriteArrayList<LlmRequest>()

    /** Quantos pedidos estão sendo atendidos agora (o limite de uma chamada por vez por URL). */
    val inFlight = AtomicInteger()
    val maxInFlight = AtomicInteger()

    private val server =
        HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0).apply {
            executor = Executors.newVirtualThreadPerTaskExecutor()
            createContext("/") { exchange ->
                val now = inFlight.incrementAndGet()
                maxInFlight.accumulateAndGet(now, ::maxOf)
                try {
                    received.add(
                        LlmRequest(
                            exchange.requestURI.path,
                            exchange.requestHeaders.getFirst("Authorization"),
                            mapper.readTree(exchange.requestBody.readAllBytes()),
                        ),
                    )
                    (script.poll() ?: { it.reply(500, "{\"error\":\"sem roteiro no LLM falso\"}".toByteArray()) })(exchange)
                } finally {
                    inFlight.decrementAndGet()
                }
            }
            start()
        }

    val baseUrl: String get() = "http://127.0.0.1:${server.address.port}"

    fun reset() {
        script.clear()
        received.clear()
        maxInFlight.set(0)
    }

    /** Responde 200 com [content] (e, se dado, um `reasoning_content` que o app tem de ignorar), depois de [delayMs]. */
    fun answer(
        content: String,
        reasoning: String? = null,
        delayMs: Long = 0,
    ) {
        val message = linkedMapOf<String, Any>("role" to "assistant", "content" to content)
        if (reasoning != null) message["reasoning_content"] = reasoning
        val completion =
            mapOf(
                "id" to "chatcmpl-falso",
                "object" to "chat.completion",
                "created" to 1,
                "model" to "falso",
                "choices" to listOf(mapOf("index" to 0, "message" to message, "finish_reason" to "stop")),
                "usage" to mapOf("prompt_tokens" to 1, "completion_tokens" to 1, "total_tokens" to 2),
            )
        script.add { exchange ->
            Thread.sleep(delayMs)
            exchange.reply(200, mapper.writeValueAsBytes(completion), mapOf("Content-Type" to "application/json"))
        }
    }

    fun fail(status: Int) {
        script.add {
            it.reply(
                status,
                "{\"error\":{\"message\":\"falha programada\"}}".toByteArray(),
                mapOf("Content-Type" to "application/json"),
            )
        }
    }

    /** Fecha a conexão sem responder. */
    fun hangUp() {
        script.add { it.close() }
    }
}

/** Liga a IA apontando para o [FakeLlm]; a porta só existe em tempo de execução. */
class FakeLlmInitializer : ApplicationContextInitializer<ConfigurableApplicationContext> {
    override fun initialize(context: ConfigurableApplicationContext) {
        val properties = mapOf<String, Any>("anzol.ai.base-url" to FakeLlm.baseUrl)
        context.environment.propertySources.addFirst(MapPropertySource("fakeLlm", properties))
    }
}

/** [ApiTest] com MCP e IA ligados, a IA no [FakeLlm], com chave e modelos de teste. */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@ApiTest
@TestPropertySource(
    properties = [
        "anzol.mcp.enabled=true",
        "anzol.ai.enabled=true",
        "anzol.ai.api-key=$TEST_AI_KEY",
        "anzol.ai.model-json=$TEST_MODEL_JSON",
        "anzol.ai.model-text=$TEST_MODEL_TEXT",
    ],
)
@ContextConfiguration(initializers = [FakeLlmInitializer::class])
annotation class AiApiTest
