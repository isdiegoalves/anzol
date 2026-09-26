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
import site.webhook.support.RawResponse
import site.webhook.support.rawHttp
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.concurrent.CompletableFuture

private const val SECRET = "segredo-do-mcp-Wn4t"
private const val READ_SECRET = "leitura-do-mcp-8Hj"

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
    @LocalServerPort private val port: Int,
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

    @Test
    @DisplayName(
        "Dado uma URL criada com read_secret, quando as ferramentas vêm sem ele, com ele errado e com ele certo, então erro 401 " +
            "legível, 401 e resultado; update_url mantém a proteção",
    )
    fun readSecret_urlProtegida() {
        val created = call("create_url", mapOf("read_secret" to READ_SECRET))
        val tokenId = created.json()["uuid"].asString()
        api.send("POST", "/$tokenId", "pelo-mcp".toByteArray())

        val without =
            listOf("get_url", "list_requests", "get_rules", "get_outbound", "delete_url").map {
                call(
                    it,
                    mapOf("token_id" to tokenId),
                )
            }
        val wrong = call("get_url", mapOf("token_id" to tokenId, "read_secret" to "errado-errado"))
        val right = call("list_requests", mapOf("token_id" to tokenId, "read_secret" to READ_SECRET))
        val updated = call("update_url", mapOf("token_id" to tokenId, "read_secret" to READ_SECRET, "default_status" to 202))

        assertThat(created.json()["protected"].asBoolean()).isTrue()
        assertThat((created.content().single() as TextContent).text()).doesNotContain(READ_SECRET)
        assertThat(without).allSatisfy { result ->
            assertThat(result.isError).isTrue()
            assertThat(result.json()["status"].asInt()).isEqualTo(401)
            assertThat(result.json()["error"].asString()).isEqualTo("This URL is protected; pass its read_secret")
        }
        assertThat(wrong.json()["status"].asInt()).isEqualTo(401)
        assertThat(right.isError).isNotEqualTo(true)
        assertThat(right.json()["data"][0]["content"].asString()).isEqualTo("pelo-mcp")
        assertThat(updated.json()["protected"].asBoolean()).isTrue()
        assertThat(updated.json()["default_status"].asInt()).isEqualTo(202)
        assertThat(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT).statusCode()).isEqualTo(401)
    }

    @Test
    @DisplayName("Dado 10 read_secret errados, quando vem o 11º, então erro de ferramenta 429")
    fun readSecret_limiteDeFalhas() {
        val tokenId = call("create_url", mapOf("read_secret" to READ_SECRET)).json()["uuid"].asString()

        repeat(10) { call("get_url", mapOf("token_id" to tokenId, "read_secret" to "errado-$it-errado")) }
        val limited = call("get_url", mapOf("token_id" to tokenId, "read_secret" to READ_SECRET))

        assertThat(limited.isError).isTrue()
        assertThat(limited.json()["status"].asInt()).isEqualTo(429)
    }

    /** `initialize` do MCP escrito à mão, com o `Host` e o `Origin` que o `HttpClient` do JDK não deixa escolher. */
    private fun initialize(
        host: String,
        origin: String? = null,
    ): RawResponse {
        val body =
            """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18",""" +
                """"capabilities":{},"clientInfo":{"name":"teste","version":"1"}}}"""
        val headers =
            listOfNotNull(
                "Content-Type: application/json",
                "Accept: application/json, text/event-stream",
                "Content-Length: ${body.toByteArray().size}",
                origin?.let { "Origin: $it" },
            )
        return rawHttp(port, "POST /mcp HTTP/1.1", headers, body.toByteArray(), host = host)
    }

    @Test
    @DisplayName("Dado um Origin de fora do loopback, quando chama /mcp, então 403 origin not allowed")
    fun origin_deFora_deveResponder403() {
        val response = initialize(host = "localhost:$port", origin = "https://evil.example")

        assertThat(response.status).isEqualTo(403)
        assertThat(response.body).isEqualTo("""{"error":"origin not allowed"}""")
    }

    @Test
    @DisplayName("Dado um Host fora da lista (DNS rebinding), quando chama /mcp, então 403")
    fun host_deFora_deveResponder403() {
        val response = initialize(host = "evil.example")

        assertThat(response.status).isEqualTo(403)
        assertThat(response.body).isEqualTo("""{"error":"host not allowed"}""")
    }

    @Test
    @DisplayName("Dado um Origin de loopback em outra porta (a tela no ng serve), quando chama /mcp, então passa")
    fun origin_loopback_devePassar() {
        val response = initialize(host = "localhost:$port", origin = "http://localhost:4200")

        assertThat(response.status).isEqualTo(200)
        assertThat(response.body).contains("\"serverInfo\"")
    }

    @Test
    @DisplayName("Dado um cliente sem Origin com Host 127.0.0.1:8084, quando chama /mcp, então passa")
    fun semOrigin_hostPermitido_devePassar() {
        val response = initialize(host = "127.0.0.1:8084")

        assertThat(response.status).isEqualTo(200)
        assertThat(response.body).contains("\"serverInfo\"")
    }
}
