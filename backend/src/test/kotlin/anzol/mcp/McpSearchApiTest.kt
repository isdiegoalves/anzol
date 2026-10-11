package anzol.mcp

import anzol.support.AiApiTest
import anzol.support.ApiClient
import anzol.support.JSON_BODY
import io.modelcontextprotocol.client.McpClient
import io.modelcontextprotocol.client.McpSyncClient
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.TextContent
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.json.JsonMapper
import java.time.Duration

private const val SCHEMA = """{"type":"object","required":["id"],"properties":{"itens":{"items":{"type":"string"}}}}"""
private val WRONG_SIGNATURE = mapOf("X-Hub-Signature-256" to "sha256=" + "0".repeat(64))

@AiApiTest
@DisplayName("MCP: os filtros do search_requests")
class McpSearchApiTest(
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

    private fun found(
        tokenId: String,
        filter: Pair<String, Any>,
    ): List<String> {
        val result = client.callTool(CallToolRequest("search_requests", mapOf("token_id" to tokenId, filter)))
        val page = jsonMapper.readTree((result.content().single() as TextContent).text())
        return page["data"].toList().map { it["uuid"].asString() }
    }

    private fun capture(
        tokenId: String,
        method: String,
        body: String,
        headers: Map<String, String> = WRONG_SIGNATURE,
    ): String {
        val sent = headers + ("Content-Type" to "application/json")
        return api.capture(tokenId, method, body = body.toByteArray(), headers = sent)["uuid"].asString()
    }

    @Test
    @DisplayName("Dado o search_requests, quando o cliente lista as ferramentas, então o schema declara cada filtro que a busca aceita")
    fun searchRequests_deveDeclararCadaFiltroDaBusca() {
        val schema =
            client
                .listTools()
                .tools()
                .single { it.name() == "search_requests" }
                .inputSchema()
        val properties = schema["properties"] as Map<*, *>

        assertThat(properties.keys).containsExactlyInAnyOrder(
            "token_id",
            "read_secret",
            "text",
            "match",
            "outcome",
            "answered",
            "signature_reason",
            "decryption_reason",
            "schema_path",
            "sorting",
            "page",
            "per_page",
        )
        assertThat(listOf("outcome", "answered", "signature_reason", "schema_path")).allSatisfy { filter ->
            assertThat((properties[filter] as Map<*, *>)["description"] as String).describedAs(filter).isNotBlank()
        }
    }

    @Test
    @DisplayName(
        "Dado mensagens com status, desfecho, assinatura e schema diferentes, quando search_requests filtra por answered, outcome, " +
            "signature_reason e schema_path, então cada filtro acha só a sua",
    )
    fun searchRequests_cadaFiltro_deveAcharSoASua() {
        val tokenId = api.tokenId("""{"signature":{"provider":"github","secret":"segredo-da-busca"},"schema":$SCHEMA}""")
        val rules =
            """[{"name":"fora","match":{"method":["PUT"]},"response":{"status":503}},{"name":"apaga","match":{"method":["DELETE"]}}]"""
        val apaga = api.json(api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY))[1]["id"].asString()
        val semAssinatura = capture(tokenId, "POST", """{"id":1}""", headers = emptyMap())
        val foraDoSchema = capture(tokenId, "POST", """{"id":2,"itens":[1]}""")
        val respondida503 = capture(tokenId, "PUT", """{"id":3}""")
        val pelaRegraApaga = capture(tokenId, "DELETE", """{"id":4}""")

        assertThat(found(tokenId, "answered" to listOf("5xx"))).containsExactly(respondida503)
        assertThat(found(tokenId, "outcome" to mapOf("type" to "rule", "rule" to apaga))).containsExactly(pelaRegraApaga)
        assertThat(found(tokenId, "signature_reason" to "header X-Hub-Signature-256 absent")).containsExactly(semAssinatura)
        assertThat(found(tokenId, "schema_path" to "/itens/0")).containsExactly(foraDoSchema)
    }
}
