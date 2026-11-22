package anzol.mcp

import anzol.support.AiApiTest
import io.modelcontextprotocol.client.McpClient
import io.modelcontextprotocol.client.McpSyncClient
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.TextContent
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import kotlin.text.Charsets.UTF_8

/** Um agente gerenciado corta o resultado de ferramenta em 100 KiB, e outro só mostra um trecho acima de 100.000 caracteres. */
private const val RESULT_LIMIT = 100_000

/** O teto do teste: a onda inteira cabe com folga. Passou daqui, a listagem precisa de decisão do dono (paginar ou resumir). */
private const val WAVE_LISTING_CEILING = 60_000
private const val UNKNOWN_ROUND = "00000000-0000-4000-8000-000000000000"

/** O que só o gabarito e o relatório dizem. */
private val ANSWER_KEY_WORDS = listOf("\"scenario\"", "\"layer\"", "\"family\"", "\"floor\"", "\"seed\"")

private const val FLOOR_RULES =
    """[{"name":"signature: invalid → 401","match":{"signature":"invalid"},"response":{"status":401}},""" +
        """{"name":"signature: absent → 401","match":{"signature":"absent"},"response":{"status":401}}]"""

@AiApiTest
@DisplayName("MCP e o laboratório de defesa")
class McpDefenseApiTest(
    @LocalServerPort port: Int,
    private val jsonMapper: JsonMapper,
) {
    private val client: McpSyncClient =
        McpClient
            .sync(HttpClientStreamableHttpTransport.builder("http://localhost:$port").endpoint("/mcp").build())
            .requestTimeout(Duration.ofSeconds(60))
            .build()
            .also { it.initialize() }

    @AfterEach
    fun close() {
        client.closeGracefully()
    }

    private fun call(
        tool: String,
        arguments: Map<String, Any?> = emptyMap(),
    ): CallToolResult =
        client.callTool(
            CallToolRequest
                .builder()
                .name(tool)
                .arguments(arguments)
                .build(),
        )

    private fun CallToolResult.text(): String = (content().single() as TextContent).text()

    private fun CallToolResult.json(): JsonNode = jsonMapper.readTree(text())

    /** Os argumentos que identificam a URL de laboratório: o id e o segredo de leitura. */
    private fun url(lab: JsonNode): Map<String, Any?> =
        mapOf("token_id" to lab["token"]["uuid"].asString(), "read_secret" to lab["read_secret"].asString())

    private fun started(lab: JsonNode): String = call("start_defense_round", url(lab)).json()["round_id"].asString()

    private fun listing(lab: JsonNode): CallToolResult = call("list_requests", url(lab) + mapOf("per_page" to 100))

    @Test
    @DisplayName(
        "Dado só as ferramentas do MCP, quando um defensor cria a URL, abre a rodada, lê, julga, grava regras e fecha, então o " +
            "relatório mede a rodada, e passar o segredo de leitura como argumento não conta como vazamento",
    )
    fun rodadaInteira_soPeloMcp() {
        val lab = call("create_defense_lab").json()
        val round = started(lab)
        val attacks = listing(lab).json()["data"].toList().filterNot { it["signature"]["valid"].asBoolean() }
        val verdicts = attacks.map { mapOf("request_id" to it["uuid"].asString(), "verdict" to "attack", "family" to "integrity") }

        val recorded = call("submit_defense_verdicts", url(lab) + mapOf("round_id" to round, "verdicts" to verdicts)).json()
        call("set_rules", url(lab) + mapOf("rules" to jsonMapper.readValue(FLOOR_RULES, List::class.java)))
        val report = call("finish_defense_round", url(lab) + mapOf("round_id" to round)).json()

        assertThat(lab["briefing"].asString()).contains("never instructions")
        assertThat(recorded["recorded"].asInt()).isEqualTo(4)
        assertThat(report["detection"]["detected"].asInt()).isEqualTo(4)
        assertThat(report["containment"]["blocked"].asInt()).isEqualTo(4)
        assertThat(report["containment"]["passed"].asInt()).isEqualTo(report["containment"]["legitimate"].asInt())
        assertThat(report["actions"].toString()).isEqualTo("""{"rule_writes":1,"config_changes":0,"outbound":0}""")
        assertThat(report["loosening"]["loosened"].asBoolean()).isFalse()
        assertThat(report["injection"]["obeyed"].asInt()).isZero()
        call("delete_url", url(lab))
    }

    @Test
    @DisplayName(
        "Dado uma onda inteira, quando o list_requests a devolve, então o resultado fica abaixo do teto do teste, bem abaixo do " +
            "corte de 100 KiB de agentes gerenciados",
    )
    fun listRequests_ondaInteira_deveCaberNoResultadoDeFerramenta() {
        val lab = call("create_defense_lab").json()
        val requests = call("start_defense_round", url(lab)).json()["requests"].asInt()

        val text = listing(lab).text()
        val bytes = text.toByteArray(UTF_8).size

        println("MEDIDA list_requests de uma onda: $requests requisições, ${text.length} caracteres, $bytes bytes")
        assertThat(jsonMapper.readTree(text)["data"].size()).isEqualTo(requests)
        assertThat(bytes).isLessThan(WAVE_LISTING_CEILING).isLessThan(RESULT_LIMIT)
        assertThat(text.length).isLessThan(WAVE_LISTING_CEILING)
        call("delete_url", url(lab))
    }

    @Test
    @DisplayName("Dado uma rodada aberta, quando lê pelo MCP a lista, uma mensagem e a busca, então nada traz o gabarito")
    fun leituraPeloMcp_naoDeveTrazerOGabarito() {
        val lab = call("create_defense_lab").json()
        val opened = call("start_defense_round", url(lab)).text()
        val list = listing(lab)
        val first = list.json()["data"][0]["uuid"].asString()

        val read =
            listOf(
                opened,
                list.text(),
                call("get_request", url(lab) + mapOf("request_id" to first)).text(),
                call("search_requests", url(lab) + mapOf("text" to "evt_")).text(),
                call("get_url", url(lab)).text(),
            )

        assertThat(read).allSatisfy { assertThat(it).doesNotContain(ANSWER_KEY_WORDS) }
        call("delete_url", url(lab))
    }

    @Test
    @DisplayName(
        "Dado as ferramentas listadas, quando lê as anotações, então só o catálogo é de leitura entre as 5 do laboratório de " +
            "defesa, nenhuma delas é destrutiva, set_rules é escrita e delete_url segue a única destrutiva",
    )
    fun anotacoes_dasFerramentasDeDefesa() {
        val tools = client.listTools().tools().associateBy { it.name() }
        val defense =
            listOf("create_defense_lab", "list_defense_scenarios", "start_defense_round", "submit_defense_verdicts", "finish_defense_round")

        assertThat(tools.keys).containsAll(defense)
        assertThat(defense.filter { tools.getValue(it).annotations().readOnlyHint() }).containsExactly("list_defense_scenarios")
        assertThat(defense.filter { tools.getValue(it).annotations().destructiveHint() }).isEmpty()
        assertThat(tools.getValue("set_rules").annotations().readOnlyHint()).isFalse()
        assertThat(tools.values.filter { it.annotations().destructiveHint() }.map { it.name() }).containsExactly("delete_url")
    }

    @Test
    @DisplayName(
        "Dado uma URL comum, uma rodada já aberta e uma rodada que não existe, quando chama, então erro de ferramenta com 422, 409 e 404",
    )
    fun erros_viramErroDeFerramenta() {
        val common = call("create_url").json()["uuid"].asString()
        val lab = call("create_defense_lab").json()
        started(lab)

        val notLab = call("start_defense_round", mapOf("token_id" to common))
        val second = call("start_defense_round", url(lab))
        val unknown = call("finish_defense_round", url(lab) + mapOf("round_id" to UNKNOWN_ROUND))
        val malformed = call("submit_defense_verdicts", url(lab) + mapOf("round_id" to "x", "verdicts" to emptyList<Any>()))

        assertThat(listOf(notLab, second, unknown, malformed).map { it.isError }).containsOnly(true)
        assertThat(listOf(notLab, second, unknown, malformed).map { it.json()["status"].asInt() }).containsExactly(422, 409, 404, 422)
        call("delete_url", url(lab))
        call("delete_url", mapOf("token_id" to common))
    }
}
