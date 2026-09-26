package site.webhook.capture

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.test.context.TestPropertySource
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_CLIENT
import site.webhook.support.WHOLE_HASH_COMMANDS
import site.webhook.support.commandCalls
import site.webhook.support.resetCommandStats
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.util.concurrent.Executors

private const val MESSAGES = 10_000
private const val BODY_BYTES = 15_000
private const val SENDERS = 16

/**
 * Reprodução do bug medido no app antigo: 10.000 mensagens de 15 KB derrubavam a listagem, que
 * lia a hash inteira (HGETALL) para montar cada página.
 */
@ApiTest
@TestPropertySource(properties = ["webhook.max-requests=$MESSAGES"])
@DisplayName("Listagem com 10.000 mensagens de 15 KB")
class RequestVolumeApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun fill(tokenId: String) {
        val body = "x".repeat(BODY_BYTES).toByteArray()
        Executors.newFixedThreadPool(SENDERS).use { pool ->
            repeat(MESSAGES) {
                pool.submit { api.send("POST", "/$tokenId", body, mapOf("Content-Type" to "text/plain")) }
            }
        }
    }

    private fun page(
        tokenId: String,
        query: String,
    ): JsonNode {
        val response = api.send("GET", "/token/$tokenId/requests?$query", headers = JSON_CLIENT)
        assertThat(response.statusCode()).isEqualTo(200)
        return api.json(response)
    }

    private fun JsonNode.uuids(): List<String> = this["data"].toList().map { it["uuid"].asString() }

    @Test
    @DisplayName("Dado 10.000 mensagens de 15 KB, quando lista a primeira e a última página, então responde 200 sem ler a hash inteira")
    fun all_dezMilMensagensGrandes_deveListarSemLerAHashInteira() {
        val tokenId = api.tokenId()
        fill(tokenId)
        redis.resetCommandStats()

        val oldestFirst = page(tokenId, "")
        val oldestLast = page(tokenId, "page=200")
        val newestFirst = page(tokenId, "sorting=newest")

        assertThat(redis.commandCalls().filterKeys { it in WHOLE_HASH_COMMANDS }).isEmpty()
        assertThat(oldestFirst["total"].asInt()).isEqualTo(MESSAGES)
        assertThat(oldestFirst["data"].size()).isEqualTo(50)
        assertThat(oldestFirst["data"][0]["content"].asString()).hasSize(BODY_BYTES)
        assertThat(oldestLast["is_last_page"].asBoolean()).isTrue()
        assertThat(newestFirst.uuids()).containsExactlyElementsOf(oldestLast.uuids().reversed())
    }
}
