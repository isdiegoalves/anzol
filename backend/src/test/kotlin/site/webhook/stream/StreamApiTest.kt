package site.webhook.stream

import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.TestPropertySource
import site.webhook.TokenId
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_CLIENT
import site.webhook.support.SseClient
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.UUID

@ApiTest
@TestPropertySource(properties = ["webhook.stream.heartbeat=200ms"])
@DisplayName("Tempo real por SSE")
class StreamApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val stream: RequestStream,
) {
    private val api = ApiClient(port, jsonMapper)
    private val wait = await().atMost(Duration.ofSeconds(5))

    private fun subscribe(tokenId: String) = SseClient("${api.base}/token/$tokenId/stream")

    @Test
    @DisplayName("Dado uma aba assinando o token, quando chega uma mensagem, então recebe request.created com a mensagem gravada")
    fun stream_mensagemGravada_deveEntregarEvento() {
        val tokenId = api.tokenId()
        subscribe(tokenId).use { client ->
            assertThat(
                client.response
                    .headers()
                    .firstValue("Content-Type")
                    .orElse(""),
            ).startsWith("text/event-stream")

            val response = api.send("POST", "/$tokenId/201?q=1", """{"a":1}""".toByteArray(), mapOf("Content-Type" to "application/json"))

            wait.until { client.events.isNotEmpty() }
            val event = client.events.first()
            val payload = api.tree(event.data)
            val stored = api.json(api.send("GET", "/token/$tokenId/request/${response.headers().firstValue("X-Request-Id").get()}"))
            assertThat(event.name).isEqualTo("request.created")
            assertThat(payload.propertyNames().toList()).containsExactlyInAnyOrder("request", "total", "truncated", "removed")
            assertThat(payload["request"]).isEqualTo(stored)
            assertThat(payload["total"].asInt()).isEqualTo(1)
            assertThat(payload["truncated"].asBoolean()).isFalse()
        }
    }

    @Test
    @DisplayName("Dado dois tokens assinados, quando chega mensagem num deles, então o outro não recebe nada")
    fun stream_outroToken_naoDeveReceberEvento() {
        val tokenA = api.tokenId()
        val tokenB = api.tokenId()
        subscribe(tokenA).use { clientA ->
            subscribe(tokenB).use { clientB ->
                api.send("GET", "/$tokenA")
                api.send("GET", "/$tokenA/404")

                wait.until { clientA.events.size == 2 }
                assertThat(clientA.events.map { api.tree(it.data)["total"].asInt() }).containsExactly(1, 2)
                assertThat(clientB.events).isEmpty()
            }
        }
    }

    @Test
    @DisplayName("Dado uma aba que fecha, quando passa o heartbeat, então o assinante sai do registro")
    fun stream_abaFechada_deveRemoverAssinante() {
        val tokenId = api.tokenId()
        val id = TokenId(UUID.fromString(tokenId))
        val clients = (1..3).map { subscribe(tokenId) }
        assertThat(stream.subscriberCount(id)).isEqualTo(3)

        clients.forEach { it.close() }

        wait.until { stream.subscriberCount(id) == 0 }
        assertThat(stream.subscriberCount(id)).isZero()
    }

    @Test
    @DisplayName("Dado um token inexistente, quando assina, então responde 410 sem registrar assinante")
    fun stream_tokenInexistente_deveResponder410() {
        val before = stream.subscriberCount()

        val response = api.send("GET", "/token/00000000-0000-4000-8000-000000000000/stream", headers = JSON_CLIENT)

        assertThat(response.statusCode()).isEqualTo(410)
        assertThat(api.json(response)["error"]["message"].asString()).isEqualTo("Token not found")
        assertThat(stream.subscriberCount()).isEqualTo(before)
    }
}
