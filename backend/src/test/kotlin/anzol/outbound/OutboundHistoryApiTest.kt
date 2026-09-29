package anzol.outbound

import anzol.support.ApiClient
import anzol.support.JSON_CLIENT
import anzol.support.PermissiveOutboundApiTest
import anzol.support.Receiver
import anzol.support.outbound
import anzol.support.replay
import anzol.support.sendOut
import io.micrometer.core.instrument.MeterRegistry
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.json.JsonMapper

private const val EXPIRY_SECONDS = 604_800L
private const val BLOCKED = """{"url":"http://169.254.169.254/","method":"GET"}"""

@PermissiveOutboundApiTest
@DisplayName("Histórico, limite por minuto e métrica do replay e do send")
class OutboundHistoryApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
    private val registry: MeterRegistry,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun outbound(
        kind: String,
        outcome: String,
    ): Double =
        registry
            .find("anzol.outbound")
            .tags("kind", kind, "outcome", outcome)
            .counter()
            ?.count() ?: 0.0

    @Test
    @DisplayName("Dados 55 disparos, quando lê o histórico, então vêm os 50 mais novos, o mais novo primeiro, com o TTL da URL")
    fun historico_deveGuardarOs50MaisNovos() {
        val tokenId = api.tokenId()

        val ids =
            (1..55).map { index ->
                // Zera a janela do limite por minuto: aqui só o teto do histórico interessa.
                if (index % MAX_DISPATCHES_PER_WINDOW == 0) redis.delete("token:$tokenId:outbound:rate")
                api.json(api.sendOut(tokenId, BLOCKED))["id"].asString()
            }

        val history = api.outbound(tokenId)
        assertThat(history.size()).isEqualTo(MAX_HISTORY)
        assertThat((0 until history.size()).map { history[it]["id"].asString() }).isEqualTo(ids.takeLast(MAX_HISTORY).reversed())
        assertThat(redis.getExpire("token:$tokenId:outbound")).isBetween(EXPIRY_SECONDS - 5, EXPIRY_SECONDS)
    }

    @Test
    @DisplayName("Dada uma URL com histórico, quando é apagada, então o histórico e a contagem do limite saem junto")
    fun apagarUrl_deveApagarOHistorico() {
        val tokenId = api.tokenId()
        api.sendOut(tokenId, BLOCKED)
        assertThat(redis.hasKey("token:$tokenId:outbound")).isTrue()
        assertThat(redis.hasKey("token:$tokenId:outbound:rate")).isTrue()

        api.send("DELETE", "/token/$tokenId", headers = JSON_CLIENT)

        assertThat(redis.hasKey("token:$tokenId:outbound")).isFalse()
        assertThat(redis.hasKey("token:$tokenId:outbound:rate")).isFalse()
        assertThat(api.send("GET", "/token/$tokenId/outbound", headers = JSON_CLIENT).statusCode()).isEqualTo(410)
    }

    @Test
    @DisplayName(
        "Dados 30 disparos (replay e send) no minuto, quando vem o 31º, então 429 com Retry-After, sem sair nem entrar no histórico",
    )
    fun limite_deveResponder429ComRetryAfter() {
        Receiver().use { target ->
            val tokenId = api.tokenId()
            val other = api.tokenId()
            val requestId = api.capture(tokenId)["uuid"].asString()
            repeat(MAX_DISPATCHES_PER_WINDOW / 2) {
                assertThat(
                    api.replay(tokenId, requestId, """{"url":"${target.url("/r")}","keep_path":false}""").statusCode(),
                ).isEqualTo(200)
                assertThat(api.sendOut(tokenId, """{"url":"${target.url("/s")}"}""").statusCode()).isEqualTo(200)
            }

            val refused =
                listOf(
                    api.sendOut(tokenId, """{"url":"${target.url("/s")}"}"""),
                    api.replay(tokenId, requestId, """{"url":"${target.url("/r")}"}"""),
                )

            refused.forEach { response ->
                assertThat(response.statusCode()).isEqualTo(429)
                assertThat(
                    response
                        .headers()
                        .firstValue("Retry-After")
                        .orElseThrow()
                        .toLong(),
                ).isBetween(1L, 60L)
            }
            assertThat(target.received).hasSize(MAX_DISPATCHES_PER_WINDOW)
            assertThat(api.outbound(tokenId).size()).isEqualTo(MAX_DISPATCHES_PER_WINDOW)
            assertThat(api.sendOut(other, """{"url":"${target.url("/s")}"}""").statusCode()).isEqualTo(200)
        }
    }

    @Test
    @DisplayName("Dado um disparo, quando termina, então conta em anzol.outbound só com kind e outcome")
    fun metrica_deveContarPorKindEOutcome() {
        Receiver().use { target ->
            val tokenId = api.tokenId()
            val sent2xx = outbound("send", "2xx")
            val blocked = outbound("send", "blocked")
            val replayError = outbound("replay", "error")
            val requestId = api.capture(tokenId)["uuid"].asString()

            api.sendOut(tokenId, """{"url":"${target.url("/")}"}""")
            api.sendOut(tokenId, BLOCKED)
            api.replay(tokenId, requestId, """{"url":"http://1.2.3.4.5/"}""")

            assertThat(outbound("send", "2xx") - sent2xx).isEqualTo(1.0)
            assertThat(outbound("send", "blocked") - blocked).isEqualTo(1.0)
            assertThat(outbound("replay", "error") - replayError).isEqualTo(1.0)
            registry.find("anzol.outbound").counters().forEach { counter ->
                assertThat(counter.id.tags.map { it.key }).containsExactlyInAnyOrder("kind", "outcome")
            }
        }
    }
}
