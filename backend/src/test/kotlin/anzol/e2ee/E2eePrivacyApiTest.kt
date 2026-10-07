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
import tools.jackson.databind.json.JsonMapper
import java.util.UUID

@ApiTest
@DisplayName("O atributo decifrado só sai com o segredo de leitura")
class E2eePrivacyApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
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
}
