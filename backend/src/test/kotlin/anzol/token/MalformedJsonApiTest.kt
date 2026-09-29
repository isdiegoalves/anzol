package anzol.token

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.json.JsonMapper

private const val CONFIGURED =
    """{"default_status":418,"default_content":"oi","timeout":2,"signature":{"provider":"github","secret":"segredo-gh"},""" +
        """"schema":{"type":"object"}}"""

/**
 * JSON malformado nas rotas que gravam a configuração da URL. O app antigo lia o corpo que não era JSON como entrada
 * vazia: o POST criava com os padrões e o PUT, que substitui a configuração inteira, voltava tudo aos padrões com 200.
 */
@ApiTest
@DisplayName("JSON malformado em POST e PUT /token")
class MalformedJsonApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun tokenKeys(): Set<String> = redis.keys("token:*").orEmpty()

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado um corpo JSON quebrado ou que não é objeto, quando cria a URL, então 400 e nenhuma URL é criada")
    @ValueSource(
        strings = ["{\"timeout\": 99", "{\"timeout\":1}}", "[1,2]", "\"texto\"", "42", "null", "{timeout:1}", "  x", "{\"timeout\":1} x"],
    )
    fun create_jsonMalformado_deveResponder400SemCriar(body: String) {
        val before = tokenKeys()

        val response = api.send("POST", "/token", body.toByteArray(), JSON_BODY)

        assertThat(response.statusCode()).`as`(response.body()).isEqualTo(400)
        assertThat(response.headers().firstValue("Content-Type")).hasValue("application/json")
        assertThat(api.json(response)["error"]["message"].asString()).isEqualTo("The body must be a valid JSON object.")
        assertThat(tokenKeys()).isEqualTo(before)
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado uma URL configurada, quando o PUT traz JSON quebrado, então 400 e a configuração fica como estava")
    @ValueSource(strings = ["{\"default_status\":201", "[1,2]", "null"])
    fun update_jsonMalformado_deveResponder400SemAlterar(body: String) {
        val tokenId = api.tokenId(CONFIGURED)
        val stored = redis.opsForValue().get("token:$tokenId")

        val response = api.send("PUT", "/token/$tokenId", body.toByteArray(), JSON_BODY)

        assertThat(response.statusCode()).`as`(response.body()).isEqualTo(400)
        assertThat(redis.opsForValue().get("token:$tokenId")).isEqualTo(stored)
        val token = api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))
        assertThat(token["default_status"].asInt()).isEqualTo(418)
        assertThat(token["signature"]["provider"].asString()).isEqualTo("github")
    }

    @Test
    @DisplayName("Dado só o Content-Type JSON, sem Accept, quando o corpo é quebrado, então 400 em JSON (e não 201 nem 302)")
    fun create_semAccept_deveResponder400EmJson() {
        val response = api.send("POST", "/token", "{\"timeout\": 99".toByteArray(), mapOf("Content-Type" to "application/json"))

        assertThat(response.statusCode()).isEqualTo(400)
        assertThat(api.json(response)["success"].asBoolean()).isFalse()
    }

    @Test
    @DisplayName("Dado corpo vazio, objeto vazio ou formulário, quando cria a URL, então continua aceito como sempre")
    fun create_corpoVazioOuFormulario_deveContinuarAceito() {
        val vazio = api.send("POST", "/token", headers = JSON_BODY)
        val branco = api.send("POST", "/token", "  \n".toByteArray(), JSON_BODY)
        val objeto = api.send("POST", "/token", "{}".toByteArray(), JSON_BODY)
        val formulario =
            api.send("POST", "/token", "timeout=3".toByteArray(), JSON_CLIENT + ("Content-Type" to "application/x-www-form-urlencoded"))
        val textoSemJson = api.send("POST", "/token", "{\"timeout\": 99".toByteArray(), JSON_CLIENT + ("Content-Type" to "text/plain"))

        assertThat(listOf(vazio, branco, objeto, formulario, textoSemJson).map { it.statusCode() }).containsOnly(201)
        assertThat(api.json(formulario)["timeout"].asInt()).isEqualTo(3)
    }
}
