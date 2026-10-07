package anzol.mcp

import anzol.support.AiApiTest
import anzol.support.ApiClient
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import anzol.support.RawResponse
import anzol.support.rawHttp
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
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.concurrent.CompletableFuture

private const val SECRET = "segredo-do-mcp-Wn4t"
private const val READ_SECRET = "leitura-do-mcp-8Hj"
private const val CONCURRENT_PAIRS = 50

/** As 14 ferramentas da §1 do plano "ia-local" e o `diff_rules` (E-07 da UX de Regras). */
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
        "diff_rules",
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
    private val redis: StringRedisTemplate,
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

    /** O segredo de assinatura como está gravado no Redis (a API só o mostra mascarado). */
    private fun redisSecretOf(tokenId: String): String =
        api.tree(redis.opsForValue().get("token:$tokenId").orEmpty())["signature"]["secret"].asString()

    private fun CallToolResult.json(): JsonNode = jsonMapper.readTree((content().single() as TextContent).text())

    @Test
    @DisplayName("Dado o servidor ligado, quando o cliente se conecta, então o servidor se apresenta como anzol")
    fun initialize_deveApresentarOAnzol() {
        assertThat(client.serverInfo.name()).isEqualTo("anzol")
        assertThat(client.serverInstructions).startsWith("Operates Anzol:")
    }

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
    @DisplayName(
        "Dado regras salvas, quando o diff_rules recebe uma proposta, então compara por id depois dos padrões e não grava nada",
    )
    fun diffRules_proposta_deveCompararPorIdSemGravar() {
        val tokenId = api.tokenId()
        val salvas =
            api.json(
                api.send(
                    "PUT",
                    "/token/$tokenId/rules",
                    """[{"name":"igual"},{"name":"muda","match":{"path":{"equals":"/a"}}},{"name":"sai"}]""".toByteArray(),
                    JSON_BODY,
                ),
            )
        val (igual, muda, sai) = salvas.toList().map { it["id"].asString() }
        val novoId = "11111111-2222-4333-8444-555555555555"
        val proposta =
            listOf(
                mapOf("id" to igual, "name" to "igual"),
                mapOf("id" to muda, "name" to "mudou", "enabled" to false, "match" to mapOf("path" to mapOf("equals" to "/b"))),
                mapOf("name" to "nova"),
                mapOf("id" to novoId, "name" to "com id"),
            )

        val diff = call("diff_rules", mapOf("token_id" to tokenId, "rules" to proposta)).json()

        assertThat(diff).isEqualTo(
            api.tree(
                """{"equal":["$igual"],"changed":[{"id":"$muda","name":"mudou","fields":["name","enabled","match.path.equals"]}],""" +
                    """"removed":[{"id":"$sai","name":"sai"}],"added":[{"name":"nova"},{"id":"$novoId","name":"com id"}]}""",
            ),
        )
        assertThat(api.json(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT))).isEqualTo(salvas)
    }

    @Test
    @DisplayName(
        "Dado uma URL com assinatura, schema e timeout, quando o update_url manda um campo só, então os outros ficam; null " +
            "explícito desliga; valor inválido não muda nada",
    )
    fun updateUrl_umCampo_devePreservarOResto() {
        val tokenId =
            api.tokenId(
                """{"default_status":201,"default_content":"oi","timeout":1,"retry_after":7,"auto_cleanup":1000,""" +
                    """"signature":{"provider":"github","secret":"segredo-do-update"},"schema":{"type":"object"}}""",
            )

        val updated = call("update_url", mapOf("token_id" to tokenId, "default_status" to 418)).json()
        val invalid = call("update_url", mapOf("token_id" to tokenId, "timeout" to 11, "default_content" to "x"))
        val afterInvalid = api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))
        call("update_url", mapOf("token_id" to tokenId, "schema" to null, "timeout" to null))
        val afterNull = api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))

        assertThat(updated["default_status"].asInt()).isEqualTo(418)
        assertThat(updated.toString()).doesNotContain("segredo-do-update")
        assertThat(invalid.isError).isTrue()
        assertThat(afterInvalid["default_status"].asInt()).isEqualTo(418)
        assertThat(afterInvalid["default_content"].asString()).isEqualTo("oi")
        assertThat(afterInvalid["timeout"].asInt()).isEqualTo(1)
        assertThat(afterInvalid["retry_after"].asInt()).isEqualTo(7)
        assertThat(afterInvalid["auto_cleanup"].asInt()).isEqualTo(1000)
        assertThat(afterInvalid["signature"]["provider"].asString()).isEqualTo("github")
        assertThat(afterInvalid["schema"]).isEqualTo(api.tree("""{"type":"object"}"""))
        assertThat(afterNull["schema"].isNull).isTrue()
        assertThat(afterNull["timeout"].asInt()).isZero()
        assertThat(afterNull["signature"]["provider"].asString()).isEqualTo("github")
        assertThat(redisSecretOf(tokenId)).isEqualTo("segredo-do-update")
    }

    @Test
    @DisplayName(
        "Dado dois agentes mudando campos diferentes da mesma URL ao mesmo tempo, quando os dois update_url respondem sucesso, " +
            "então as duas mudanças ficam, em 50 pares",
    )
    fun updateUrl_simultaneos_naoDevemPerderMudanca() {
        val other =
            McpClient
                .sync(HttpClientStreamableHttpTransport.builder("http://localhost:$port").endpoint("/mcp").build())
                .requestTimeout(Duration.ofSeconds(60))
                .build()
                .also { it.initialize() }
        val lost =
            try {
                (1..CONCURRENT_PAIRS).count {
                    val tokenId = api.tokenId()
                    val status = CompletableFuture.supplyAsync { call("update_url", mapOf("token_id" to tokenId, "default_status" to 418)) }
                    val signature =
                        CompletableFuture.supplyAsync {
                            val block = mapOf("provider" to "github", "secret" to "segredo-da-corrida")
                            other.callTool(CallToolRequest("update_url", mapOf("token_id" to tokenId, "signature" to block)))
                        }
                    assertThat(listOf(status.join(), signature.join()).map { result -> result.isError }).doesNotContain(true)
                    val token = api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))
                    token["default_status"].asInt() != 418 || token["signature"].isNull
                }
            } finally {
                other.closeGracefully()
            }

        assertThat(lost).isZero()
    }

    @Test
    @DisplayName(
        "Dado um cors/toggle e um update_url simultâneos na mesma URL, quando os dois respondem sucesso, então as duas " +
            "mudanças ficam, em 50 pares",
    )
    fun corsToggle_simultaneoAoUpdateUrl_naoDevePerderMudanca() {
        val lost =
            (1..CONCURRENT_PAIRS).count {
                val tokenId = api.tokenId()
                val toggle = CompletableFuture.supplyAsync { api.send("PUT", "/token/$tokenId/cors/toggle", headers = JSON_CLIENT) }
                val update = CompletableFuture.supplyAsync { call("update_url", mapOf("token_id" to tokenId, "default_status" to 418)) }
                assertThat(toggle.join().statusCode()).isEqualTo(200)
                assertThat(update.join().isError).isNotEqualTo(true)
                val token = api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))
                !token["cors"].asBoolean() || token["default_status"].asInt() != 418
            }

        assertThat(lost).isZero()
    }

    @Test
    @DisplayName(
        "Dado um PUT (sem o segredo no bloco) e um update_url que troca o segredo, simultâneos, quando os dois respondem " +
            "sucesso, então fica o PUT inteiro com o segredo novo, e a senha de leitura e o cors ficam, em 50 pares",
    )
    fun put_simultaneoAoUpdateUrl_deveFicarCoerente() {
        val access = mapOf("X-Anzol-Secret" to READ_SECRET)
        val incoherent =
            (1..CONCURRENT_PAIRS).mapNotNull {
                val tokenId =
                    api.tokenId(
                        """{"default_status":418,"timeout":1,"read_secret":"$READ_SECRET",""" +
                            """"signature":{"provider":"github","secret":"segredo-antigo"}}""",
                    )
                api.send("PUT", "/token/$tokenId/cors/toggle", headers = JSON_CLIENT + access)
                val body = """{"default_status":201,"signature":{"provider":"github"}}"""
                val put = CompletableFuture.supplyAsync { api.send("PUT", "/token/$tokenId", body.toByteArray(), JSON_BODY + access) }
                val update =
                    CompletableFuture.supplyAsync {
                        val block = mapOf("provider" to "github", "secret" to "segredo-novo")
                        call("update_url", mapOf("token_id" to tokenId, "read_secret" to READ_SECRET, "signature" to block))
                    }
                assertThat(put.join().statusCode()).isEqualTo(200)
                assertThat(update.join().isError).isNotEqualTo(true)
                val stored = api.tree(redis.opsForValue().get("token:$tokenId").orEmpty())
                val coherent =
                    stored["default_status"].asInt() == 201 &&
                        stored["timeout"].asInt() == 0 &&
                        stored["signature"]["secret"].asString() == "segredo-novo" &&
                        stored["cors"].asBoolean() &&
                        !stored["read_secret_hash"].isNull
                stored.toString().takeUnless { coherent }
            }

        assertThat(incoherent).isEmpty()
    }

    @Test
    @DisplayName(
        "Dado signature ou schema como texto (vazio ou não) no update_url, quando chama, então erro na chave do campo e nada " +
            "muda: só null desliga",
    )
    fun updateUrl_textoNoLugarDoBloco_naoDeveDesligar() {
        val tokenId =
            api.tokenId("""{"timeout":1,"signature":{"provider":"github","secret":"segredo-do-update"},"schema":{"type":"object"}}""")
        val before = api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))

        val results =
            listOf("signature" to "", "schema" to "", "signature" to "  ", "schema" to "x").map { (field, text) ->
                field to call("update_url", mapOf("token_id" to tokenId, field to text, "timeout" to 2))
            }

        assertThat(results.map { (_, result) -> result.isError }).containsOnly(true)
        assertThat(results.map { (field, result) -> result.json()["errors"].has(field) }).containsOnly(true)
        assertThat(api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))).isEqualTo(before)
    }

    @Test
    @DisplayName("Dado null nos campos do create_url, quando cria a URL, então vale como ausente: cria com os padrões")
    fun createUrl_comNull_deveCriarComOsPadroes() {
        val settings = listOf("default_status", "default_content", "default_content_type", "timeout", "retry_after", "auto_cleanup")
        val arguments = (settings + listOf("signature", "schema", "read_secret")).associateWith { null }

        val created = call("create_url", arguments)

        assertThat(created.isError).`as`(created.content().toString()).isNotEqualTo(true)
        val token = created.json()
        assertThat(token["default_status"].asInt()).isEqualTo(200)
        assertThat(token["default_content"].asString()).isEmpty()
        assertThat(token["default_content_type"].asString()).isEqualTo("text/plain")
        assertThat(token["timeout"].asInt()).isZero()
        assertThat(token["signature"].isNull).isTrue()
        assertThat(token["protected"].asBoolean()).isFalse()
    }

    @Test
    @DisplayName(
        "Dado null em cada argumento opcional, quando chama as outras ferramentas, então vale como ausente (também dentro de " +
            "um objeto): nenhuma fica mais restrita",
    )
    fun ferramentas_opcionalNull_deveValerComoAusente() {
        val tokenId = api.tokenId()
        val requestId = api.capture(tokenId, "POST", "/pedidos", "corpo".toByteArray())["uuid"].asString()
        val id = mapOf("token_id" to tokenId, "read_secret" to null)
        val rule =
            mapOf("name" to "r", "priority" to null, "match" to mapOf("path" to null, "method" to listOf("POST")), "scenario" to null)
        val calls =
            mapOf(
                "get_url" to id,
                "list_requests" to id + mapOf("page" to null, "per_page" to null, "sorting" to null, "after" to null),
                "search_requests" to
                    id + mapOf("text" to null, "match" to null, "sorting" to null, "page" to null, "per_page" to null, "outcome" to null),
                "get_request" to id + mapOf("request_id" to requestId),
                "wait_for_request" to id + mapOf("match" to mapOf("path" to null), "after" to null, "count" to null, "timeout" to 0),
                "get_rules" to id,
                "test_rule" to id + mapOf("rule" to rule),
                "diff_rules" to id + mapOf("rules" to listOf(rule)),
                "set_rules" to id + mapOf("rules" to listOf(rule)),
                "replay_request" to
                    id +
                    mapOf(
                        "request_id" to requestId,
                        "url" to "http://localhost:$port/$tokenId",
                        "keep_path" to null,
                        "timeout" to null,
                        "chaos" to null,
                    ),
                "send_request" to
                    id +
                    mapOf(
                        "url" to "http://localhost:$port/$tokenId",
                        "method" to null,
                        "headers" to null,
                        "body" to null,
                        "sign" to null,
                        "timeout" to null,
                    ),
                "get_outbound" to id,
                "update_url" to id + mapOf("signature" to mapOf("provider" to "github", "secret" to "segredo-gh", "prefix" to null)),
                "delete_url" to id,
            )

        val errors = calls.mapValues { (tool, arguments) -> call(tool, arguments) }.filterValues { it.isError == true }

        assertThat(calls.keys + "create_url").containsExactlyInAnyOrderElementsOf(TOOLS)
        assertThat(errors.mapValues { (it.value.content().single() as TextContent).text() }).isEmpty()
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
    @DisplayName(
        "Dado o replay_request, quando lista e chama com chaos, então o schema declara os cinco campos, o destino recusado não " +
            "injeta nada e a validação vira erro de ferramenta",
    )
    fun replayRequest_comChaos() {
        val tool = client.listTools().tools().single { it.name() == "replay_request" }
        val tokenId = api.tokenId()
        val requestId = api.capture(tokenId, "POST", "/pedidos", "corpo".toByteArray())["uuid"].asString()
        val arguments = mapOf("token_id" to tokenId, "request_id" to requestId, "url" to "http://localhost:$port/$tokenId")

        val refused = call("replay_request", arguments + mapOf("chaos" to mapOf("delay_ms" to 3_000, "duplicate" to true)))
        val invalid = call("replay_request", arguments + mapOf("chaos" to mapOf("delay_ms" to -1)))

        @Suppress("UNCHECKED_CAST")
        val chaos = (tool.inputSchema()["properties"] as Map<String, Map<String, Any>>).getValue("chaos")
        assertThat(chaos["type"]).isEqualTo("object")
        @Suppress("UNCHECKED_CAST")
        val fields = (chaos["properties"] as Map<String, Map<String, Any>>).mapValues { it.value["type"] }
        assertThat(fields).isEqualTo(
            mapOf(
                "delay_ms" to "integer",
                "duplicate" to "boolean",
                "abort_mid_body" to "boolean",
                "slow_body_bps" to "integer",
                "timeout_ms" to "integer",
            ),
        )
        assertThat(refused.isError).isNotEqualTo(true)
        assertThat(refused.json()["error"]["kind"].asString()).isEqualTo("blocked")
        assertThat(refused.json()["chaos"]["injected"].size()).isZero()
        assertThat(refused.json()["chaos"]["delay_ms"].asInt()).isEqualTo(3_000)
        assertThat(invalid.isError).isTrue()
        assertThat(invalid.json()["errors"]["chaos.delay_ms"][0].asString()).isEqualTo("The delay ms must be between 0 and 30000.")
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
    @DisplayName(
        "Dado 10 read_secret errados, quando vem o 11º, então erro de ferramenta 429 que cita protected; o cabeçalho certo " +
            "na API continua abrindo (o MCP conta à parte)",
    )
    fun readSecret_limiteDeFalhas() {
        val tokenId = call("create_url", mapOf("read_secret" to READ_SECRET)).json()["uuid"].asString()

        repeat(10) { call("get_url", mapOf("token_id" to tokenId, "read_secret" to "errado-$it-errado")) }
        val limited = call("get_url", mapOf("token_id" to tokenId, "read_secret" to READ_SECRET))
        val header = api.send("GET", "/token/$tokenId", headers = JSON_CLIENT + ("X-Anzol-Secret" to READ_SECRET))

        assertThat(limited.isError).isTrue()
        assertThat(limited.json()["status"].asInt()).isEqualTo(429)
        assertThat(limited.json()["error"].asString()).contains("protected")
        assertThat(header.statusCode()).isEqualTo(200)
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
    @DisplayName(
        "Dado um Origin de loopback na porta do servidor, quando chama /mcp, então passa; em outra porta (outro app local), " +
            "403 origin not allowed",
    )
    fun origin_loopback_soNaPortaDoServidor() {
        val samePort = initialize(host = "localhost:$port", origin = "http://127.0.0.1:$port")
        val otherPort = initialize(host = "localhost:$port", origin = "http://localhost:4200")

        assertThat(samePort.status).isEqualTo(200)
        assertThat(samePort.body).contains("\"serverInfo\"")
        assertThat(otherPort.status).isEqualTo(403)
        assertThat(otherPort.body).isEqualTo("""{"error":"origin not allowed"}""")
    }

    @Test
    @DisplayName("Dado um cliente sem Origin com Host 127.0.0.1:8084, quando chama /mcp, então passa")
    fun semOrigin_hostPermitido_devePassar() {
        val response = initialize(host = "127.0.0.1:8084")

        assertThat(response.status).isEqualTo(200)
        assertThat(response.body).contains("\"serverInfo\"")
    }

    @Test
    @DisplayName(
        "Dado chance, janela e as falhas novas, quando o agente usa set_rules e get_rules, então passam pelo leitor da API; " +
            "a descrição de set_rules cita cada um",
    )
    fun setRules_chanceJanelaEFalhasNovas_deveAceitarECitar() {
        val tokenId = api.tokenId()
        val rules =
            listOf(
                mapOf(
                    "name" to "instável",
                    "chance" to 25,
                    "active_from" to "2026-09-29T09:00:00-03:00",
                    "response" to mapOf("status" to 503),
                ),
                mapOf("name" to "corta", "response" to mapOf("body" to "abcd", "fault" to "truncated_body")),
            )
        val semCorpo = listOf(mapOf("name" to "x", "response" to mapOf("fault" to "stall_after_headers")))

        val saved = call("set_rules", mapOf("token_id" to tokenId, "rules" to rules)).json()
        val invalid = call("set_rules", mapOf("token_id" to tokenId, "rules" to semCorpo))
        val description =
            client
                .listTools()
                .tools()
                .single { it.name() == "set_rules" }
                .description()

        assertThat(saved[0]["chance"].asInt()).isEqualTo(25)
        assertThat(saved[0]["active_from"].asString()).isEqualTo("2026-09-29T12:00:00Z")
        assertThat(saved[1]["response"]["fault"].asString()).isEqualTo("truncated_body")
        assertThat(call("get_rules", mapOf("token_id" to tokenId)).json()).isEqualTo(saved)
        assertThat(invalid.isError).isTrue()
        assertThat((invalid.content().single() as TextContent).text())
            .contains("The body field is required when fault is stall_after_headers.")
        assertThat(description).contains("chance", "active_from", "active_until", "hang", "stall_after_headers", "truncated_body")
    }

    @Test
    @DisplayName(
        "Dado uma URL com e2ee e chave de cifra, quando get_url e update_url a devolvem, então nenhuma traz a privada (d) " +
            "e o update_url mantém a política e as chaves",
    )
    fun e2ee_getEUpdateUrl_naoDevemDevolverAPrivada() {
        val signer = anzol.e2ee.ecKey("remetente-sig-1")
        val e2ee = jsonMapper.writeValueAsString(anzol.e2ee.policy(signer))
        val tokenId = api.tokenId("""{"read_secret":"segredo-do-e2ee","e2ee":$e2ee}""")
        val secret = mapOf(anzol.privacy.SECRET_HEADER to "segredo-do-e2ee")
        api.send("POST", "/token/$tokenId/keys", """{"kid":"enc-v1"}""".toByteArray(), JSON_BODY + secret)

        val read = call("get_url", mapOf("token_id" to tokenId, "read_secret" to "segredo-do-e2ee")).json()
        val updated = call("update_url", mapOf("token_id" to tokenId, "read_secret" to "segredo-do-e2ee", "default_status" to 202)).json()

        assertThat(listOf(read, updated).map { it.toString() }).noneMatch { it.contains("\"d\":") }
        assertThat(updated["e2ee"]).isEqualTo(read["e2ee"])
        assertThat(updated["e2ee_keys"].toList().map { it["kid"].asString() }).containsExactly("enc-v1")
        assertThat(api.tree(redis.opsForValue().get("token:$tokenId").orEmpty())["e2ee_keys"][0]["jwk"].has("d")).isTrue()
    }
}
