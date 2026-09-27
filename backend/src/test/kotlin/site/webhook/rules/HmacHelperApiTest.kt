package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.json.JsonMapper
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val SECRET = "segredo-hmac-da-url"

@ApiTest
@DisplayName("Helper hmac nas respostas de regra, com o segredo de verificação da URL")
class HmacHelperApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun hmacSha256(value: String): String =
        HexFormat.of().formatHex(
            Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(SECRET.toByteArray(), "HmacSHA256")) }.doFinal(value.toByteArray()),
        )

    private fun putRules(
        tokenId: String,
        rules: String,
    ) = api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY)

    @Test
    @DisplayName(
        "Dado uma URL com segredo e uma regra com {{hmac request.body}}, quando o webhook chega, então corpo e cabeçalho vêm assinados",
    )
    fun capture_hmac_deveAssinarComOSegredoDaUrl() {
        val tokenId = api.tokenId("""{"signature":{"provider":"github","secret":"$SECRET"}}""")
        val saved =
            putRules(
                tokenId,
                """[{"name":"assina","response":{"template":true,"body":"{{hmac request.body}}",""" +
                    """"headers":{"X-Assinatura":"sha256={{hmac request.body}}"}}}]""",
            )

        val response = api.send("POST", "/$tokenId", """{"ok":true}""".toByteArray())

        assertThat(saved.statusCode()).`as`(saved.body()).isEqualTo(200)
        assertThat(response.body()).isEqualTo(hmacSha256("""{"ok":true}"""))
        assertThat(response.headers().firstValue("X-Assinatura")).hasValue("sha256=" + hmacSha256("""{"ok":true}"""))
        assertThat(saved.body()).doesNotContain(SECRET)
    }

    @Test
    @DisplayName("Dado uma URL sem verificação de assinatura, quando o webhook chega, então o trecho do hmac sai vazio")
    fun capture_semSegredo_deveSairVazio() {
        val tokenId = api.tokenId()
        putRules(tokenId, """[{"name":"assina","response":{"template":true,"body":"[{{hmac request.body}}]"}}]""")

        assertThat(api.send("POST", "/$tokenId", "x".toByteArray()).body()).isEqualTo("[]")
    }

    @Test
    @DisplayName("Dado algoritmo inválido, quando salva ou testa, então 422 com linha e coluna e sem o segredo")
    fun salvarETestar_algoritmoInvalido_deveResponder422() {
        val tokenId = api.tokenId("""{"signature":{"provider":"github","secret":"$SECRET"}}""")
        val rule = """{"name":"assina","response":{"template":true,"body":"{{hmac request.body algorithm=\"md5\"}}"}}"""

        val saved = putRules(tokenId, "[$rule]")
        val tested = api.send("POST", "/token/$tokenId/rules/test", rule.toByteArray(), JSON_BODY)

        val expected =
            "The template is invalid: hmac algorithm must be one of sha1, sha256, sha512 (line 1, column 2)."
        assertThat(saved.statusCode()).isEqualTo(422)
        assertThat(api.json(saved)).isEqualTo(api.tree("""{"0.response.body":["$expected"]}"""))
        assertThat(tested.statusCode()).isEqualTo(422)
        assertThat(api.json(tested)).isEqualTo(api.tree("""{"response.body":["$expected"]}"""))
        assertThat(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT).body()).doesNotContain(SECRET)
    }
}
