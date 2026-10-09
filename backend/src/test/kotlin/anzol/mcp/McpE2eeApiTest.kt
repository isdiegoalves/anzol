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

/** O MCP e a E2EE: nenhuma ferramenta devolve a privada nem o texto aberto, nem muda a política; as do laboratório. */
@AiApiTest
@DisplayName("MCP e a decifra de atributo")
class McpE2eeApiTest(
    @LocalServerPort port: Int,
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

    private fun CallToolResult.json(): JsonNode = jsonMapper.readTree((content().single() as TextContent).text())

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

    @Test
    @DisplayName("Dado uma mensagem decifrada, quando get_request e list_requests a devolvem, então trazem decryption e não decrypted")
    fun e2ee_mensagemDecifrada_naoDeveSairNoMcp() {
        val signer = anzol.e2ee.ecKey("remetente-sig-1")
        val e2ee = jsonMapper.writeValueAsString(anzol.e2ee.policy(signer))
        val tokenId = api.tokenId("""{"read_secret":"segredo-do-e2ee","e2ee":$e2ee}""")
        val secret = mapOf(anzol.privacy.SECRET_HEADER to "segredo-do-e2ee")
        val key = api.json(api.send("POST", "/token/$tokenId/keys", """{"kid":"enc-v1"}""".toByteArray(), JSON_BODY + secret))
        val id =
            java.util.UUID
                .randomUUID()
                .toString()
        val sealed =
            anzol.e2ee.encrypt(
                com.nimbusds.jose.jwk.ECKey
                    .parse(key["jwk"].toString()),
                anzol.e2ee.sign(signer, anzol.e2ee.claims(id, mapOf("segredo" to "aberto"))),
            )
        val requestId =
            api
                .send("POST", "/$tokenId", anzol.e2ee.envelope(id, sealed).toByteArray(), mapOf("Content-Type" to "application/json"))
                .headers()
                .firstValue("X-Request-Id")
                .orElseThrow()
        val access = mapOf("token_id" to tokenId, "read_secret" to "segredo-do-e2ee")

        val one = call("get_request", access + ("request_id" to requestId)).json()
        val page = call("list_requests", access).json()

        assertThat(one["decryption"]["state"].asString()).isEqualTo("valid")
        assertThat(one.has("decrypted")).isFalse()
        assertThat(page["data"][0].has("decrypted")).isFalse()
        assertThat(listOf(one, page).map { it.toString() }).noneMatch { it.contains("aberto") }
    }

    @Test
    @DisplayName("Dado uma URL com e2ee, quando o update_url manda e2ee null ou outro signatário, então a política fica como estava")
    fun e2ee_updateUrl_naoDeveMudarAPolitica() {
        val signer = anzol.e2ee.ecKey("remetente-sig-1")
        val e2ee = jsonMapper.writeValueAsString(anzol.e2ee.policy(signer))
        val tokenId = api.tokenId("""{"read_secret":"segredo-do-e2ee","e2ee":$e2ee}""")
        val saved =
            api.json(
                api.send(
                    "GET",
                    "/token/$tokenId",
                    headers =
                        JSON_CLIENT + mapOf(anzol.privacy.SECRET_HEADER to "segredo-do-e2ee"),
                ),
            )
        val access = mapOf("token_id" to tokenId, "read_secret" to "segredo-do-e2ee")
        val intruder = anzol.e2ee.policy(anzol.e2ee.ecKey("intruso"))

        val off = call("update_url", access + ("e2ee" to null)).json()
        val swapped = call("update_url", access + ("e2ee" to intruder)).json()

        assertThat(off["e2ee"]).isEqualTo(saved["e2ee"])
        assertThat(swapped["e2ee"]).isEqualTo(saved["e2ee"])
    }

    @Test
    @DisplayName(
        "Dado e2ee nos argumentos do create_url e do update_url, quando ignorado, então o resultado avisa em warnings; " +
            "sem e2ee, não há warnings",
    )
    fun e2ee_ignorado_deveAvisarEmWarnings() {
        val signer = anzol.e2ee.ecKey("remetente-sig-1")
        val e2ee = anzol.e2ee.policy(signer)
        val tokenId = api.tokenId("""{"read_secret":"segredo-do-e2ee","e2ee":${jsonMapper.writeValueAsString(e2ee)}}""")
        val access = mapOf("token_id" to tokenId, "read_secret" to "segredo-do-e2ee")

        val created = call("create_url", mapOf("e2ee" to e2ee)).json()
        val off = call("update_url", access + ("e2ee" to null)).json()
        val plain = call("update_url", access + ("default_status" to 202)).json()

        assertThat(created["warnings"].toList().map { it.asString() }).containsExactly(E2EE_IGNORED)
        assertThat(created["e2ee"].isNull).isTrue()
        assertThat(off["warnings"].toList().map { it.asString() }).containsExactly(E2EE_IGNORED)
        assertThat(plain.has("warnings")).isFalse()
    }

    @Test
    @DisplayName(
        "Dado create_e2ee_lab, quando run_e2ee_scenarios roda todos, então os 27 conferem e o resultado não traz texto aberto; " +
            "numa URL comum, erro 422",
    )
    fun lab_criarERodar_deveConferirTudo() {
        val allNull = mapOf("path" to null, "bindings" to null, "audience" to null, "max_age_seconds" to null, "trusted_signers" to null)
        val lab = call("create_e2ee_lab", allNull + ("hmac_header" to "X-Lab-Hmac")).json()
        val access = mapOf("token_id" to lab["token"]["uuid"].asString(), "read_secret" to lab["read_secret"].asString())

        val catalog = call("list_e2ee_scenarios", emptyMap()).json()
        val run = call("run_e2ee_scenarios", access)
        val subset = call("run_e2ee_scenarios", access + ("scenarios" to listOf("P1", "N3"))).json()
        val common = call("run_e2ee_scenarios", mapOf("token_id" to api.tokenId()))
        val text = (run.content().single() as TextContent).text()

        assertThat(lab["hmac_header"].asString()).isEqualTo("X-Lab-Hmac")
        assertThat(catalog.toList()).hasSize(27)
        assertThat(run.json()["matched"].asInt()).isEqualTo(27)
        assertThat(text).doesNotContain("\"decrypted\"", "concluída")
        assertThat(subset["results"].toList().map { it["code"].asString() }).containsExactly("P1", "N3")
        assertThat(common.isError).isTrue()
        assertThat(common.json()["status"].asInt()).isEqualTo(422)
    }
}
