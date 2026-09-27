package site.webhook.search

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val SECRET = "segredo-do-github"
private const val SCHEMA =
    """{"type":"object","required":["id"],"properties":{"id":{"type":"integer"},"itens":{"items":{"type":"string"}}}}"""

@ApiTest
@DisplayName("Busca pelo motivo exato da assinatura e pelo caminho do schema")
class SearchReasonApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun search(
        tokenId: String,
        body: String,
    ) = api.send("POST", "/token/$tokenId/requests/search", body.toByteArray(), JSON_BODY)

    private fun uuids(
        tokenId: String,
        body: String,
    ): List<String> = api.json(search(tokenId, body))["data"].toList().map { it["uuid"].asString() }

    private fun signed(body: String): String =
        "sha256=" +
            HexFormat.of().formatHex(
                Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(SECRET.toByteArray(), "HmacSHA256")) }.doFinal(body.toByteArray()),
            )

    private fun capture(
        tokenId: String,
        body: String,
        headers: Map<String, String> = emptyMap(),
    ): JsonNode = api.capture(tokenId, "POST", body = body.toByteArray(), headers = headers + ("Content-Type" to "application/json"))

    @Test
    @DisplayName("Dado mensagens com e sem assinatura e com erros de schema, quando busca por motivo e caminho, então acha só as exatas")
    fun search_motivoECaminho_deveAcharAsExatas() {
        val tokenId = api.tokenId("""{"signature":{"provider":"github","secret":"$SECRET"},"schema":$SCHEMA}""")
        val valida = capture(tokenId, """{"id":1}""", mapOf("X-Hub-Signature-256" to signed("""{"id":1}""")))["uuid"].asString()
        val ausente = capture(tokenId, """{"id":"x"}""")["uuid"].asString()
        val errada = capture(tokenId, """{"itens":[1]}""", mapOf("X-Hub-Signature-256" to signed("outro")))["uuid"].asString()

        assertThat(uuids(tokenId, """{"signature_reason":"header X-Hub-Signature-256 absent"}""")).containsExactly(ausente)
        assertThat(uuids(tokenId, """{"signature_reason":"signature mismatch"}""")).containsExactly(errada)
        assertThat(uuids(tokenId, """{"signature_reason":"mismatch"}""")).isEmpty()
        assertThat(uuids(tokenId, """{"schema_path":"/id"}""")).containsExactly(ausente)
        assertThat(uuids(tokenId, """{"schema_path":""}""")).containsExactly(errada)
        assertThat(uuids(tokenId, """{"schema_path":"/itens/0"}""")).containsExactly(errada)
        assertThat(uuids(tokenId, """{"schema_path":"/id","signature_reason":"signature mismatch"}""")).isEmpty()
        assertThat(
            uuids(tokenId, """{"sorting":"oldest","signature_reason":null,"schema_path":null}"""),
        ).containsExactly(valida, ausente, errada)
    }

    @Test
    @DisplayName("Dado um motivo com detalhe entre parênteses no fim, quando busca pelo motivo sem ele ou com ele, então acha")
    fun search_motivoComDetalhe_deveCompararSemOParentese() {
        val tokenId = api.tokenId("""{"signature":{"provider":"stripe","secret":"whsec_abc","toleranceSeconds":60}}""")
        val stripe =
            HexFormat.of().formatHex(
                Mac
                    .getInstance(
                        "HmacSHA256",
                    ).apply { init(SecretKeySpec("whsec_abc".toByteArray(), "HmacSHA256")) }
                    .doFinal("1000.{}".toByteArray()),
            )
        val vencida = capture(tokenId, "{}", mapOf("Stripe-Signature" to "t=1000,v1=$stripe"))
        val reason = vencida["signature"]["reason"].asString()

        assertThat(reason).matches("timestamp outside tolerance \\(\\d+ s\\)")
        assertThat(uuids(tokenId, """{"signature_reason":"timestamp outside tolerance"}""")).containsExactly(vencida["uuid"].asString())
        assertThat(uuids(tokenId, """{"signature_reason":"$reason"}""")).containsExactly(vencida["uuid"].asString())
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado um valor inválido, quando busca, então 422 na chave do campo")
    @CsvSource(
        delimiter = '|',
        quoteCharacter = '`',
        textBlock = """
        {"signature_reason":42}          | signature_reason | The signature reason must be a string.
        {"signature_reason":""}          | signature_reason | The signature reason field is required.
        {"schema_path":["/id"]}          | schema_path      | The schema path must be a string.
        {"schema_path":"$.valor"}        | schema_path      | The schema path must be a JSON Pointer ("" or starting with /).
        {"schema_path":"/a~2"}           | schema_path      | The schema path must be a JSON Pointer ("" or starting with /).""",
    )
    fun search_valorInvalido_deveResponder422(
        body: String,
        key: String,
        message: String,
    ) {
        val response = search(api.tokenId(), body)

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response)[key][0].asString()).isEqualTo(message)
    }

    @Test
    @DisplayName("Dado valores acima dos tetos, quando busca, então 422 com o tamanho máximo")
    fun search_acimaDoTeto_deveResponder422() {
        val tokenId = api.tokenId()

        val reason = search(tokenId, """{"signature_reason":"${"a".repeat(201)}"}""")
        val path = search(tokenId, """{"schema_path":"/${"a".repeat(1000)}"}""")

        assertThat(
            api.json(reason)["signature_reason"][0].asString(),
        ).isEqualTo("The signature reason may not be greater than 200 characters.")
        assertThat(api.json(path)["schema_path"][0].asString()).isEqualTo("The schema path may not be greater than 1000 characters.")
    }
}
