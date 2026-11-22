package anzol.defense.lab

import anzol.privacy.SECRET_HEADER
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import anzol.support.SseClient
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode
import java.time.Duration

/** Grande demais para aparecer por acaso num valor, num id ou num instante. */
private const val SEED = 9_000_000_000_000_001L
private const val WAVE = 22

/** O que só o gabarito e o relatório dizem. */
private val ANSWER_KEY_WORDS =
    listOf("\"scenario\"", "\"layer\"", "\"family\"", "\"floor\"", "\"seed\"", SEED.toString())
private val SCENARIO_CODE = Regex("\"[ICP][0-9]\"")

@ApiTest
@DisplayName("Guarda: o gabarito da rodada de defesa só sai no relatório")
class DefenseLeakApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun lab(): JsonNode = api.json(api.send("POST", "/defense-lab", "{}".toByteArray(), JSON_BODY))

    private fun id(lab: JsonNode): String = lab["token"]["uuid"].asString()

    private fun secret(lab: JsonNode) = mapOf(SECRET_HEADER to lab["read_secret"].asString())

    private fun get(
        lab: JsonNode,
        suffix: String,
    ): String = api.send("GET", "/token/${id(lab)}$suffix", headers = JSON_CLIENT + secret(lab)).body()

    private fun start(lab: JsonNode): String =
        api.send("POST", "/token/${id(lab)}/defense-lab/rounds", """{"seed":$SEED}""".toByteArray(), JSON_BODY + secret(lab)).body()

    private fun messages(lab: JsonNode): List<JsonNode> = api.tree(get(lab, "/requests?per_page=100"))["data"].toList()

    private fun delete(lab: JsonNode) = api.send("DELETE", "/token/${id(lab)}", headers = JSON_CLIENT + secret(lab))

    @Test
    @DisplayName(
        "Dado uma rodada aberta, quando lê a abertura, a URL, a lista, cada mensagem, a busca, as estatísticas e o stream, então " +
            "nada traz cenário, camada, família, piso, semente nem título do catálogo",
    )
    fun leitura_antesDoFim_naoDeveTrazerOGabarito() {
        val lab = lab()
        SseClient("${api.base}/token/${id(lab)}/stream", secret(lab)).use { stream ->
            val opened = start(lab)
            await().atMost(Duration.ofSeconds(10)).until { stream.created().size >= WAVE }
            val search =
                api.send("POST", "/token/${id(lab)}/requests/search", """{"text":"evt_"}""".toByteArray(), JSON_BODY + secret(lab)).body()
            val each = messages(lab).map { get(lab, "/request/${it["uuid"].asString()}") }
            val read =
                listOf(opened, get(lab, ""), get(lab, "/requests?per_page=100"), search, get(lab, "/stats")) + each +
                    stream.created().map { it.data }

            assertThat(each).hasSize(WAVE)
            assertThat(read).allSatisfy { body ->
                assertThat(body).doesNotContain(ANSWER_KEY_WORDS)
                assertThat(body).doesNotContain(DefenseScenario.entries.map { it.title })
                assertThat(SCENARIO_CODE.find(body)).isNull()
            }
        }
        delete(lab)
    }

    @Test
    @DisplayName(
        "Dado uma rodada aberta, quando compara as mensagens, então IP, host, método, User-Agent e nomes de cabeçalho só " +
            "diferem na assinatura",
    )
    fun mensagens_soDiferemNaAssinatura() {
        val lab = lab()
        start(lab)

        val shapes =
            messages(lab).map { message ->
                listOf(
                    message["ip"].asString(),
                    message["hostname"].asString(),
                    message["method"].asString(),
                    message["user_agent"].asString(),
                    message["url"].asString(),
                    (message["headers"].propertyNames() - "stripe-signature" - "content-length").sorted().toString(),
                )
            }

        assertThat(shapes).hasSize(WAVE)
        assertThat(shapes.toSet()).hasSize(1)
        delete(lab)
    }

    @Test
    @DisplayName(
        "Dado a mesma semente em duas URLs, quando abre a rodada em cada uma, então os corpos chegam iguais e na mesma " +
            "ordem, fora os instantes",
    )
    fun semente_mesma_deveRepetirAOndaEmOutraUrl() {
        val first = lab()
        val second = lab()

        start(first)
        start(second)

        assertThat(bodies(first)).hasSize(WAVE).isEqualTo(bodies(second))
        delete(first)
        delete(second)
    }

    private fun bodies(lab: JsonNode): List<JsonNode> =
        messages(lab).map { (api.tree(it["content"].asString()) as ObjectNode).apply { remove("created") } }
}
