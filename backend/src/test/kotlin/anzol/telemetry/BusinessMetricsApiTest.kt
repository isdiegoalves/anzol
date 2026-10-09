package anzol.telemetry

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.SseClient
import io.micrometer.core.instrument.MeterRegistry
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.test.context.TestPropertySource
import tools.jackson.databind.json.JsonMapper
import java.io.IOException
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.util.HexFormat
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val SECRET = "segredo-das-metricas"
private const val SCHEMA = """{"type":"object","required":["id"]}"""
private val PROMPTLY = Duration.ofSeconds(5)

/** As labels de `anzol.requests.captured` de uma captura sem regra, assinatura nem schema, com resposta 2xx. */
private val PLAIN =
    mapOf(
        "method" to "GET",
        "status_class" to "2xx",
        "rule" to "none",
        "signature" to "none",
        "schema" to "none",
        "fault" to "none",
        "decryption" to "none",
    )

private fun githubSignature(body: ByteArray): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(SECRET.toByteArray(UTF_8), "HmacSHA256"))
    return "sha256=" + HexFormat.of().formatHex(mac.doFinal(body))
}

/**
 * Métricas de negócio no registro do contexto (em memória: nos testes nada é exportado). O registro é
 * compartilhado com as outras classes de teste, então cada caso compara o antes e o depois.
 */
