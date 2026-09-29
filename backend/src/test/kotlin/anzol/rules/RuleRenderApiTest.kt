package anzol.rules

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.json.JsonMapper

private const val ECO =
    """{"name":"eco","match":{"method":["POST"]},"response":{"status":201,"headers":{"X-Id":"{{jsonPath request.body '$.id'}}"},""" +
        """"body":"{{request.method}} {{jsonPath request.body '$.id'}}","template":true}}"""

@ApiTest
@DisplayName("POST /token/{id}/rules/test?render=N")
class RuleRenderApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun test(
        tokenId: String,
        query: String,
        rule: String = ECO,
    ) = api.send("POST", "/token/$tokenId/rules/test$query", rule.toByteArray(), JSON_BODY)

    private fun tokenWithMessages(): Pair<String, List<String>> {
        val tokenId = api.tokenId()
        val ids = (1..3).map { api.capture(tokenId, "POST", body = """{"id":$it}""".toByteArray())["uuid"].asString() }
        api.capture(tokenId)
        return tokenId to ids
    }

    @Test
    @DisplayName("Dado render=2, quando testa, então rendered traz as 2 mais novas de matches, renderizadas, e matches não muda")
    fun test_render2_deveRenderizarAsDuasMaisNovas() {
        val (tokenId, ids) = tokenWithMessages()

        val result = api.json(test(tokenId, "?render=2"))

        assertThat(result["matches"].size()).isEqualTo(3)
        assertThat(result["rendered"]).isEqualTo(
            api.tree(
                """[{"uuid":"${ids[2]}","status":201,"headers":{"X-Id":"3"},"body":"POST 3"},""" +
                    """{"uuid":"${ids[1]}","status":201,"headers":{"X-Id":"2"},"body":"POST 2"}]""",
            ),
        )
    }

    @Test
    @DisplayName("Dado nenhum render, quando testa, então a resposta é a de sempre, sem a chave rendered")
    fun test_semRender_naoDeveTrazerRendered() {
        val (tokenId) = tokenWithMessages()

        val result = api.json(test(tokenId, ""))

        assertThat(result.propertyNames().toList()).containsExactly("matches", "misses")
    }

    @ParameterizedTest(name = "render={0}")
    @DisplayName("Dado render fora de 1..3 ou não inteiro, quando testa, então 422 na chave render, junto com os erros da regra")
    @ValueSource(strings = ["0", "4", "1.5", "abc", ""])
    fun test_renderInvalido_deveResponder422(value: String) {
        val tokenId = api.tokenId()

        val response = test(tokenId, "?render=$value", """{"name":""}""")

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response)["render"]).isEqualTo(api.tree("""["The render must be an integer between 1 and 3."]"""))
        assertThat(api.json(response).has("name")).isTrue()
    }
}
