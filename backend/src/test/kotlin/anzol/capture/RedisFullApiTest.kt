package anzol.capture

import anzol.http.STORAGE_FULL_MESSAGE
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import anzol.support.SseClient
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.json.JsonMapper
import java.time.Duration

private val TIMESTAMP = Regex("""\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}""")

/**
 * Redis com `maxmemory` e `noeviction` (docker-compose.yml): cheio, recusa gravação em vez de
 * despejar chaves. O webhook responde 507 (Insufficient Storage), e o que já está gravado continua legível.
 */
@ApiTest
@DisplayName("Redis cheio (noeviction)")
class RedisFullApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)
    private val wait = await().atMost(Duration.ofSeconds(5))

    private fun subscribe(tokenId: String) = SseClient("${api.base}/token/$tokenId/stream")

    /** O `data` de cada evento `storage` que a aba recebeu. */
    private fun SseClient.storage() = events.filter { it.name == "storage" }.map { api.tree(it.data) }

    private fun config(
        name: String,
        value: String,
    ) {
        redis.execute { it.serverCommands().setConfig(name, value) }
    }

    /**
     * Teto de 1 byte, abaixo de qualquer uso: com o teto no uso do instante, o Redis deixa de estar cheio assim que
     * libera por conta própria o buffer de um cliente.
     */
    private fun fillUp() {
        config("maxmemory-policy", "noeviction")
        config("maxmemory", "1")
    }

    private fun unlimited() = config("maxmemory", "0")

    /** A mensagem que passa desfaz o "cheio" que o servidor guarda: os testes do mesmo contexto abrem o stream sem ele. */
    @AfterEach
    fun storingAgain() {
        unlimited()
        api.send("GET", "/${api.tokenId()}")
    }

    @Test
    @DisplayName("Dado o Redis no teto de memória, quando chega mensagem, então responde 507 e token e mensagens antigas seguem legíveis")
    fun capture_redisCheio_deveResponder507SemPerderDados() {
        val tokenId = api.tokenId()
        val stored =
            api
                .send("GET", "/$tokenId")
                .headers()
                .firstValue("X-Request-Id")
                .orElseThrow()
        fillUp()

        val rejected = api.send("POST", "/$tokenId", "x".repeat(10_000).toByteArray(), JSON_CLIENT)
        val token = api.send("GET", "/token/$tokenId", headers = JSON_CLIENT)
        val page = api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT)

        assertThat(rejected.statusCode()).isEqualTo(507)
        assertThat(rejected.headers().allValues("Content-Security-Policy")).containsExactly(CAPTURE_SANDBOX)
        assertThat(api.json(rejected)["error"]["message"].asString()).isEqualTo(STORAGE_FULL_MESSAGE)
        assertThat(token.statusCode()).isEqualTo(200)
        assertThat(page.statusCode()).isEqualTo(200)
        assertThat(api.json(page)["data"].toList().map { it["uuid"].asString() }).containsExactly(stored)
    }

    @Test
    @DisplayName(
        "Dado abas em duas URLs, quando o Redis enche e depois volta, então todas recebem storage cheio uma vez, com a " +
            "hora, e storage livre na primeira mensagem gravada",
    )
    fun stream_redisEncheEVolta_deveAvisarTodasAsAbasNasDuasTransicoes() {
        val tokenId = api.tokenId()
        val other = api.tokenId()
        subscribe(tokenId).use { client ->
            subscribe(other).use { otherClient ->
                fillUp()
                val rejected = api.send("POST", "/$tokenId", "x".repeat(10_000).toByteArray())
                api.send("POST", "/$tokenId", "x".repeat(10_000).toByteArray())
                wait.until { client.storage().isNotEmpty() && otherClient.storage().isNotEmpty() }
                val full = client.storage().toList()
                unlimited()
                api.send("POST", "/$other", "cabe".toByteArray())
                wait.until { client.storage().size == 2 && otherClient.storage().size == 2 }

                assertThat(rejected.statusCode()).isEqualTo(507)
                assertThat(full).hasSize(1)
                assertThat(full.single().propertyNames().toList()).containsExactly("full", "since")
                assertThat(full.single()["full"].asBoolean()).isTrue()
                assertThat(full.single()["since"].asString()).matches(TIMESTAMP.pattern)
                assertThat(otherClient.storage().first()).isEqualTo(full.single())
                assertThat(client.storage().last()["full"].asBoolean()).isFalse()
                assertThat(client.storage().last()["since"].asString()).matches(TIMESTAMP.pattern)
                assertThat(otherClient.storage().last()).isEqualTo(client.storage().last())
                assertThat(otherClient.created()).hasSize(1)
            }
        }
    }

    @Test
    @DisplayName("Dado o Redis cheio, quando uma aba abre o stream, então recebe storage cheio antes do ping; depois da volta, não")
    fun stream_abertoComRedisCheio_deveDizerCheioAntesDoPing() {
        val tokenId = api.tokenId()
        fillUp()
        api.send("POST", "/$tokenId", "x".repeat(10_000).toByteArray())

        val duringFull =
            subscribe(tokenId).use { client ->
                wait.until { client.events.size >= 2 }
                assertThat(client.events.map { it.name }.take(2)).containsExactly("storage", "ping")
                client.storage()
            }
        storingAgain()
        val afterwards =
            subscribe(tokenId).use { client ->
                api.send("GET", "/$tokenId")
                wait.until { client.created().isNotEmpty() }
                client.storage()
            }

        assertThat(duringFull).hasSize(1)
        assertThat(duringFull.single()["full"].asBoolean()).isTrue()
        assertThat(afterwards).isEmpty()
    }

    @Test
    @DisplayName("Dado o Redis no teto, quando a edição da URL é recusada com 507, então as abas também recebem storage cheio")
    fun stream_gestaoRecusada_deveAvisarStorageCheio() {
        val tokenId = api.tokenId()
        subscribe(tokenId).use { client ->
            fillUp()
            val edited = api.send("PUT", "/token/$tokenId", """{"default_content":"${"x".repeat(10_000)}"}""".toByteArray(), JSON_BODY)
            wait.until { client.storage().isNotEmpty() }

            assertThat(edited.statusCode()).isEqualTo(507)
            assertThat(client.storage().single()["full"].asBoolean()).isTrue()
        }
    }
}
