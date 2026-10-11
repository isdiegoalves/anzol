package anzol.search

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.io.IOException
import java.util.UUID

private const val EVERY_FAMILY = """["1xx","2xx","3xx","4xx","5xx"]"""

@ApiTest
@DisplayName("Busca pelo status respondido (answered)")
class SearchAnsweredApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun search(
        tokenId: String,
        body: String,
    ) = api.send("POST", "/token/$tokenId/requests/search", body.toByteArray(), JSON_BODY)

    private fun found(
        tokenId: String,
        body: String,
    ): JsonNode {
        val response = search(tokenId, body)
        assertThat(response.statusCode()).`as`(response.body()).isEqualTo(200)
        return api.json(response)
    }

    private fun uuids(
        tokenId: String,
        body: String,
    ): List<String> = found(tokenId, body)["data"].toList().map { it["uuid"].asString() }

    private fun answered(status: String): String = """{"sorting":"oldest","answered":$status}"""

    @Test
    @DisplayName(
        "Dado mensagens respondidas com 200, 201, 404, 500 e 503 e uma com a conexão derrubada, quando busca por família e por " +
            "status, então acha as de qualquer item da lista e nunca a derrubada",
    )
    fun search_answered_deveFiltrarPeloStatusGravado() {
        val tokenId = api.tokenId()
        val ok = api.capture(tokenId)["uuid"].asString()
        val criada = api.capture(tokenId, "POST", "/201")["uuid"].asString()
        val ausente = api.capture(tokenId, suffix = "/404")["uuid"].asString()
        val erro = api.capture(tokenId, suffix = "/500")["uuid"].asString()
        val fora = api.capture(tokenId, suffix = "/503")["uuid"].asString()
        val rules = """[{"name":"cai","match":{"method":["DELETE"]},"response":{"fault":"empty_response"}}]"""
        check(api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY).statusCode() == 200)
        assertThatThrownBy { api.send("DELETE", "/$tokenId") }.isInstanceOf(IOException::class.java)
        val derrubada = uuids(tokenId, "{}").first()

        assertThat(uuids(tokenId, answered("""["2xx"]"""))).containsExactly(ok, criada)
        assertThat(uuids(tokenId, answered("""["5xx"]"""))).containsExactly(erro, fora)
        assertThat(uuids(tokenId, answered("""["404"]"""))).containsExactly(ausente)
        assertThat(uuids(tokenId, answered("""["4xx","503"]"""))).containsExactly(ausente, fora)
        assertThat(uuids(tokenId, answered("""["302"]"""))).isEmpty()
        assertThat(uuids(tokenId, answered(EVERY_FAMILY))).containsExactly(ok, criada, ausente, erro, fora)
        assertThat(uuids(tokenId, """{"sorting":"oldest","answered":["2xx"],"match":{"method":["POST"]}}""")).containsExactly(criada)
        val segunda = found(tokenId, """{"sorting":"oldest","answered":["2xx","5xx"],"per_page":1,"page":2}""")
        assertThat(segunda["data"].toList().map { it["uuid"].asString() }).containsExactly(criada)
        assertThat(segunda["total"].asInt()).isEqualTo(4)
        assertThat(uuids(tokenId, answered("null"))).containsExactly(ok, criada, ausente, erro, fora, derrubada)
        assertThat(uuids(tokenId, answered("[]"))).containsExactly(ok, criada, ausente, erro, fora, derrubada)
    }

    @Test
    @DisplayName(
        "Dado mensagens gravadas pelo app antigo e por uma versão anterior, sem response, quando busca por qualquer família, " +
            "então responde 200 e não acha nenhuma delas",
    )
    fun search_answered_mensagemSemResponse_naoCasaNenhumaFamilia() {
        val tokenId = UUID.randomUUID().toString()
        val doPhp = UUID.randomUUID().toString()
        val anterior = UUID.randomUUID().toString()
        redis.opsForValue().set("token:$tokenId", phpToken(tokenId))
        redis.opsForHash<String, String>().putAll(
            "token:$tokenId:requests",
            mapOf(doPhp to phpMessage(tokenId, doPhp), anterior to messageBeforeResponse(tokenId, anterior)),
        )
        val nova = api.capture(tokenId)["uuid"].asString()

        assertThat(uuids(tokenId, answered(EVERY_FAMILY))).containsExactly(nova)
        assertThat(uuids(tokenId, answered("""["200"]"""))).containsExactly(nova)
        assertThat(uuids(tokenId, """{"sorting":"oldest"}""")).containsExactly(doPhp, anterior, nova)
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado um answered inválido, quando busca, então 422 na chave da lista ou do item")
    @CsvSource(
        delimiter = '|',
        quoteCharacter = '`',
        textBlock = """
        "5xx"              | answered   | The answered must be an array.
        503                | answered   | The answered must be an array.
        {"0":"5xx"}        | answered   | The answered must be an array.
        ["6xx"]            | answered.0 | The selected answered is invalid.
        ["5xx","99"]       | answered.1 | The selected answered is invalid.
        ["5XX"]            | answered.0 | The selected answered is invalid.
        ["600"]            | answered.0 | The selected answered is invalid.
        ["2xx",null,"404"] | answered.1 | The selected answered is invalid.
        [404]              | answered.0 | The selected answered is invalid.""",
    )
    fun search_answeredInvalido_deveResponder422(
        answered: String,
        key: String,
        message: String,
    ) {
        val response = search(api.tokenId(), """{"answered":$answered}""")

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response)).isEqualTo(api.tree("""{"$key":["$message"]}"""))
    }

    private fun phpToken(tokenId: String) =
        """{"uuid":"$tokenId","ip":"192.168.107.1","user_agent":"curl\/8.16.0","default_content":"olá",""" +
            """"default_status":200,"default_content_type":"text\/plain","timeout":0,"cors":false,""" +
            """"created_at":"2026-09-26 00:41:18","updated_at":"2026-09-26 00:41:18"}"""

    private fun phpMessage(
        tokenId: String,
        id: String,
    ) = """{"uuid":"$id","token_id":"$tokenId","ip":"192.168.107.1","hostname":"localhost","method":"PUT",""" +
        """"user_agent":"curl\/8.16.0","content":"{\"a\":1,\"b\":[1,2]}","query":{"q":"1"},""" +
        """"headers":{"content-length":["17"],"content-type":["application\/json"],"accept":["*\/*"],""" +
        """"user-agent":["curl\/8.16.0"],"host":["localhost:8084"]},""" +
        """"url":"http:\/\/localhost:8084\/$tokenId\/203\/x\/y?q=1","created_at":"2026-09-26 00:41:43","updated_at":"2026-09-26 00:41:43"}"""

    private fun messageBeforeResponse(
        tokenId: String,
        id: String,
    ) = """{"uuid":"$id","token_id":"$tokenId","ip":"10.0.0.1","hostname":"localhost","method":"GET","user_agent":null,""" +
        """"content":"","query":[],"headers":{},"url":"http://localhost/$tokenId","created_at":"2026-09-26 14:02:07",""" +
        """"updated_at":"2026-09-26 14:02:07","request":null,"rule":null,"near_miss":null,"signature":null,"schema":null}"""
}
