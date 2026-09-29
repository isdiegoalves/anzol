package anzol.ai

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.json.JsonMapper

/** A configuração padrão (a dos testes e do CI sem LLM): IA e MCP desligados, sem chave e sem LLM no ar. */
@ApiTest
@DisplayName("IA e MCP desligados (padrão)")
class AiDisabledApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName("Dada a IA desligada, quando chama suggest ou explain, então 503 AI is not configured, e o webhook segue")
    fun rotasDeIa_desligadas_deveResponder503() {
        val tokenId = api.tokenId()
        val requestId = api.capture(tokenId)["uuid"].asString()

        val suggest = api.send("POST", "/token/$tokenId/rules/suggest", """{"prompt": "x"}""".toByteArray(), JSON_BODY)
        val explain = api.send("POST", "/token/$tokenId/request/$requestId/explain", "{}".toByteArray(), JSON_BODY)

        listOf(suggest, explain).forEach { response ->
            assertThat(response.statusCode()).isEqualTo(503)
            assertThat(response.body()).isEqualTo("""{"error":"AI is not configured"}""")
        }
        assertThat(api.send("GET", "/$tokenId").statusCode()).isEqualTo(200)
        assertThat(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT).statusCode()).isEqualTo(200)
    }

    @Test
    @DisplayName("Dado o MCP desligado, quando chama /mcp, então 404 como rota inexistente")
    fun mcp_desligado_deveResponder404() {
        val initialize = """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"""
        val headers = JSON_BODY + ("Accept" to "application/json, text/event-stream")

        assertThat(api.send("POST", "/mcp", initialize.toByteArray(), headers).statusCode()).isEqualTo(404)
        assertThat(api.send("GET", "/mcp", headers = JSON_CLIENT).statusCode()).isEqualTo(404)
    }
}
