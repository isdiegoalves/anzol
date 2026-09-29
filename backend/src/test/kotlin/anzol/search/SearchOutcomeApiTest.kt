package anzol.search

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.util.UUID

@ApiTest
@DisplayName("Busca por desfecho (outcome)")
class SearchOutcomeApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun search(
        tokenId: String,
        body: String,
    ) = api.send("POST", "/token/$tokenId/requests/search", body.toByteArray(), JSON_BODY)

    private fun uuids(page: JsonNode): List<String> = page["data"].toList().map { it["uuid"].asString() }

    @Test
    @DisplayName("Dado mensagens respondidas por regra, com near miss e sem regras, quando busca por cada desfecho, então acha só as dele")
    fun search_outcome_deveFiltrarPeloDesfechoGravado() {
        val tokenId = api.tokenId()
        val antes = api.capture(tokenId)["uuid"].asString()
        val saved =
            api.json(
                api.send(
                    "PUT",
                    "/token/$tokenId/rules",
                    """[{"name":"pix","match":{"method":["POST"]}}]""".toByteArray(),
                    JSON_BODY,
                ),
            )
        val pix = saved[0]["id"].asString()
        val respondida = api.capture(tokenId, "POST")["uuid"].asString()
        val quase = api.capture(tokenId)["uuid"].asString()

        val porRegra = api.json(search(tokenId, """{"sorting":"oldest","outcome":{"type":"rule","rule":"$pix"}}"""))
        val porQuase = api.json(search(tokenId, """{"sorting":"oldest","outcome":{"type":"near_miss","rule":"${pix.uppercase()}"}}"""))
        val padrao = api.json(search(tokenId, """{"sorting":"oldest","outcome":{"type":"default"},"match":{"method":["GET"]}}"""))

        assertThat(uuids(porRegra)).containsExactly(respondida)
        assertThat(uuids(porQuase)).containsExactly(quase)
        assertThat(uuids(padrao)).containsExactly(antes, quase)
        assertThat(padrao["total"].asInt()).isEqualTo(2)
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado um outcome inválido, quando busca, então 422 com a chave em pontos")
    @CsvSource(
        delimiter = '|',
        quoteCharacter = '`',
        textBlock = """
        {}                                        | outcome.type | The outcome.type field is required.
        {"type":"RULE","rule":"@ID"}              | outcome.type | The selected outcome.type is invalid.
        {"type":"rule"}                           | outcome.rule | The outcome.rule field is required.
        {"type":"near_miss","rule":"abc"}         | outcome.rule | The outcome.rule must be a valid UUID.
        {"type":"default","rule":"@ID"}           | outcome.rule | The outcome.rule field is prohibited.
        "default"                                 | outcome      | The outcome must be an object.""",
    )
    fun search_outcomeInvalido_deveResponder422(
        outcome: String,
        key: String,
        message: String,
    ) {
        val response = search(api.tokenId(), """{"outcome":${outcome.replace("@ID", UUID.randomUUID().toString())}}""")

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response)).isEqualTo(api.tree("""{"$key":["$message"]}"""))
    }
}
