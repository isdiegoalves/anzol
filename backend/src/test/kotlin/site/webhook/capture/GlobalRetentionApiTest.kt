package site.webhook.capture

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.TestPropertySource
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.json.JsonMapper

/** `WEBHOOK_MAX_REQUESTS`: teto por URL quando a limpeza automática está desligada. */
@ApiTest
@TestPropertySource(properties = ["webhook.max-requests=50"])
@DisplayName("Teto global de mensagens por URL")
class GlobalRetentionApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun total(tokenId: String): Int = api.json(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT))["total"].asInt()

    @Test
    @DisplayName("Dado WEBHOOK_MAX_REQUESTS 50 e URL sem auto_cleanup, quando chegam 60, então responde 200 a todas e guarda 50")
    fun store_semAutoCleanup_deveAplicarOTetoGlobal() {
        val tokenId = api.tokenId()

        val statuses = (1..60).map { api.send("GET", "/$tokenId").statusCode() }

        assertThat(statuses).containsOnly(200)
        assertThat(total(tokenId)).isEqualTo(50)
    }

    @Test
    @DisplayName("Dado WEBHOOK_MAX_REQUESTS 50 e auto_cleanup 500, quando chegam 60, então vale o limite da URL e guarda 60")
    fun store_comAutoCleanup_deveVencerOTetoGlobal() {
        val tokenId = api.tokenId("""{"auto_cleanup":500}""")

        repeat(60) { api.send("GET", "/$tokenId") }

        assertThat(total(tokenId)).isEqualTo(60)
    }
}
