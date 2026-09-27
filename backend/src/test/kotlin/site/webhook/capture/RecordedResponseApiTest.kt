package site.webhook.capture

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import site.webhook.support.SseClient
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.io.IOException
import java.time.Duration
import java.util.UUID

@ApiTest
@DisplayName("Resposta gravada na mensagem (response)")
class RecordedResponseApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun tokenWithRules(
        rules: String,
        fields: String = "{}",
    ): String {
        val tokenId = api.tokenId(fields)
        val saved = api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY)
        check(saved.statusCode() == 200) { saved.body() }
        return tokenId
    }

    private fun messages(tokenId: String): JsonNode = api.json(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT))["data"]

    @Test
    @DisplayName("Dado uma regra que responde 201, quando o webhook chega, então a mensagem grava response com o status da regra")
    fun capture_regraResponde_deveGravarStatusDaRegra() {
        val tokenId = tokenWithRules("""[{"name":"criado","response":{"status":201,"body":"{{seq}}","template":true}}]""")

        val response = api.send("POST", "/$tokenId/404", "x".toByteArray())
        val message = api.capture(tokenId)

        assertThat(response.statusCode()).isEqualTo(201)
        assertThat(message["response"]).isEqualTo(api.tree("""{"status":201}"""))
    }

    @Test
    @DisplayName("Dado uma regra com fault, quando o webhook chega, então a mensagem grava response com a falha e sem status")
    fun capture_regraComFault_deveGravarAFalha() {
        val tokenId = tokenWithRules("""[{"name":"cai","response":{"status":201,"fault":"empty_response"}}]""")

        assertThatThrownBy { api.send("GET", "/$tokenId") }.isInstanceOf(IOException::class.java)

        assertThat(messages(tokenId)[0]["response"]).isEqualTo(api.tree("""{"fault":"empty_response"}"""))
    }

    @Test
    @DisplayName("Dado nenhuma regra que case, quando o webhook chega, então grava o status padrão da URL ou o do caminho")
    fun capture_respostaPadrao_deveGravarOStatusDado() {
        val tokenId = tokenWithRules("""[{"name":"só POST","match":{"method":["POST"]}}]""", """{"default_status":418}""")

        val padrao = api.send("GET", "/$tokenId")
        val peloCaminho = api.send("GET", "/$tokenId/404")

        assertThat(padrao.statusCode()).isEqualTo(418)
        assertThat(peloCaminho.statusCode()).isEqualTo(404)
        val gravadas = messages(tokenId).toList().map { it["response"] }
        assertThat(gravadas).containsExactlyInAnyOrder(api.tree("""{"status":418}"""), api.tree("""{"status":404}"""))
    }

    @Test
    @DisplayName(
        "Dado uma regra 201 cujo template estoura o teto com o corpo recebido, quando o webhook chega, então o cliente recebe 500 " +
            "e a mensagem grava o 500 realmente respondido",
    )
    fun capture_templateEstouraAoResponder_deveGravar500() {
        val tokenId =
            tokenWithRules(
                """[{"name":"eco dobrado","response":{"status":201,"body":"{{request.body}}{{request.body}}","template":true}}]""",
            )

        val response = api.send("POST", "/$tokenId", "x".repeat(600 * 1024).toByteArray(), mapOf("Content-Type" to "text/plain"))

        assertThat(response.statusCode()).isEqualTo(500)
        assertThat(messages(tokenId)[0]["response"]).isEqualTo(api.tree("""{"status":500}"""))
    }

    @Test
    @DisplayName("Dado uma URL com 429 e Retry-After, quando o webhook chega, então grava o 429")
    fun capture_retryAfter_deveGravar429() {
        val tokenId = api.tokenId("""{"default_status":429,"retry_after":30}""")

        val response = api.send("GET", "/$tokenId")

        assertThat(response.statusCode()).isEqualTo(429)
        assertThat(messages(tokenId)[0]["response"]).isEqualTo(api.tree("""{"status":429}"""))
    }

    @Test
    @DisplayName("Dado uma mensagem nova, quando lê pela busca e pelo evento request.created, então response vem igual ao GET")
    fun leitura_buscaEEvento_devemTrazerResponse() {
        val tokenId = api.tokenId("""{"default_status":202}""")
        SseClient("${api.base}/token/$tokenId/stream").use { client ->
            val message = api.capture(tokenId)

            await().atMost(Duration.ofSeconds(5)).until { client.events.isNotEmpty() }
            val search = api.json(api.send("POST", "/token/$tokenId/requests/search", "{}".toByteArray(), JSON_BODY))
            assertThat(message["response"]).isEqualTo(api.tree("""{"status":202}"""))
            assertThat(api.tree(client.events.first().data)["request"]["response"]).isEqualTo(message["response"])
            assertThat(search["data"][0]["response"]).isEqualTo(message["response"])
        }
    }

    @Test
    @DisplayName("Dado uma mensagem gravada antes de response (sem a chave), quando lê a mensagem e a lista, então response é null")
    fun leitura_mensagemAntiga_deveLerResponseNull() {
        val tokenId = api.tokenId()
        val id = UUID.randomUUID().toString()
        val json =
            """{"uuid":"$id","token_id":"$tokenId","ip":"10.0.0.1","hostname":"localhost","method":"GET","user_agent":null,""" +
                """"content":"","query":[],"headers":{},"url":"http://localhost/$tokenId","created_at":"2026-09-26 14:02:07",""" +
                """"updated_at":"2026-09-26 14:02:07","request":null,"rule":null,"near_miss":null,"signature":null,"schema":null}"""
        redis.opsForHash<String, String>().put("token:$tokenId:requests", id, json)
        redis.opsForZSet().add("token:$tokenId:requests:index", id, 1.0)

        val message = api.send("GET", "/token/$tokenId/request/$id", headers = JSON_CLIENT)

        assertThat(message.statusCode()).`as`(message.body()).isEqualTo(200)
        assertThat(api.json(message)["response"].isNull).isTrue()
        assertThat(messages(tokenId)[0]["response"].isNull).isTrue()
    }
}
