package site.webhook.token

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.UUID

@ApiTest
@DisplayName("API de tokens")
class TokenApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName("Dado um POST sem campos, quando cria o token, então responde 201 com os padrões na ordem do app antigo")
    fun create_semCampos_deveResponder201ComPadroes() {
        val response = api.send("POST", "/token", headers = JSON_CLIENT + ("User-Agent" to "teste/1.0"))

        assertThat(response.statusCode()).isEqualTo(201)
        assertThat(response.headers().firstValue("Content-Type")).hasValue("application/json")
        val token = api.json(response)
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
        )
        assertThat(token["uuid"].asString()).matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}")
        assertThat(token["user_agent"].asString()).isEqualTo("teste/1.0")
        assertThat(token["default_content"].asString()).isEmpty()
        assertThat(token["default_status"].asInt()).isEqualTo(200)
        assertThat(token["default_content_type"].asString()).isEqualTo("text/plain")
        assertThat(token["timeout"].asInt()).isZero()
        assertThat(token["cors"].asBoolean()).isFalse()
        assertThat(token["retry_after"].isNull).isTrue()
        assertThat(token["auto_cleanup"].isNull).isTrue()
        assertThat(token["signature"].isNull).isTrue()
        assertThat(token["created_at"].asString()).matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}")
        assertThat(token["updated_at"]).isEqualTo(token["created_at"])
    }

    @Test
    @DisplayName("Dado campos no formulário e na query, quando cria o token, então a query vence e os números viram inteiros")
    fun create_formularioEQuery_deveLerQueryPrimeiro() {
        val response =
            api.send(
                "POST",
                "/token?default_status=204&timeout=3",
                "default_status=203&timeout=1&default_content=form".toByteArray(),
                JSON_CLIENT + ("Content-Type" to "application/x-www-form-urlencoded"),
            )

        val token = api.json(response)
        assertThat(token["default_status"].isInt).isTrue()
        assertThat(token["default_status"].asInt()).isEqualTo(204)
        assertThat(token["timeout"].asInt()).isEqualTo(3)
        assertThat(token["default_content"].asString()).isEqualTo("form")
    }

    @ParameterizedTest(name = "{0} → {1}")
    @DisplayName("Dado um campo inválido, quando cria o token, então responde 422 com a mensagem do Laravel")
    @CsvSource(
        delimiter = '|',
        textBlock = """
        {"timeout":11}                  | {"timeout":["The timeout may not be greater than 10."]}
        {"timeout":"11"}                | {"timeout":["The timeout may not be greater than 10."]}
        {"timeout":-1}                  | {"timeout":["The timeout must be at least 0."]}
        {"timeout":1.5}                 | {"timeout":["The timeout must be an integer."]}
        {"timeout":null}                | {"timeout":["The timeout must be an integer."]}
        {"timeout":"abcdefghijklmnop"}  | {"timeout":["The timeout must be an integer.","The timeout may not be greater than 10."]}
        {"default_status":"abc"}        | {"default_status":["The default status must be an integer."]}
        {"default_status":99999999999999999999} | {"default_status":["The default status must be an integer."]}
        {"default_status":9223372036854775808}  | {"default_status":["The default status must be an integer."]}
        {"timeout":99999999999999999999} | {"timeout":["The timeout must be an integer.","The timeout may not be greater than 10."]}
        {"default_content":123}         | {"default_content":["The default content must be a string."]}
        {"default_content_type":{"a":1}}| {"default_content_type":["The default content type must be a string."]}""",
    )
    fun create_campoInvalido_deveResponder422(
        body: String,
        errors: String,
    ) {
        val response = api.send("POST", "/token", body.toByteArray(), JSON_BODY)

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response)).isEqualTo(api.tree(errors))
    }

    @ParameterizedTest(name = "timeout {0} → {1}")
    @DisplayName("Dado um timeout no limite ou em branco, quando cria o token, então aceita e grava o inteiro")
    @CsvSource("'0', 0", "'10', 10", "'\"\"', 0", "'\" 5 \"', 5", "'true', 1")
    fun create_timeoutDeBorda_deveAceitar(
        timeout: String,
        expected: Int,
    ) {
        val token = api.createToken("""{"timeout":$timeout}""")

        assertThat(token["timeout"].asInt()).isEqualTo(expected)
    }

    @Test
    @DisplayName("Dado um cliente que não pede JSON, quando a validação falha, então redireciona 302 para o Referer")
    fun create_clienteHtmlInvalido_deveRedirecionar() {
        val comReferer =
            api.send(
                "POST",
                "/token",
                "timeout=11".toByteArray(),
                mapOf("Referer" to "http://exemplo.test/x?y", "Content-Type" to "application/x-www-form-urlencoded"),
            )
        val semReferer = api.send("POST", "/token", """{"timeout":11}""".toByteArray(), mapOf("Content-Type" to "application/json"))

        assertThat(comReferer.statusCode()).isEqualTo(302)
        assertThat(comReferer.headers().firstValue("Location")).hasValue("http://exemplo.test/x?y")
        assertThat(semReferer.statusCode()).isEqualTo(302)
        assertThat(semReferer.headers().firstValue("Location")).hasValue(api.base)
    }

    @Test
    @DisplayName("Dado um token, quando é editado, então campo ausente volta ao padrão e cors, ip e datas ficam")
    fun update_campoAusente_deveVoltarAoPadrao() {
        val token = api.createToken("""{"default_content":"x","default_status":201,"default_content_type":"application/xml","timeout":1}""")
        val id = token["uuid"].asString()
        api.send("PUT", "/token/$id/cors/toggle", headers = JSON_CLIENT)

        val edited = api.json(api.send("PUT", "/token/$id", """{"default_content":"novo"}""".toByteArray(), JSON_BODY))

        assertThat(edited["default_content"].asString()).isEqualTo("novo")
        assertThat(edited["default_status"].asInt()).isEqualTo(200)
        assertThat(edited["default_content_type"].asString()).isEqualTo("text/plain")
        assertThat(edited["timeout"].asInt()).isZero()
        assertThat(edited["cors"].asBoolean()).isTrue()
        assertThat(edited["updated_at"]).isEqualTo(token["updated_at"])
        assertThat(api.json(api.send("GET", "/token/$id", headers = JSON_CLIENT))).isEqualTo(edited)
    }

    @Test
    @DisplayName("Dado um token com CORS desligado, quando o toggle é chamado duas vezes, então liga e depois desliga")
    fun toggleCors_duasVezes_deveLigarEDesligar() {
        val id = api.tokenId()

        val first = api.json(api.send("PUT", "/token/$id/cors/toggle", headers = JSON_CLIENT))
        val second = api.json(api.send("PUT", "/token/$id/cors/toggle", headers = JSON_CLIENT))

        assertThat(first).isEqualTo(api.tree("""{"enabled":true}"""))
        assertThat(second).isEqualTo(api.tree("""{"enabled":false}"""))
    }

    @Test
    @DisplayName("Dado um token apagado, quando a API é chamada, então responde 204 sem corpo e depois 410")
    fun delete_tokenExistente_deveResponder204EDepois410() {
        val id = api.tokenId()

        val deleted = api.send("DELETE", "/token/$id", headers = JSON_CLIENT)
        val after = api.send("GET", "/token/$id", headers = JSON_CLIENT)

        assertThat(deleted.statusCode()).isEqualTo(204)
        assertThat(deleted.body()).isEmpty()
        assertThat(after.statusCode()).isEqualTo(410)
        assertThat(api.json(after)).isEqualTo(api.tree("""{"success":false,"error":{"message":"Token not found","id":null}}"""))
    }

    /** O token e as três chaves das mensagens dele, na ordem de `RedisKeys`. */
    private fun keysOf(tokenId: String) =
        listOf("token:$tokenId", "token:$tokenId:requests", "token:$tokenId:requests:index", "token:$tokenId:requests:seq")

    @Nested
    @DisplayName("Chaves no Redis depois de apagar a URL")
    inner class DeleteKeys {
        @Test
        @DisplayName("Dado uma URL com mensagens, quando é apagada, então o token, a hash, o índice e o seq deixam de existir")
        fun delete_urlComMensagens_deveApagarAsQuatroChaves() {
            val tokenId = api.tokenId()
            repeat(3) { api.send("GET", "/$tokenId") }
            assertThat(redis.countExistingKeys(keysOf(tokenId))).isEqualTo(4)

            val deleted = api.send("DELETE", "/token/$tokenId", headers = JSON_CLIENT)

            assertThat(deleted.statusCode()).isEqualTo(204)
            assertThat(keysOf(tokenId).filter { redis.hasKey(it) }).isEmpty()
        }

        @Test
        @DisplayName("Dado uma hash antiga sem índice e uma mensagem que fez o backfill, quando apaga a URL, então nenhuma chave fica")
        fun delete_hashAntigaComBackfill_deveApagarAsQuatroChaves() {
            val tokenId = seedLegacy()
            api.send("GET", "/$tokenId")
            assertThat(redis.opsForZSet().size("token:$tokenId:requests:index")).isEqualTo(2)

            api.send("DELETE", "/token/$tokenId", headers = JSON_CLIENT)

            assertThat(keysOf(tokenId).filter { redis.hasKey(it) }).isEmpty()
        }

        @Test
        @DisplayName("Dado uma hash antiga nunca lida (sem índice nem seq), quando apaga a URL, então a hash sai junto com o token")
        fun delete_hashAntigaSemIndice_deveApagarAHash() {
            val tokenId = seedLegacy()

            api.send("DELETE", "/token/$tokenId", headers = JSON_CLIENT)

            assertThat(keysOf(tokenId).filter { redis.hasKey(it) }).isEmpty()
        }

        /** Token e uma mensagem gravados pelo app antigo: só `token:{uuid}` e a hash, sem índice nem seq. */
        private fun seedLegacy(): String {
            val tokenId = UUID.randomUUID().toString()
            val requestId = UUID.randomUUID().toString()
            val week = Duration.ofDays(7)
            redis.opsForValue().set(
                "token:$tokenId",
                """{"uuid":"$tokenId","ip":"1.1.1.1","user_agent":null,"default_content":"","default_status":200,""" +
                    """"default_content_type":"text\/plain","timeout":0,""" +
                    """"created_at":"2025-12-01 00:00:00","updated_at":"2025-12-01 00:00:00"}""",
                week,
            )
            redis.opsForHash<String, String>().put(
                "token:$tokenId:requests",
                requestId,
                """{"uuid":"$requestId","token_id":"$tokenId","ip":"1.1.1.1","hostname":"localhost","method":"GET",""" +
                    """"user_agent":null,"content":"","query":null,"headers":{"host":["localhost"]},""" +
                    """"url":"http:\/\/localhost\/$tokenId","created_at":"2025-12-31 23:59:59",""" +
                    """"updated_at":"2025-12-31 23:59:59","request":null}""",
            )
            redis.expire("token:$tokenId:requests", week)
            return tokenId
        }
    }
}
