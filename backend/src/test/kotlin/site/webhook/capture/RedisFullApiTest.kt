package site.webhook.capture

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.http.STORAGE_FULL_MESSAGE
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.json.JsonMapper

/**
 * Redis com `maxmemory` e `noeviction` (docker-compose.yml): cheio, recusa gravação em vez de
 * despejar chaves. O webhook responde 507 (Insufficient Storage), e o que já está gravado continua legível.
 */
@ApiTest
@DisplayName("Redis cheio (noeviction)")
class RedisFullApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun config(
        name: String,
        value: String,
    ) {
        redis.execute { it.serverCommands().setConfig(name, value) }
    }

    private fun fillUp() {
        val used = redis.execute { it.serverCommands().info("memory") }?.getProperty("used_memory")?.toLong() ?: 0
        config("maxmemory-policy", "noeviction")
        config("maxmemory", used.toString())
    }

    @AfterEach
    fun unlimited() {
        config("maxmemory", "0")
    }

    @Test
    @DisplayName("Dado o Redis no teto de memória, quando chega mensagem, então responde 507 e token e mensagens antigas seguem legíveis")
    fun capture_redisCheio_deveResponder507SemPerderDados() {
        val tokenId = api.tokenId()
        val stored =
            api
                .send("GET", "/$tokenId")
                .headers()
                .firstValue("X-Request-Id")
                .orElseThrow()
        fillUp()

        val rejected = api.send("POST", "/$tokenId", "x".repeat(10_000).toByteArray(), JSON_CLIENT)
        val token = api.send("GET", "/token/$tokenId", headers = JSON_CLIENT)
        val page = api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT)

        assertThat(rejected.statusCode()).isEqualTo(507)
        assertThat(api.json(rejected)["error"]["message"].asString()).isEqualTo(STORAGE_FULL_MESSAGE)
        assertThat(token.statusCode()).isEqualTo(200)
        assertThat(page.statusCode()).isEqualTo(200)
        assertThat(api.json(page)["data"].toList().map { it["uuid"].asString() }).containsExactly(stored)
    }
}
