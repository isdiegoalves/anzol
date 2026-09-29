package anzol.capture

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import anzol.support.SseClient
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors

private const val INVALID_MESSAGE = """{"auto_cleanup":["The selected auto cleanup is invalid."]}"""

@ApiTest
@DisplayName("Limpeza automática por URL")
class AutoCleanupApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun send(tokenId: String): String =
        api
            .send("GET", "/$tokenId")
            .headers()
            .firstValue("X-Request-Id")
            .orElseThrow()

    private fun sendMany(
        tokenId: String,
        count: Int,
    ): List<String> = (1..count).map { send(tokenId) }

    private fun listing(tokenId: String) = api.json(api.send("GET", "/token/$tokenId/requests?per_page=10000", headers = JSON_CLIENT))

    private fun listedIds(tokenId: String): List<String> = listing(tokenId)["data"].toList().map { it["uuid"].asString() }

    @Nested
    @DisplayName("Configuração")
    inner class Settings {
        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado auto_cleanup permitido (número ou string), quando cria o token, então grava o número")
        @CsvSource(delimiter = '|', value = ["500 | 500", "'\"1000\"' | 1000", "5000 | 5000", "10000 | 10000"])
        fun create_valorPermitido_deveGravarNumero(
            sent: String,
            expected: Int,
        ) {
            val token = api.createToken("""{"auto_cleanup":$sent}""")

            assertThat(token["auto_cleanup"].isIntegralNumber).isTrue()
            assertThat(token["auto_cleanup"].asInt()).isEqualTo(expected)
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado auto_cleanup ausente, nulo ou em branco, quando cria o token, então fica null")
        @ValueSource(strings = ["{}", """{"auto_cleanup":null}""", """{"auto_cleanup":""}"""])
        fun create_semAutoCleanup_deveFicarNull(body: String) {
            val response = api.send("POST", "/token", body.toByteArray(), JSON_BODY)

            assertThat(response.statusCode()).isEqualTo(201)
            assertThat(api.json(response)["auto_cleanup"].isNull).isTrue()
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado auto_cleanup fora da lista, quando cria ou edita o token, então responde 422 no formato do Laravel")
        @ValueSource(strings = ["700", "0", "-500", "500.5", "\"abc\"", "\" 500\"", "true", "[500]", "{\"a\":500}", "99999999999999999999"])
        fun createEUpdate_valorForaDaLista_deveResponder422(value: String) {
            val tokenId = api.tokenId("""{"auto_cleanup":500}""")

            val created = api.send("POST", "/token", """{"auto_cleanup":$value}""".toByteArray(), JSON_BODY)
            val updated = api.send("PUT", "/token/$tokenId", """{"auto_cleanup":$value}""".toByteArray(), JSON_BODY)

            assertThat(created.statusCode()).isEqualTo(422)
            assertThat(api.json(created)).isEqualTo(api.tree(INVALID_MESSAGE))
            assertThat(updated.statusCode()).isEqualTo(422)
            assertThat(api.json(updated)).isEqualTo(api.tree(INVALID_MESSAGE))
            assertThat(api.json(api.send("GET", "/token/$tokenId"))["auto_cleanup"].asInt()).isEqualTo(500)
        }

        @Test
        @DisplayName("Dado um token com auto_cleanup, quando o PUT omite o campo, então volta a null")
        fun update_campoAusente_deveVoltarANull() {
            val tokenId = api.tokenId("""{"auto_cleanup":1000}""")

            val edited = api.json(api.send("PUT", "/token/$tokenId", """{"default_status":201}""".toByteArray(), JSON_BODY))

            assertThat(edited["auto_cleanup"].isNull).isTrue()
        }
    }

    @Nested
    @DisplayName("Corte ao gravar")
    inner class TrimOnStore {
        @Test
        @DisplayName("Dado auto_cleanup 500, quando chegam 510 mensagens, então ficam as 500 mais recentes e a última está entre elas")
        fun store_acimaDoLimite_deveManterAsMaisRecentes() {
            val tokenId = api.tokenId("""{"auto_cleanup":500}""")

            val sent = sendMany(tokenId, 510)

            val page = listing(tokenId)
            assertThat(page["total"].asInt()).isEqualTo(500)
            assertThat(page["data"].toList().map { it["uuid"].asString() }).containsExactlyElementsOf(sent.drop(10))
            assertThat(api.send("GET", "/token/$tokenId/request/${sent.first()}").statusCode()).isEqualTo(404)
            assertThat(redis.opsForHash<String, String>().size("token:$tokenId:requests")).isEqualTo(500)
        }

        @Test
        @DisplayName("Dado uma URL sem auto_cleanup, quando chega a 501ª mensagem, então responde 200 (nunca 410) e grava")
        fun store_semAutoCleanup_naoDeveResponder410() {
            val tokenId = api.tokenId()
            sendMany(tokenId, 500)

            val response = api.send("GET", "/$tokenId")

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(listing(tokenId)["total"].asInt()).isEqualTo(501)
        }

        @Test
        @DisplayName(
            "Dado auto_cleanup 500 e 20 clientes simultâneos, quando chegam 600 mensagens, então hash e índice ficam com as mesmas 500",
        )
        fun store_gravacoesConcorrentes_deveCortarExatamente() {
            val tokenId = api.tokenId("""{"auto_cleanup":500}""")
            val statuses = ConcurrentLinkedQueue<Int>()

            Executors.newFixedThreadPool(20).use { pool ->
                repeat(600) { pool.submit { statuses.add(api.send("POST", "/$tokenId", "x".toByteArray()).statusCode()) } }
            }

            val indexed = redis.opsForZSet().range("token:$tokenId:requests:index", 0, -1)
            assertThat(statuses).hasSize(600).containsOnly(200)
            assertThat(indexed).hasSize(500)
            assertThat(redis.opsForHash<String, String>().keys("token:$tokenId:requests")).containsExactlyInAnyOrderElementsOf(indexed)
            assertThat(listing(tokenId)["total"].asInt()).isEqualTo(500)
        }
    }

    @Nested
    @DisplayName("Corte ao reduzir o limite")
    inner class TrimOnUpdate {
        @Test
        @DisplayName("Dado 510 mensagens sem limpeza, quando o PUT põe auto_cleanup 500, então corta as 10 mais antigas na hora")
        fun update_limiteMenor_deveCortarNaHora() {
            val tokenId = api.tokenId()
            val sent = sendMany(tokenId, 510)

            val edited = api.send("PUT", "/token/$tokenId", """{"auto_cleanup":500}""".toByteArray(), JSON_BODY)

            assertThat(edited.statusCode()).isEqualTo(200)
            assertThat(listedIds(tokenId)).containsExactlyElementsOf(sent.drop(10))
            assertThat(redis.opsForZSet().size("token:$tokenId:requests:index")).isEqualTo(500)
            assertThat(redis.opsForHash<String, String>().size("token:$tokenId:requests")).isEqualTo(500)
        }
    }

    @Nested
    @DisplayName("Evento request.created")
    inner class Event {
        @Test
        @DisplayName("Dado uma URL no limite, quando chega mais uma, então o evento traz removed com a mais antiga e total no limite")
        fun stream_corte_deveListarRemovidas() {
            val tokenId = api.tokenId("""{"auto_cleanup":500}""")
            val sent = sendMany(tokenId, 500)
            SseClient("${api.base}/token/$tokenId/stream").use { client ->
                val arrived = send(tokenId)

                await().atMost(Duration.ofSeconds(5)).until { client.events.isNotEmpty() }
                val payload = api.tree(client.events.first().data)
                assertThat(payload["request"]["uuid"].asString()).isEqualTo(arrived)
                assertThat(payload["removed"].toList().map { it.asString() }).containsExactly(sent.first())
                assertThat(payload["total"].asInt()).isEqualTo(500)
            }
        }

        @Test
        @DisplayName("Dado uma URL abaixo do limite, quando chega mensagem, então o evento traz removed vazio")
        fun stream_semCorte_deveTrazerRemovedVazio() {
            val tokenId = api.tokenId()
            SseClient("${api.base}/token/$tokenId/stream").use { client ->
                send(tokenId)

                await().atMost(Duration.ofSeconds(5)).until { client.events.isNotEmpty() }
                val payload = api.tree(client.events.first().data)
                assertThat(payload.propertyNames().toList()).containsExactly("request", "total", "truncated", "removed")
                assertThat(payload["removed"].isArray).isTrue()
                assertThat(payload["removed"].size()).isZero()
            }
        }
    }
}
