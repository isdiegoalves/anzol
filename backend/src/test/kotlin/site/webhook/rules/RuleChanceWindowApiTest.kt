package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.RequestId
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.http.HttpResponse
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

@ApiTest
@DisplayName("Chance e janela de tempo da regra, na API e na captura")
class RuleChanceWindowApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun putRules(
        tokenId: String,
        rules: String,
    ): HttpResponse<String> = api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY)

    private fun getRules(tokenId: String): JsonNode = api.json(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT))

    private fun trace(
        tokenId: String,
        requestId: String,
    ): JsonNode = api.json(api.send("GET", "/token/$tokenId/request/$requestId/rules/trace", headers = JSON_CLIENT))

    /** `created_at` da mensagem (`2026-09-29 12:00:00`) no formato das frases da janela. */
    private fun receivedAt(message: JsonNode): String = message["created_at"].asString().replace(' ', 'T') + "Z"

    @Nested
    @DisplayName("Formato gravado")
    inner class Persisted {
        @Test
        @DisplayName(
            "Dado a lista gravada no Redis antes da chance e da janela, quando lê e o webhook chega, então volta igual e responde igual",
        )
        fun leitura_listaAntiga_deveVoltarIgualEResponder() {
            val tokenId = api.tokenId()
            val stored =
                """[{"id":"0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41","name":"antiga","enabled":true,"priority":5,""" +
                    """"match":{"method":[],"path":{"equals":"/a"},"query":{},"headers":{},"body":[]},"scenario":null,""" +
                    """"response":{"status":201,"headers":{"X-Mock":"sim"},"body":"ok","template":false,"delay":null,""" +
                    """"dribble":null,"fault":null}}]"""
            redis.opsForValue().set("token:$tokenId:rules", stored)

            val response = api.send("POST", "/$tokenId/a")

            assertThat(getRules(tokenId)).isEqualTo(api.tree(stored))
            assertThat(response.statusCode()).isEqualTo(201)
            assertThat(response.body()).isEqualTo("ok")
        }

        @Test
        @DisplayName("Dado chance e janela, quando salva, então o JSON devolvido e o gravado trazem os três campos, as datas em UTC com Z")
        fun put_chanceEJanela_deveDevolverEGravarOsTresCampos() {
            val tokenId = api.tokenId()

            val saved =
                putRules(
                    tokenId,
                    """[{"name":"x","chance":30,"active_from":"2026-09-29T09:00:00-03:00","active_until":"2026-09-29T12:30:00.5Z"},""" +
                        """{"name":"y"}]""",
                )

            val rules = api.json(saved)
            val raw = api.tree(redis.opsForValue().get("token:$tokenId:rules").orEmpty())
            assertThat(saved.statusCode()).isEqualTo(200)
            for (json in listOf(rules, raw)) {
                assertThat(json[0]["chance"].asInt()).isEqualTo(30)
                assertThat(json[0]["active_from"].asString()).isEqualTo("2026-09-29T12:00:00Z")
                assertThat(json[0]["active_until"].asString()).isEqualTo("2026-09-29T12:30:00Z")
                assertThat(json[1].propertyNames().toList()).doesNotContain("chance", "active_from", "active_until")
            }
            assertThat(getRules(tokenId)).isEqualTo(rules)
        }
    }

    @Nested
    @DisplayName("Janela na captura")
    inner class Window {
        @Test
        @DisplayName(
            "Dado uma janela que ainda não abriu, quando o webhook chega, então a regra é pulada e o near miss diz a hora de chegada " +
                "gravada",
        )
        fun capture_antesDaJanela_devePularComAHoraGravada() {
            val tokenId = api.tokenId()
            putRules(tokenId, """[{"name":"futura","active_from":"2099-01-01T00:00:00Z","response":{"status":201}}]""")

            val message = api.capture(tokenId)

            assertThat(message["rule"].isNull).isTrue()
            assertThat(message["near_miss"]["failed"]).isEqualTo(
                api.tree("""["window: opens at 2099-01-01T00:00:00Z, received at ${receivedAt(message)}"]"""),
            )
            assertThat(message["near_miss"]["conditions"]).isEqualTo(api.tree("""["active_from"]"""))
            assertThat(trace(tokenId, message["uuid"].asString())["rules"][0]["failed"]).isEqualTo(message["near_miss"]["failed"])
        }

        @Test
        @DisplayName("Dado uma janela aberta desde o segundo da chegada, quando o webhook chega, então a regra responde")
        fun capture_dentroDaJanela_deveResponder() {
            val tokenId = api.tokenId()
            val now = Instant.now().truncatedTo(ChronoUnit.SECONDS)
            val until = now.plusSeconds(60)
            putRules(tokenId, """[{"name":"agora","active_from":"$now","active_until":"$until","response":{"status":201}}]""")

            val message = api.capture(tokenId)

            assertThat(message["rule"]["name"].asString()).isEqualTo("agora")
            assertThat(message["response"]["status"].asInt()).isEqualTo(201)
        }
    }

    @Nested
    @DisplayName("Sorteio na captura")
    inner class Chance {
        @Test
        @DisplayName(
            "Dado chance 50, quando chegam 40 webhooks, então a regra responde exatamente aos que sortearam até 50, e o trace concorda",
        )
        fun capture_chance_deveSeguirOSorteioDeCadaMensagem() {
            val tokenId = api.tokenId()
            val ruleId = api.json(putRules(tokenId, """[{"name":"moeda","chance":50,"response":{"status":201}}]"""))[0]["id"].asString()

            val messages = (1..40).map { api.capture(tokenId) }

            for (message in messages) {
                val rolled = roll(RequestId(UUID.fromString(message["uuid"].asString())), RuleId(UUID.fromString(ruleId)))
                val traced = trace(tokenId, message["uuid"].asString())["rules"][0]
                if (rolled <= 50) {
                    assertThat(message["rule"]["name"].asString()).isEqualTo("moeda")
                    assertThat(traced["matches"].asBoolean()).isTrue()
                } else {
                    val phrase = "chance 50%: rolled $rolled, not applied"
                    assertThat(message["near_miss"]["failed"]).isEqualTo(api.tree("""["$phrase"]"""))
                    assertThat(traced["failed"]).isEqualTo(api.tree("""["$phrase"]"""))
                    assertThat(traced["conditions"]).isEqualTo(api.tree("""["chance"]"""))
                }
            }
            assertThat(messages.map { it["rule"].isNull }.toSet()).containsExactlyInAnyOrder(true, false)
        }
    }
}
