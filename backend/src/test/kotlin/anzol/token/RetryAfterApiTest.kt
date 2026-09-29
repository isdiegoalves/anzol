package anzol.token

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.json.JsonMapper
import java.util.UUID

private const val HTTP_DATE = "Sun, 06 Nov 1994 08:49:37 GMT"
private const val INVALID_MESSAGE = """{"retry_after":["The retry after must be a number of seconds or an HTTP date."]}"""

@ApiTest
@DisplayName("Retry-After por URL")
class RetryAfterApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun retryAfterOf(
        tokenId: String,
        suffix: String = "",
    ) = api.send("GET", "/$tokenId$suffix").headers().firstValue("Retry-After")

    @ParameterizedTest(name = "{0} → {1}")
    @DisplayName("Dado retry_after em segundos (número ou string), quando cria o token, então grava o inteiro e manda o cabeçalho")
    @CsvSource(delimiter = '|', value = ["120 | 120", "'\"120\"' | 120", "0 | 0", "'\"007\"' | 7"])
    fun create_segundos_deveGravarInteiroEResponderComCabecalho(
        sent: String,
        expected: Long,
    ) {
        val token = api.createToken("""{"retry_after":$sent}""")

        assertThat(token["retry_after"].isIntegralNumber).isTrue()
        assertThat(token["retry_after"].asLong()).isEqualTo(expected)
        assertThat(retryAfterOf(token["uuid"].asString())).hasValue(expected.toString())
    }

    @Test
    @DisplayName("Dado retry_after como data HTTP, quando cria o token, então grava a string e o webhook manda a data")
    fun create_dataHttp_deveGravarStringEResponderComCabecalho() {
        val token = api.createToken("""{"retry_after":"$HTTP_DATE"}""")

        assertThat(token["retry_after"].asString()).isEqualTo(HTTP_DATE)
        assertThat(retryAfterOf(token["uuid"].asString())).hasValue(HTTP_DATE)
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado um status qualquer (pelo caminho ou padrão), quando o token tem retry_after, então toda resposta leva o cabeçalho")
    @ValueSource(strings = ["/429", "/503", "/301", "/204", "/304", ""])
    fun capture_qualquerStatus_deveLevarCabecalho(suffix: String) {
        val tokenId = api.tokenId("""{"retry_after":30,"default_status":200}""")

        val response = api.send("GET", "/$tokenId$suffix")

        assertThat(response.statusCode()).isEqualTo(if (suffix.isEmpty()) 200 else suffix.drop(1).toInt())
        assertThat(response.headers().firstValue("Retry-After")).hasValue("30")
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado retry_after ausente, nulo ou em branco, quando cria o token, então fica null e não há cabeçalho")
    @ValueSource(strings = ["{}", """{"retry_after":null}""", """{"retry_after":""}""", """{"retry_after":"  "}"""])
    fun create_semRetryAfter_naoDeveMandarCabecalho(body: String) {
        val response = api.send("POST", "/token", body.toByteArray(), JSON_BODY)
        val token = api.json(response)

        assertThat(response.statusCode()).isEqualTo(201)
        assertThat(token.has("retry_after")).isTrue()
        assertThat(token["retry_after"].isNull).isTrue()
        assertThat(retryAfterOf(token["uuid"].asString(), "/429")).isEmpty()
    }

    @Test
    @DisplayName("Dado um token com retry_after, quando o PUT troca e depois omite o campo, então o cabeçalho muda e depois some")
    fun update_retryAfter_deveTrocarEDepoisVoltarAoPadrao() {
        val tokenId = api.tokenId("""{"retry_after":10}""")

        val changed = api.json(api.send("PUT", "/token/$tokenId", """{"retry_after":"$HTTP_DATE"}""".toByteArray(), JSON_BODY))
        val afterChange = retryAfterOf(tokenId, "/503")
        val cleared = api.json(api.send("PUT", "/token/$tokenId", """{"default_status":503}""".toByteArray(), JSON_BODY))
        val afterClear = retryAfterOf(tokenId)

        assertThat(changed["retry_after"].asString()).isEqualTo(HTTP_DATE)
        assertThat(afterChange).hasValue(HTTP_DATE)
        assertThat(cleared["retry_after"].isNull).isTrue()
        assertThat(afterClear).isEmpty()
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado retry_after inválido, quando cria ou edita o token, então responde 422 no formato do Laravel e não grava")
    @ValueSource(
        strings = [
            "\"abc\"", "-1", "1.5", "true", "[1]", "{\"a\":1}", "\"-1\"", "\" 120\"", "99999999999999999999",
            "\"Mon, 06 Nov 1994 08:49:37 GMT\"", "\"Tue, 31 Feb 1994 08:49:37 GMT\"", "\"Sunday, 06-Nov-94 08:49:37 GMT\"",
        ],
    )
    fun createEUpdate_valorInvalido_deveResponder422(value: String) {
        val tokenId = api.tokenId("""{"retry_after":5}""")

        val created = api.send("POST", "/token", """{"retry_after":$value}""".toByteArray(), JSON_BODY)
        val updated = api.send("PUT", "/token/$tokenId", """{"retry_after":$value}""".toByteArray(), JSON_BODY)

        assertThat(created.statusCode()).isEqualTo(422)
        assertThat(api.json(created)).isEqualTo(api.tree(INVALID_MESSAGE))
        assertThat(updated.statusCode()).isEqualTo(422)
        assertThat(api.json(updated)).isEqualTo(api.tree(INVALID_MESSAGE))
        assertThat(retryAfterOf(tokenId)).hasValue("5")
    }

    @Test
    @DisplayName("Dado um token gravado antes do campo existir, quando é lido, então retry_after é null e não há cabeçalho")
    fun capture_tokenSemOCampoNoRedis_naoDeveMandarCabecalho() {
        val tokenId = UUID.randomUUID().toString()
        redis.opsForValue().set(
            "token:$tokenId",
            """{"uuid":"$tokenId","ip":"1.1.1.1","user_agent":null,"default_content":"","default_status":200,""" +
                """"default_content_type":"text/plain","timeout":0,"cors":false,""" +
                """"created_at":"2026-09-26 00:41:18","updated_at":"2026-09-26 00:41:18"}""",
        )

        val token = api.json(api.send("GET", "/token/$tokenId"))

        assertThat(token["retry_after"].isNull).isTrue()
        assertThat(retryAfterOf(tokenId, "/429")).isEmpty()
    }
}
