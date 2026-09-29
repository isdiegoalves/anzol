package anzol.rules

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.json.JsonMapper
import java.time.Duration

/** 50 mensagens × 100 ms de teto passariam de 5 s; com a memória da requisição, o padrão roda até estourar uma vez só. */
private val WITHIN: Duration = Duration.ofSeconds(2)
private const val MESSAGES = 50

@ApiTest
@DisplayName("Teto de custo das regex por requisição")
class RegexBudgetApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName(
        "Dado 50 mensagens catastróficas, quando o rules/test avalia um padrão que estoura, então responde em menos de 2 s, com a " +
            "frase de estouro em todas",
    )
    fun test_padraoQueEstoura_devePagarOTetoUmaVez() {
        val tokenId = api.tokenId()
        repeat(MESSAGES) { api.send("GET", "/$tokenId", headers = mapOf("X-A" to "a".repeat(30) + "!")) }
        val rule = """{"name":"h","match":{"headers":{"X-A":{"regex":"((a+)*)+$"}}}}"""

        val started = System.nanoTime()
        val response = api.send("POST", "/token/$tokenId/rules/test", rule.toByteArray(), JSON_BODY)
        val took = Duration.ofNanos(System.nanoTime() - started)

        val misses = api.json(response)["misses"].toList()
        assertThat(took).isLessThan(WITHIN)
        assertThat(misses).hasSize(MESSAGES)
        assertThat(misses.map { it["failed"][0].asString() }).allMatch { it.endsWith(", regex timed out") }
    }
}
