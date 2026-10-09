package anzol.e2ee

import anzol.privacy.SECRET_HEADER
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import com.nimbusds.jose.jwk.ECKey
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.json.JsonMapper
import java.util.UUID

@ApiTest
@DisplayName("O atributo decifrado só sai com o segredo de leitura")
class E2eePrivacyApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)
    private val secret = mapOf(SECRET_HEADER to READ_SECRET)
    private val sender = ecKey("remetente-sig-1")

    /** URL do laboratório com uma mensagem decifrada; devolve o id da URL e o da mensagem. */
    private fun decrypted(): Pair<String, String> {
        val tokenId = api.tokenId(json(mapOf("read_secret" to READ_SECRET, "e2ee" to policy(sender))))
        val key = api.json(api.send("POST", "/token/$tokenId/keys", """{"kid":"enc-v1"}""".toByteArray(), JSON_BODY + secret))
        val id = UUID.randomUUID().toString()
        val body = envelope(id, encrypt(ECKey.parse(key["jwk"].toString()), sign(sender, claims(id, mapOf("segredo" to "aberto")))))
        val response = api.send("POST", "/$tokenId", body.toByteArray(), mapOf("Content-Type" to "application/json"))
        return tokenId to response.headers().firstValue("X-Request-Id").orElseThrow()
    }

    @Test
    @DisplayName("Dado uma mensagem decifrada, quando o GET e a listagem com segredo a leem, então trazem decrypted")
    fun leitura_comSegredo_deveTrazerOAberto() {
        val (tokenId, requestId) = decrypted()

        val message = api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT + secret))
        val page = api.json(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT + secret))

        assertThat(message["decrypted"]["segredo"].asString()).isEqualTo("aberto")
        assertThat(page["data"][0]["decrypted"]["segredo"].asString()).isEqualTo("aberto")
    }

    @Test
    @DisplayName("Dado uma mensagem decifrada, quando o GET vem sem segredo, então 401")
    fun leitura_semSegredo_deveSer401() {
        val (tokenId, requestId) = decrypted()

        assertThat(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT).statusCode()).isEqualTo(401)
    }

    @Test
    @DisplayName("Dado um link só-leitura da mensagem decifrada, quando é aberto, então traz decryption e não traz decrypted")
    fun share_mensagemDecifrada_naoDeveTrazerOAberto() {
        val (tokenId, requestId) = decrypted()
        val link = api.json(api.send("POST", "/token/$tokenId/request/$requestId/share", "{}".toByteArray(), JSON_BODY + secret))

        val shared = api.send("GET", "/share/${link["id"].asString()}", headers = JSON_CLIENT)

        assertThat(api.json(shared)["decryption"]["state"].asString()).isEqualTo("valid")
        assertThat(api.json(shared).has("decrypted")).isFalse()
        assertThat(shared.body()).doesNotContain("aberto")
    }

    @Test
    @DisplayName(
        "Dado uma mensagem decifrada, quando um PUT remove o segredo sem e2ee, " +
            "então 422 em read_secret, nada muda e a mensagem continua abrindo com o segredo",
    )
    fun removerSegredo_comDecifrada_deveSer422() {
        val (tokenId, requestId) = decrypted()

        val response = api.send("PUT", "/token/$tokenId", """{"read_secret":null}""".toByteArray(), JSON_BODY + secret)

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response).propertyNames().toList()).containsExactly("read_secret")
        val token = api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT + secret))
        assertThat(token["protected"].asBoolean()).isTrue()
        assertThat(token["e2ee"].isNull).isFalse()
        val message = api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT + secret))
        assertThat(message["decrypted"]["segredo"].asString()).isEqualTo("aberto")
        assertThat(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT).statusCode()).isEqualTo(401)
    }

    @Test
    @DisplayName("Dado uma mensagem decifrada e a decifra desligada num PUT, quando outro PUT remove o segredo, então 422")
    fun removerSegredo_depoisDeDesligarADecifra_deveSer422() {
        val (tokenId, _) = decrypted()
        val off = api.send("PUT", "/token/$tokenId", """{"e2ee":null}""".toByteArray(), JSON_BODY + secret)

        val response = api.send("PUT", "/token/$tokenId", """{"read_secret":null}""".toByteArray(), JSON_BODY + secret)

        assertThat(off.statusCode()).isEqualTo(200)
        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT).statusCode()).isEqualTo(401)
    }

    @Test
    @DisplayName("Dado uma mensagem gravada pelo app antigo numa URL protegida, quando o PUT remove o segredo, então 200 e ela abre")
    fun removerSegredo_mensagemAntiga_deveRemover() {
        val tokenId = api.tokenId(json(mapOf("read_secret" to READ_SECRET)))
        val requestId = UUID.randomUUID().toString()
        val legacy =
            """{"uuid":"$requestId","token_id":"$tokenId","ip":"192.168.107.1","hostname":"localhost","method":"GET",""" +
                """"user_agent":null,"content":"","query":[],"headers":{"host":["localhost:8084"]},""" +
                """"url":"http:\/\/localhost:8084\/$tokenId","created_at":"2026-09-26 00:42:10","updated_at":"2026-09-26 00:42:10"}"""
        redis.opsForHash<String, String>().put("token:$tokenId:requests", requestId, legacy)

        val response = api.send("PUT", "/token/$tokenId", """{"read_secret":null}""".toByteArray(), JSON_BODY + secret)

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(api.json(response)["protected"].asBoolean()).isFalse()
        assertThat(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT).statusCode()).isEqualTo(200)
    }
}
