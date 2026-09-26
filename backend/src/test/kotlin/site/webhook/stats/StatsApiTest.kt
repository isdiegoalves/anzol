package site.webhook.stats

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.privacy.SECRET_HEADER
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets.UTF_8
import java.util.HexFormat
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val SECRET = "segredo-das-estatisticas"
private const val WINDOW_ERROR = """{"window":["The window must be an integer between 1 and 500."]}"""
private val PAID = UUID.randomUUID().toString()
private val REFUND = UUID.randomUUID().toString()

private fun signed(body: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(SECRET.toByteArray(UTF_8), "HmacSHA256"))
    return HexFormat.of().formatHex(mac.doFinal(body.toByteArray(UTF_8)))
}

/** Mensagem gravada: o JSON da captura; [checks] são os campos das regras, da assinatura e do schema (ou nada, a do PHP). */
private data class Stored(
    val seq: Long,
    val createdAt: String,
    val method: String,
    val checks: String = "",
)

@ApiTest
@DisplayName("GET /token/{id}/stats")
class StatsApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun stats(
        tokenId: String,
        query: String = "",
        headers: Map<String, String> = JSON_CLIENT,
    ): HttpResponse<String> = api.send("GET", "/token/$tokenId/stats$query", headers = headers)

    /** Grava direto no Redis (hash e índice, com o `seq` escolhido), como a captura grava. */
    private fun store(
        tokenId: String,
        vararg messages: Stored,
    ) {
        messages.forEach { message ->
            val id = UUID.randomUUID().toString()
            val json =
                """{"uuid":"$id","token_id":"$tokenId","ip":"10.0.0.1","hostname":"localhost","method":"${message.method}",""" +
                    """"user_agent":null,"content":"","query":[],"headers":{},"url":"http://localhost/$tokenId",""" +
                    """"created_at":"${message.createdAt}","updated_at":"${message.createdAt}"${message.checks}}"""
            redis.opsForHash<String, String>().put("token:$tokenId:requests", id, json)
            redis.opsForZSet().add("token:$tokenId:requests:index", id, message.seq.toDouble())
        }
    }

    /**
     * Cinco mensagens em três horas: uma do app antigo (sem os campos novos), assinatura nos quatro estados com o
     * motivo que varia no parêntese, schema com caminho repetido na mesma mensagem, duas respostas da mesma regra
     * com nomes diferentes (vale o da mais nova) e um near miss.
     */
    private fun fixture(tokenId: String) =
        store(
            tokenId,
            Stored(1_000, "2026-09-25 09:13:44", "GET"),
            Stored(
                2_000,
                "2026-09-26 13:59:59",
                "POST",
                ""","rule":null,"near_miss":{"id":"$REFUND","name":"Refund queued","failed":["method: expected PUT, got POST"]},""" +
                    """"signature":{"provider":"stripe","valid":false,"reason":"timestamp outside tolerance (412 s)"},""" +
                    """"schema":{"valid":false,"errors":[{"path":"/a","message":"x"},{"path":"/a","message":"y"},""" +
                    """{"path":"","message":"z"}]}""",
            ),
            Stored(
                3_000,
                "2026-09-26 14:00:00",
                "POST",
                ""","rule":{"id":"$PAID","name":"Old name"},"near_miss":null,""" +
                    """"signature":{"provider":"stripe","valid":false,"reason":"header stripe-signature absent"},""" +
                    """"schema":{"valid":true,"errors":[]}""",
            ),
            Stored(
                4_000,
                "2026-09-26 14:02:07",
                "POST",
                ""","rule":{"id":"$PAID","name":"Stripe payment OK"},"near_miss":null,""" +
                    """"signature":{"provider":"stripe","valid":false,"reason":"timestamp outside tolerance (9 s)"},""" +
                    """"schema":{"valid":false,"errors":[{"path":"/a","message":"x"}]}""",
            ),
            Stored(
                5_000,
                "2026-09-26 14:02:07",
                "POST",
                ""","rule":null,"near_miss":null,"signature":{"provider":"stripe","valid":true,"reason":null},"schema":null""",
            ),
        )

    private fun ok(response: HttpResponse<String>): JsonNode {
        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.headers().firstValue("Content-Type").orElseThrow()).startsWith("application/json")
        return api.json(response)
    }

    @Test
    @DisplayName("Dado mensagens em três horas, com e sem os campos novos, quando pede sem window, então resume as 500 mais novas")
    fun janelaPadrao_deveResumirTodas() {
        val tokenId = api.tokenId()
        fixture(tokenId)

        val body = ok(stats(tokenId))

        assertThat(body).isEqualTo(
            api.tree(
                """{"window":500,"evaluated":5,"total":5,"newest_seq":5000,"oldest_seq":1000,""" +
                    """"newest_at":"2026-09-26 14:02:07","oldest_at":"2026-09-25 09:13:44","methods":{"POST":4,"GET":1},""" +
                    """"signature":{"valid":1,"invalid":2,"absent":1,"unchecked":1,"reasons":[""" +
                    """{"reason":"timestamp outside tolerance","count":2},{"reason":"header stripe-signature absent","count":1}]},""" +
                    """"schema":{"valid":1,"invalid":2,"unchecked":2,"paths":[{"path":"/a","count":2},{"path":"","count":1}]},""" +
                    """"rules":{"answered":[{"id":"$PAID","name":"Stripe payment OK","count":2}],""" +
                    """"near_miss":[{"id":"$REFUND","name":"Refund queued","count":1}],"default":3},""" +
                    """"hourly":[{"hour":"2026-09-25 09:00:00","count":1,"methods":{"GET":1}},""" +
                    """{"hour":"2026-09-26 13:00:00","count":1,"methods":{"POST":1}},""" +
                    """{"hour":"2026-09-26 14:00:00","count":3,"methods":{"POST":3}}]}""",
            ),
        )
    }

    @Test
    @DisplayName("Dado cinco mensagens, quando pede window=2, então avalia só as duas mais novas e total conta todas")
    fun janelaMenor_deveAvaliarAsMaisNovas() {
        val tokenId = api.tokenId()
        fixture(tokenId)

        val body = ok(stats(tokenId, "?window=2"))

        assertThat(body["window"].asInt()).isEqualTo(2)
        assertThat(body["evaluated"].asInt()).isEqualTo(2)
        assertThat(body["total"].asInt()).isEqualTo(5)
        assertThat(body["newest_seq"].asLong()).isEqualTo(5_000)
        assertThat(body["oldest_seq"].asLong()).isEqualTo(4_000)
        assertThat(body["rules"]).isEqualTo(
            api.tree("""{"answered":[{"id":"$PAID","name":"Stripe payment OK","count":1}],"near_miss":[],"default":1}"""),
        )
    }

    @Test
    @DisplayName("Dado uma URL sem mensagens, quando pede, então responde zeros, listas vazias e seq e horário nulos")
    fun urlVazia_deveResponderZeros() {
        val tokenId = api.tokenId()

        val body = ok(stats(tokenId, "?window="))

        assertThat(body).isEqualTo(
            api.tree(
                """{"window":500,"evaluated":0,"total":0,"newest_seq":null,"oldest_seq":null,"newest_at":null,"oldest_at":null,""" +
                    """"methods":{},"signature":{"valid":0,"invalid":0,"absent":0,"unchecked":0,"reasons":[]},""" +
                    """"schema":{"valid":0,"invalid":0,"unchecked":0,"paths":[]},""" +
                    """"rules":{"answered":[],"near_miss":[],"default":0},"hourly":[]}""",
            ),
        )
    }

    @ParameterizedTest(name = "window {0}")
    @ValueSource(strings = ["?window=0", "?window=501", "?window=abc", "?window=1.5", "?window=-1", "?window=1e2", "?window[]=1"])
    @DisplayName("Dado um window fora de 1 a 500 ou que não é inteiro, quando pede, então 422 com a mensagem do campo")
    fun windowInvalido_deveResponder422(query: String) {
        val tokenId = api.tokenId()

        val response = stats(tokenId, query)

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response)).isEqualTo(api.tree(WINDOW_ERROR))
    }

    @Test
    @DisplayName("Dado uma URL que não existe, quando pede, então 410 Token not found antes de validar o window")
    fun urlInexistente_deveResponder410() {
        val response = stats(UUID.randomUUID().toString(), "?window=0")

        assertThat(response.statusCode()).isEqualTo(410)
        assertThat(api.json(response)["error"]["message"].asString()).isEqualTo("Token not found")
    }

    @Test
    @DisplayName("Dado uma URL protegida, quando pede sem o segredo, então 401; com o segredo, então 200")
    fun urlProtegida_deveExigirAcesso() {
        val tokenId = api.tokenId("""{"read_secret":"$SECRET"}""")

        val denied = stats(tokenId)
        val allowed = stats(tokenId, headers = JSON_CLIENT + (SECRET_HEADER to SECRET))

        assertThat(denied.statusCode()).isEqualTo(401)
        assertThat(api.json(denied)).isEqualTo(api.tree("""{"error":"This URL is protected","protected":true}"""))
        assertThat(allowed.statusCode()).isEqualTo(200)
    }

    @Test
    @DisplayName(
        "Dado mensagens capturadas com assinatura, schema e regra, quando pede, então conta o que a captura gravou e nada muda no Redis",
    )
    fun capturaDeVerdade_deveContarOQueFoiGravado() {
        val tokenId =
            api.tokenId(
                """{"signature":{"provider":"generic","secret":"$SECRET","header":"X-Signature"},""" +
                    """"schema":{"type":"object","required":["id"]}}""",
            )
        api.send(
            "PUT",
            "/token/$tokenId/rules",
            """[{"name":"Pedido","match":{"method":["POST"],"signature":"valid"}}]""".toByteArray(),
            JSON_BODY,
        )
        val ruleId = api.json(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT))[0]["id"].asString()
        api.capture(tokenId, "POST", body = """{"id":1}""".toByteArray(), headers = mapOf("X-Signature" to signed("""{"id":1}""")))
        api.capture(tokenId, "GET")
        val before = redis.keys("token:$tokenId*").associateWith { redis.type(it) to redis.dump(it)?.toList() }

        val body = ok(stats(tokenId))

        assertThat(body["methods"]).isEqualTo(api.tree("""{"GET":1,"POST":1}"""))
        assertThat(body["signature"]).isEqualTo(
            api.tree("""{"valid":1,"invalid":0,"absent":1,"unchecked":0,"reasons":[{"reason":"header X-Signature absent","count":1}]}"""),
        )
        assertThat(body["schema"]).isEqualTo(api.tree("""{"valid":1,"invalid":1,"unchecked":0,"paths":[{"path":"","count":1}]}"""))
        assertThat(body["rules"]).isEqualTo(
            api.tree(
                """{"answered":[{"id":"$ruleId","name":"Pedido","count":1}],"near_miss":[{"id":"$ruleId","name":"Pedido","count":1}],""" +
                    """"default":1}""",
            ),
        )
        assertThat(redis.keys("token:$tokenId*").associateWith { redis.type(it) to redis.dump(it)?.toList() }).isEqualTo(before)
    }
}
