package site.webhook.signature

import io.modelcontextprotocol.client.McpClient
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.TextContent
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.AiApiTest
import site.webhook.support.ApiClient
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.json.JsonMapper
import java.time.Duration

private const val SECRET = "segredo-verdadeiro-9Xk2"
private const val MASKED = "••••9Xk2"
private const val REFUSED =
    "The signature.secret is a masked value, not a secret: send the secret, or leave it out to keep the current one."

/**
 * A API devolve o segredo de assinatura mascarado (`••••` e os 4 últimos). A máscara do segredo atual, reenviada, o
 * mantém; outra máscara (de outra URL, ou editada) era gravada como se fosse o segredo, e a API passava a devolvê-la.
 */
@AiApiTest
@DisplayName("Máscara no lugar do segredo de assinatura")
class MaskedSecretApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun stored(tokenId: String): String =
        api.tree(redis.opsForValue().get("token:$tokenId").orEmpty())["signature"]["secret"].asString()

    private fun put(
        tokenId: String,
        secret: String,
    ) = api.send("PUT", "/token/$tokenId", """{"signature":{"provider":"github","secret":"$secret"}}""".toByteArray(), JSON_BODY)

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado uma máscara que não é a do segredo atual, quando edita a URL, então 422 em signature.secret e o segredo fica")
    @ValueSource(strings = ["••••abcd", "••••", "••••9Xk2x", "••••••••9Xk2"])
    fun put_mascaraDeOutroSegredo_deveResponder422(secret: String) {
        val tokenId = api.tokenId("""{"signature":{"provider":"github","secret":"$SECRET"}}""")

        val response = put(tokenId, secret)

        assertThat(response.statusCode()).`as`(response.body()).isEqualTo(422)
        assertThat(api.json(response)).isEqualTo(api.tree("""{"signature.secret":["$REFUSED"]}"""))
        assertThat(stored(tokenId)).isEqualTo(SECRET)
    }

    @Test
    @DisplayName("Dado a máscara do segredo atual, ou nenhum segredo, quando edita a URL, então o segredo atual fica")
    fun put_mascaraDoAtual_deveManterOSegredo() {
        val tokenId = api.tokenId("""{"signature":{"provider":"github","secret":"$SECRET"}}""")

        val masked = put(tokenId, MASKED)
        val omitted = api.send("PUT", "/token/$tokenId", """{"signature":{"provider":"shopify"}}""".toByteArray(), JSON_BODY)

        assertThat(listOf(masked, omitted).map { it.statusCode() }).containsOnly(200)
        assertThat(api.json(omitted)["signature"]["secret"].asString()).isEqualTo(MASKED)
        assertThat(stored(tokenId)).isEqualTo(SECRET)
    }

    @Test
    @DisplayName("Dado uma máscara, quando cria a URL ou põe assinatura numa URL sem ela, então 422: não há segredo atual a manter")
    fun semSegredoAtual_mascara_deveResponder422() {
        val tokenId = api.tokenId()

        val created = api.send("POST", "/token", """{"signature":{"provider":"github","secret":"$MASKED"}}""".toByteArray(), JSON_BODY)
        val updated = put(tokenId, MASKED)

        assertThat(listOf(created, updated).map { it.statusCode() }).containsOnly(422)
        assertThat(api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))["signature"].isNull).isTrue()
    }

    @Test
    @DisplayName("Dado uma máscara de outro segredo, quando o update_url do MCP a manda, então erro de ferramenta e o segredo fica")
    fun updateUrl_mascaraDeOutroSegredo_deveSerErro() {
        val tokenId = api.tokenId("""{"signature":{"provider":"github","secret":"$SECRET"}}""")
        val client =
            McpClient
                .sync(HttpClientStreamableHttpTransport.builder("http://localhost:$port").endpoint("/mcp").build())
                .requestTimeout(Duration.ofSeconds(60))
                .build()
                .also { it.initialize() }

        val result =
            try {
                val block = mapOf("provider" to "github", "secret" to "••••abcd")
                client.callTool(CallToolRequest("update_url", mapOf("token_id" to tokenId, "signature" to block)))
            } finally {
                client.closeGracefully()
            }

        assertThat(result.isError).isTrue()
        assertThat((result.content().single() as TextContent).text()).contains(REFUSED)
        assertThat(stored(tokenId)).isEqualTo(SECRET)
    }
}
