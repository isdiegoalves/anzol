package anzol.capture

import anzol.http.STORAGE_FULL_MESSAGE
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import anzol.support.SilentSubscriber
import anzol.support.SseClient
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.test.context.TestPropertySource
import tools.jackson.databind.json.JsonMapper
import java.time.Duration

private val TIMESTAMP = Regex("""\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}""")
private val HEARTBEAT: Duration = Duration.ofMillis(200)

/**
 * Redis com `maxmemory` e `noeviction` (docker-compose.yml): cheio, recusa gravação em vez de
 * despejar chaves. O webhook responde 507 (Insufficient Storage), e o que já está gravado continua legível.
 */
@ApiTest
@TestPropertySource(properties = ["anzol.stream.heartbeat=200ms"])
@DisplayName("Redis cheio (noeviction)")
class RedisFullApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)
    private val wait = await().atMost(Duration.ofSeconds(5))

    private fun subscribe(tokenId: String) = SseClient("${api.base}/token/$tokenId/stream")

    /** O `data` de cada evento `storage` que a aba recebeu. */
    private fun SseClient.storage() = events.filter { it.name == "storage" }.map { api.tree(it.data) }

    /** O `full` de cada evento `storage` que a aba recebeu, na ordem. */
    private fun SseClient.fullSaid() = storage().map { it["full"].asBoolean() }

    /** As abas já ouviram que o servidor está cheio: quem abre o stream agora ouve o `storage` antes do `ping`. */
    private fun fullAnnounced(tokenId: String): Boolean =
        subscribe(tokenId).use { client ->
            wait.until { client.events.isNotEmpty() }
            client.events.first().name == "storage"
        }

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

    /**
     * A mensagem que passa e o silêncio de recusas desfazem o "cheio" que o servidor guarda: os testes do mesmo
     * contexto abrem o stream sem ele.
     */
    @AfterEach
    fun storingAgain() {
        unlimited()
        val tokenId = api.tokenId()
        api.send("GET", "/$tokenId")
        wait.until { !fullAnnounced(tokenId) }
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
        "Dado abas em duas URLs e pedidos que alternam entre não caber e caber, quando o Redis enche e volta, então " +
            "todas ouvem storage cheio uma vez e a volta uma vez, depois do silêncio de recusas",
    )
    fun stream_recusasEGravacoesAlternando_deveAnunciarCheioEAVoltaUmaVezCada() {
        val tokenId = api.tokenId()
        val other = api.tokenId()
        subscribe(tokenId).use { client ->
            subscribe(other).use { otherClient ->
                val answers =
                    (1..10).flatMap {
                        fillUp()
                        val refused = api.send("POST", "/$tokenId", "x".repeat(10_000).toByteArray())
                        unlimited()
                        listOf(refused, api.send("POST", "/$other", "cabe".toByteArray()))
                    }
                wait.until { client.fullSaid().lastOrNull() == false && otherClient.fullSaid().lastOrNull() == false }
                Thread.sleep(HEARTBEAT.multipliedBy(3).toMillis())

                val newest = api.json(api.send("GET", "/token/$other/requests?sorting=newest", headers = JSON_CLIENT))
                val lastStored = newest["data"].first()
                assertThat(answers.map { it.statusCode() }.distinct()).containsExactly(507, 200)
                val (full, back) = client.storage()
                assertThat(client.fullSaid()).containsExactly(true, false)
                assertThat(otherClient.storage()).isEqualTo(client.storage())
                assertThat(full.propertyNames().toList()).containsExactly("full", "since")
                assertThat(full["since"].asString()).matches(TIMESTAMP.pattern)
                assertThat(back["since"]).isEqualTo(lastStored["created_at"])
                assertThat(otherClient.created()).hasSize(10)
            }
        }
    }

    @Test
    @DisplayName("Dado o Redis cheio, quando uma aba abre o stream, então recebe storage cheio antes do ping; depois da volta, não")
    fun stream_abertoComRedisCheio_deveDizerCheioAntesDoPing() {
        val tokenId = api.tokenId()
        fillUp()
        api.send("POST", "/$tokenId", "x".repeat(10_000).toByteArray())
        wait.until { fullAnnounced(tokenId) }

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
    @DisplayName(
        "Dado um assinante que não lia quando o cheio foi avisado, quando ele volta a ler, então ouve o storage que ficou devendo",
    )
    fun stream_assinanteQueVoltaALer_deveOuvirOStorageDevido() {
        val tokenId = api.tokenId()
        subscribe(tokenId).use { client ->
            SilentSubscriber(api, port, api.tokenId()).use { silent ->
                Thread.sleep(HEARTBEAT.multipliedBy(5).toMillis())
                fillUp()
                api.send("POST", "/$tokenId", "x".repeat(10_000).toByteArray())
                wait.until { client.storage().isNotEmpty() }

                silent.startReading()

                wait.until { "event:storage" in silent.received() }
                assertThat(silent.received().substringAfter("event:storage").substringBefore("\n\n")).contains("\"full\":true")
            }
        }
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
