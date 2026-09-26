package site.webhook

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.json.JsonMapper
import java.time.Instant
import java.util.UUID

/** O app antigo e o novo dividem o mesmo Redis: o que um grava o outro precisa ler. */
@ApiTest
@DisplayName("Convivência com o app antigo no Redis")
class LegacyRedisCompatibilityTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName(
        "Dado token e mensagens gravados pelo PHP, quando a API nova os lê, " +
            "então devolve o mesmo JSON (campos novos nulos, rule, near_miss, signature e schema nulos, seq do created_at)",
    )
    fun leitura_jsonGravadoPeloPhp_deveDevolverOMesmoConteudo() {
        val tokenId = UUID.randomUUID().toString()
        val requestId = UUID.randomUUID().toString()
        val formId = UUID.randomUUID().toString()
        val token = phpToken(tokenId)
        val json = phpJsonMessage(tokenId, requestId)
        val form = phpFormMessage(tokenId, formId)
        redis.opsForValue().set("token:$tokenId", token)
        redis.opsForHash<String, String>().putAll("token:$tokenId:requests", mapOf(requestId to json, formId to form, "fantasma" to ""))

        val readToken = api.send("GET", "/token/$tokenId", headers = JSON_CLIENT)
        val readMessage = api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT)
        val page = api.json(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT))
        val raw = api.send("GET", "/token/$tokenId/request/$requestId/raw")

        assertThat(api.json(readToken)).isEqualTo(
            api.tree(token.dropLast(1) + ""","retry_after":null,"auto_cleanup":null,"signature":null,"schema":null}"""),
        )
        assertThat(api.json(readMessage)).isEqualTo(api.tree(json.withSeq("2026-09-26T00:41:43Z")))
        assertThat(page["data"].toList()).containsExactly(
            api.tree(json.withSeq("2026-09-26T00:41:43Z")),
            api.tree(form.withSeq("2026-09-26T00:42:10Z")),
        )
        assertThat(page["total"].asInt()).isEqualTo(3)
        assertThat(raw.headers().firstValue("Content-Type")).hasValue("application/json")
        assertThat(raw.body()).isEqualTo("""{"a":1,"b":[1,2]}""")
    }

    @Test
    @DisplayName("Dado um token e uma mensagem criados pela API nova, quando o PHP ler o Redis, então acha as chaves, a ordem e o TTL dele")
    fun gravacao_apiNova_deveUsarChavesFormatoETtlDoPhp() {
        val tokenId = api.tokenId()
        val requestId =
            api.capture(
                tokenId,
                "POST",
                "?q=1",
                "a=1".toByteArray(),
                mapOf("Content-Type" to "application/x-www-form-urlencoded"),
            )["uuid"]

        val token = api.tree(redis.opsForValue().get("token:$tokenId").orEmpty())
        val message = api.tree(redis.opsForHash<String, String>().get("token:$tokenId:requests", requestId.asString()).orEmpty())

        assertThat(token.propertyNames().toList()).containsExactly(
            "uuid",
            "ip",
            "user_agent",
            "default_content",
            "default_status",
            "default_content_type",
            "timeout",
            "cors",
            "created_at",
            "updated_at",
            "retry_after",
            "auto_cleanup",
            "signature",
            "schema",
        )
        assertThat(message.propertyNames().toList()).containsExactly(
            "uuid",
            "token_id",
            "ip",
            "hostname",
            "method",
            "user_agent",
            "content",
            "query",
            "headers",
            "url",
            "created_at",
            "updated_at",
            "request",
            "rule",
            "near_miss",
            "signature",
            "schema",
        )
        assertThat(message["created_at"].asString()).matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}")
        assertThat(redis.getExpire("token:$tokenId")).isBetween(EXPIRY_SECONDS - 5, EXPIRY_SECONDS)
        assertThat(redis.getExpire("token:$tokenId:requests")).isBetween(EXPIRY_SECONDS - 5, EXPIRY_SECONDS)
    }

    /**
     * A mensagem como a API a devolve: o JSON gravado, `rule`, `near_miss`, `signature` e `schema` nulos (gravada antes deles)
     * e o `seq`, que no
     * backfill é o `created_at` em microssegundos.
     */
    private fun String.withSeq(createdAt: String) =
        dropLast(1) + ""","rule":null,"near_miss":null,"signature":null,"schema":null,""" +
            """"seq":${Instant.parse(createdAt).epochSecond * 1_000_000}}"""

    private fun phpToken(tokenId: String) =
        """{"uuid":"$tokenId","ip":"192.168.107.1","user_agent":"curl\/8.16.0","default_content":"olá",""" +
            """"default_status":200,"default_content_type":"text\/plain","timeout":0,"cors":false,""" +
            """"created_at":"2026-09-26 00:41:18","updated_at":"2026-09-26 00:41:18"}"""

    private fun phpJsonMessage(
        tokenId: String,
        id: String,
    ) = """{"uuid":"$id","token_id":"$tokenId","ip":"192.168.107.1","hostname":"localhost","method":"PUT",""" +
        """"user_agent":"curl\/8.16.0","content":"{\"a\":1,\"b\":[1,2]}","query":{"q":"1"},""" +
        """"headers":{"content-length":["17"],"content-type":["application\/json"],"accept":["*\/*"],""" +
        """"user-agent":["curl\/8.16.0"],"host":["localhost:8084"]},""" +
        """"url":"http:\/\/localhost:8084\/$tokenId\/203\/x\/y?q=1","created_at":"2026-09-26 00:41:43","updated_at":"2026-09-26 00:41:43"}"""

    private fun phpFormMessage(
        tokenId: String,
        id: String,
    ) = """{"uuid":"$id","token_id":"$tokenId","ip":"192.168.107.1","hostname":"localhost","method":"GET",""" +
        """"user_agent":null,"content":"","query":["a","b"],"headers":{"host":["localhost:8084"],""" +
        """"content-length":[""],"content-type":[""]},"url":"http:\/\/localhost:8084\/$tokenId?0=a&1=b",""" +
        """"created_at":"2026-09-26 00:42:10","updated_at":"2026-09-26 00:42:10","request":{"x":{"y":"ç"}}}"""

    private companion object {
        const val EXPIRY_SECONDS = 604_800L
    }
}