@ApiTest
@DisplayName("Métricas de negócio")
class BusinessMetricsApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val registry: MeterRegistry,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun captured(tags: Map<String, String>): Double =
        registry
            .find("anzol.requests.captured")
            .tags(*tags.flatMap { (key, value) -> listOf(key, value) }.toTypedArray())
            .counters()
            .sumOf { it.count() }

    private fun counter(name: String): Double = registry.find(name).counter()?.count() ?: 0.0

    /** Quanto a ação somou à captura com [tags]. */
    private fun capturedBy(
        tags: Map<String, String>,
        action: () -> Unit,
    ): Double {
        val before = captured(tags)
        action()
        return captured(tags) - before
    }

    private fun putRules(
        tokenId: String,
        rules: String,
    ) = api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY)

    @Nested
    @DisplayName("anzol.requests.captured")
    inner class Captured {
        @Test
        @DisplayName("Dada uma URL sem regra, assinatura nem schema, quando recebe um GET, então conta 1 com as labels none e 2xx")
        fun capture_urlSimples_deveContarComLabelsNone() {
            val tokenId = api.tokenId()

            assertThat(capturedBy(PLAIN) { api.send("GET", "/$tokenId") }).isEqualTo(1.0)
        }

        @Test
        @DisplayName("Dado o status 503 no caminho, quando captura, então status_class é 5xx")
        fun capture_statusNoCaminho_deveContar5xx() {
            val tokenId = api.tokenId()

            assertThat(capturedBy(PLAIN + ("status_class" to "5xx")) { api.send("GET", "/$tokenId/503") }).isEqualTo(1.0)
        }

        @Test
        @DisplayName("Dada uma regra que casa e responde 404, quando captura, então rule é matched e status_class 4xx")
        fun capture_regraCasada_deveContarMatched() {
            val tokenId = api.tokenId()
            putRules(tokenId, """[{"name":"nao-achou","match":{"method":["POST"]},"response":{"status":404}}]""")
            val tags = PLAIN + mapOf("method" to "POST", "rule" to "matched", "status_class" to "4xx")

            assertThat(capturedBy(tags) { api.send("POST", "/$tokenId") }).isEqualTo(1.0)
            assertThat(capturedBy(PLAIN) { api.send("GET", "/$tokenId") }).isEqualTo(1.0)
        }

        @Test
        @DisplayName("Dada uma regra com falha de rede, quando captura, então fault é o tipo da falha e status_class none")
        fun capture_falhaDeRede_deveContarFault() {
            val tokenId = api.tokenId()
            putRules(tokenId, """[{"name":"cai","response":{"fault":"empty_response"}}]""")
            // POST: o cliente HTTP do JDK repete sozinho um GET cuja conexão caiu, e seriam duas capturas.
            val tags = PLAIN + mapOf("method" to "POST", "rule" to "matched", "status_class" to "none", "fault" to "empty_response")

            val counted =
                capturedBy(tags) {
                    runCatching { api.send("POST", "/$tokenId") }
                        .onSuccess { error("a conexão devia ter caído: $it") }
                        .onFailure { assertThat(it).isInstanceOf(IOException::class.java) }
                }

            assertThat(counted).isEqualTo(1.0)
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dada uma URL com assinatura do GitHub, quando captura, então signature é valid ou invalid (ausente é invalid)")
        @CsvSource(delimiter = '|', value = ["assinada | valid", "adulterada | invalid", "sem cabeçalho | invalid"])
        fun capture_assinatura_deveContarEstado(
            case: String,
            expected: String,
        ) {
            val tokenId = api.tokenId("""{"signature":{"provider":"github","secret":"$SECRET"}}""")
            val body = """{"ok":true}""".toByteArray()
            val headers =
                when (case) {
                    "assinada" -> mapOf("X-Hub-Signature-256" to githubSignature(body))
                    "adulterada" -> mapOf("X-Hub-Signature-256" to githubSignature("outro".toByteArray()))
                    else -> emptyMap()
                }
            val tags = PLAIN + mapOf("method" to "POST", "signature" to expected)

            assertThat(capturedBy(tags) { api.send("POST", "/$tokenId", body, headers) }).isEqualTo(1.0)
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dada uma URL com schema, quando captura, então schema é valid ou invalid")
        @CsvSource(delimiter = '|', value = ["'{\"id\":1}' | valid", "'{\"nome\":1}' | invalid"])
        fun capture_schema_deveContarEstado(
            body: String,
            expected: String,
        ) {
            val tokenId = api.tokenId("""{"schema":$SCHEMA}""")
            val tags = PLAIN + mapOf("method" to "POST", "schema" to expected)

            assertThat(capturedBy(tags) { api.send("POST", "/$tokenId", body.toByteArray()) }).isEqualTo(1.0)
        }

        @Test
        @DisplayName("Dadas capturas de todo tipo, quando lê o registro, então nenhuma métrica tem o token nem o id da mensagem em label")
        fun capture_qualquer_naoDeveGravarTokenEmLabel() {
            val tokenId = api.tokenId()
            putRules(tokenId, """[{"name":"post","match":{"method":["POST"]},"response":{"status":201}}]""")
            val requestId =
                api
                    .send("GET", "/$tokenId/404")
                    .headers()
                    .firstValue("X-Request-Id")
                    .orElseThrow()
            api.send("POST", "/$tokenId/qualquer/coisa?x=1")
            api.send("GET", "/token/$tokenId/requests")

            val labels = registry.meters.flatMap { it.id.tags }

            assertThat(labels).noneMatch { tokenId in it.value || requestId in it.value || "127.0.0.1" in it.value }
            assertThat(registry.find("anzol.requests.captured").counters())
                .allSatisfy { assertThat(it.id.tags.map { tag -> tag.key }).containsExactlyInAnyOrderElementsOf(PLAIN.keys) }
        }
    }

    @Nested
    @DisplayName("anzol.capture.duration")
    inner class CaptureDuration {
        @Test
        @DisplayName("Dada uma regra com delay de 600 ms, quando captura, então o tempo registrado não inclui o delay")
        fun capture_regraComDelay_naoDeveContarODelay() {
            val tokenId = api.tokenId()
            putRules(tokenId, """[{"name":"lenta","response":{"delay":{"fixed":600}}}]""")
            val timer = registry.get("anzol.capture.duration").timer()
            val (countBefore, totalBefore) = timer.count() to timer.totalTime(TimeUnit.MILLISECONDS)

            val started = System.nanoTime()
            api.send("GET", "/$tokenId")
            val tookMs = Duration.ofNanos(System.nanoTime() - started).toMillis()

            assertThat(tookMs).isGreaterThanOrEqualTo(600)
            assertThat(timer.count() - countBefore).isEqualTo(1)
            assertThat(timer.totalTime(TimeUnit.MILLISECONDS) - totalBefore).isLessThan(600.0)
        }
    }

    @Nested
    @DisplayName("Limpeza e Redis cheio")
    inner class Storage {
        @Test
        @DisplayName("Dada uma URL com auto_cleanup 500 cheia, quando chega a 501ª, então anzol.cleanup.removed soma 1")
        fun capture_acimaDoLimite_deveContarARemovida() {
            val tokenId = api.tokenId("""{"auto_cleanup":500}""")
            repeat(500) { api.send("GET", "/$tokenId") }
            val before = counter("anzol.cleanup.removed")

            api.send("GET", "/$tokenId")

            assertThat(counter("anzol.cleanup.removed") - before).isEqualTo(1.0)
        }

        @Test
        @DisplayName("Dado o Redis no teto de memória, quando chega mensagem, então anzol.storage.full soma 1 e a captura não conta")
        fun capture_redisCheio_deveContar507() {
            val tokenId = api.tokenId()
            val used = redis.execute { it.serverCommands().info("memory") }?.getProperty("used_memory")?.toLong() ?: 0
            val before = counter("anzol.storage.full")
            val capturedBefore = captured(PLAIN + ("method" to "POST"))
            try {
                redis.execute { it.serverCommands().setConfig("maxmemory-policy", "noeviction") }
                redis.execute { it.serverCommands().setConfig("maxmemory", used.toString()) }

                val response = api.send("POST", "/$tokenId", "x".repeat(10_000).toByteArray())

                assertThat(response.statusCode()).isEqualTo(507)
            } finally {
                redis.execute { it.serverCommands().setConfig("maxmemory", "0") }
            }

            assertThat(counter("anzol.storage.full") - before).isEqualTo(1.0)
            assertThat(captured(PLAIN + ("method" to "POST"))).isEqualTo(capturedBefore)
        }
    }

    // Contexto próprio: no compartilhado, abas fechadas por outras classes seguem no gauge até um heartbeat, que pode
    // cair no meio do teste e tirar uma delas da conta.
    @Nested
    @TestPropertySource(properties = ["anzol.stream.heartbeat=1h"])
    @DisplayName("Gauges de SSE e wait")
    inner class Gauges(
        @LocalServerPort port: Int,
        jsonMapper: JsonMapper,
        private val registry: MeterRegistry,
    ) {
        private val api = ApiClient(port, jsonMapper)

        private fun gauge(name: String): Double = registry.get(name).gauge().value()

        @Test
        @DisplayName("Dada uma aba no SSE, quando conecta e fecha, então anzol.sse.subscribers sobe 1 e volta na próxima mensagem")
        fun stream_abaAbertaEFechada_deveSubirEVoltar() {
            val tokenId = api.tokenId()
            val before = gauge("anzol.sse.subscribers")

            SseClient("${api.base}/token/$tokenId/stream").use {
                await().atMost(PROMPTLY).until { gauge("anzol.sse.subscribers") == before + 1 }
            }

            // O servidor só descobre a aba fechada ao escrever nela: a mensagem nova (ou o heartbeat) faz isso.
            await().atMost(PROMPTLY).until {
                api.send("GET", "/$tokenId")
                gauge("anzol.sse.subscribers") == before
            }
        }

        @Test
        @DisplayName("Dada uma espera em andamento, quando a mensagem chega, então anzol.wait.active sobe 1 e volta")
        fun wait_emAndamento_deveSubirEVoltar() {
            val tokenId = api.tokenId()
            val before = gauge("anzol.wait.active")

            val call =
                CompletableFuture.supplyAsync {
                    api.send("POST", "/token/$tokenId/requests/wait", """{"timeout":5000}""".toByteArray(), JSON_BODY)
                }
            await().atMost(PROMPTLY).until { gauge("anzol.wait.active") == before + 1 }
            api.send("GET", "/$tokenId")

            assertThat(call.get(PROMPTLY.seconds, TimeUnit.SECONDS).statusCode()).isEqualTo(200)
            await().atMost(PROMPTLY).until { gauge("anzol.wait.active") == before }
        }
    }
}
