package site.webhook.mcp

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
import site.webhook.support.AiApiTest
import site.webhook.support.ApiClient
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.concurrent.CompletableFuture

private const val SECRET = "segredo-do-mcp-Wn4t"

/** As 14 ferramentas da §1 do plano "ia-local". */
private val TOOLS =
    listOf(
        "create_url",
        "get_url",
        "update_url",
        "delete_url",
        "list_requests",
        "search_requests",
        "get_request",
        "wait_for_request",
        "get_rules",
        "set_rules",
        "test_rule",
        "replay_request",
        "send_request",
        "get_outbound",
    )

@AiApiTest
@DisplayName("Servidor MCP em /mcp")
class McpServerApiTest(
    @LocalServerPort port: Int,
    private val jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)
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
        arguments: Map<String, Any?>,
    ): CallToolResult = client.callTool(CallToolRequest(tool, arguments))

    private fun CallToolResult.json(): JsonNode = jsonMapper.readTree((content().single() as TextContent).text())

    @Test
    @DisplayName("Dado o servidor ligado, quando o cliente lista as ferramentas, então vêm as 14, com descrição e schema de objeto")
    fun listTools_deveListarAs14() {
        val tools = client.listTools().tools()

        assertThat(tools.map { it.name() }).containsExactlyInAnyOrderElementsOf(TOOLS)
        assertThat(tools).allSatisfy { tool ->
            assertThat(tool.description()).isNotBlank()
            assertThat(tool.inputSchema()["type"]).isEqualTo("object")
        }
        assertThat(tools.filter { it.name() != "create_url" }).allSatisfy { tool ->
            assertThat(@Suppress("UNCHECKED_CAST") (tool.inputSchema()["properties"] as Map<String, Any>)).containsKey("token_id")
        }
    }

    @Test
    @DisplayName("Dado um agente, quando cria a URL, espera o webhook, põe e testa uma regra e apaga, então tudo passa pela API")
    fun fluxo_criarEsperarRegraTestarApagar() {
        val created = call("create_url", mapOf("default_status" to 201, "default_content" to "oi", "default_content_type" to "text/plain"))
        assertThat(created.isError).isNotEqualTo(true)
        val tokenId = created.json()["uuid"].asString()
        assertThat(api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))["default_status"].asInt()).isEqualTo(201)

        val waiting = CompletableFuture.supplyAsync { call("wait_for_request", mapOf("token_id" to tokenId, "timeout" to 20_000)) }
        Thread.sleep(300)
        api.send("POST", "/$tokenId/pedidos", "primeiro".toByteArray())
        val waited = waiting.join().json()
        assertThat(waited["matched"].asBoolean()).isTrue()
        assertThat(waited["requests"][0]["content"].asString()).isEqualTo("primeiro")

        val rule =
            mapOf(
                "name" to "só pedidos",
                "match" to mapOf("path" to mapOf("equals" to "/pedidos")),
                "response" to mapOf("status" to 418),
            )
        val saved = call("set_rules", mapOf("token_id" to tokenId, "rules" to listOf(rule))).json()
        assertThat(saved[0]["name"].asString()).isEqualTo("só pedidos")
        assertThat(api.send("GET", "/$tokenId/pedidos").statusCode()).isEqualTo(418)
        api.send("GET", "/$tokenId/outro")

        val tested = call("test_rule", mapOf("token_id" to tokenId, "rule" to rule)).json()
        assertThat(tested["matches"].size()).isEqualTo(2)
        assertThat(tested["misses"].size()).isEqualTo(1)

        val listed = call("list_requests", mapOf("token_id" to tokenId, "sorting" to "newest")).json()
        assertThat(listed["total"].asInt()).isEqualTo(3)

        assertThat(call("delete_url", mapOf("token_id" to tokenId)).json()["deleted"].asBoolean()).isTrue()
        assertThat(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT).statusCode()).isEqualTo(410)
    }

    @Test
    @DisplayName("Dados argumentos inválidos, quando chama a ferramenta, então é erro de ferramenta com as mensagens da API")
    fun erroDeValidacao_deveVirarErroDeFerramenta() {
        val tokenId = api.tokenId()

        val timeout = call("create_url", mapOf("timeout" to 11))
        val regex =
            call(
                "set_rules",
                mapOf(
                    "token_id" to tokenId,
                    "rules" to listOf(mapOf("name" to "x", "match" to mapOf("path" to mapOf("regex" to "([")))),
                ),
            )
        val gone = call("get_url", mapOf("token_id" to "00000000-0000-4000-8000-000000000000"))
        val noId = call("get_rules", emptyMap())

        assertThat(timeout.isError).isTrue()
        assertThat(timeout.json()["errors"]["timeout"][0].asString()).isEqualTo("The timeout may not be greater than 10.")
        assertThat(regex.isError).isTrue()
        assertThat(regex.json()["errors"]["0.match.path.regex"][0].asString()).isEqualTo("The regex is invalid.")
        assertThat(api.json(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT)).size()).isZero()
        assertThat(gone.isError).isTrue()
        assertThat(gone.json()["status"].asInt()).isEqualTo(410)
        assertThat(gone.json()["error"].asString()).isEqualTo("Token not found")
        assertThat(noId.json()["errors"]["token_id"][0].asString()).isEqualTo("The token id must be a valid UUID.")
    }

    @Test
    @DisplayName("Dada uma URL com assinatura, quando cria e lê pelo MCP, então o segredo só aparece mascarado")
    fun segredo_deveVoltarMascarado() {
        val created = call("create_url", mapOf("signature" to mapOf("provider" to "github", "secret" to SECRET)))
        val tokenId = created.json()["uuid"].asString()
        val read = call("get_url", mapOf("token_id" to tokenId))

        listOf(created, read).forEach { result ->
            val text = (result.content().single() as TextContent).text()
            assertThat(text).doesNotContain(SECRET).contains("••••" + SECRET.takeLast(4))
        }
    }
}
