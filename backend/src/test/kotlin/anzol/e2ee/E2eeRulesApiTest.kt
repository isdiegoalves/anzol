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
import java.net.http.HttpResponse
import java.util.UUID

/** As regras do laboratório: kid desconhecido → 500 (o job retenta), falha de cifra → 400 (não retenta), o resto → 200. */
private const val LAB_RULES =
    """[{"name":"kid desconhecido","match":{"decryption":"unknown_kid"},"response":{"status":500}},""" +
        """{"name":"cifra inválida","match":{"decryption":"invalid"},"response":{"status":400}}]"""

@ApiTest
@DisplayName("Regras com match.decryption")
class E2eeRulesApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)
    private val secret = mapOf(SECRET_HEADER to READ_SECRET)
    private val sender = ecKey("remetente-sig-1")
    private val data = mapOf("ok" to true)

    private fun lab(rules: String = LAB_RULES): Pair<String, ECKey> {
        val tokenId = api.tokenId(json(mapOf("read_secret" to READ_SECRET, "e2ee" to policy(sender))))
        val key = api.json(api.send("POST", "/token/$tokenId/keys", """{"kid":"enc-v1"}""".toByteArray(), JSON_BODY + secret))
        api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY + secret)
        return tokenId to ECKey.parse(key["jwk"].toString())
    }

    private fun deliver(
        tokenId: String,
        payload: Any?,
        id: String = UUID.randomUUID().toString(),
    ): HttpResponse<String> =
        api.send("POST", "/$tokenId", envelope(id, payload).toByteArray(), mapOf("Content-Type" to "application/json"))

    private fun sealed(
        recipient: ECKey,
        id: String,
    ): String = encrypt(recipient, sign(sender, claims(id, data)))

    @Test
    @DisplayName("Dado as regras do laboratório, quando chega válida, kid desconhecido ou cifra inválida, então 200, 500 e 400")
    fun regras_laboratorio_devemResponderPorEstado() {
        val (tokenId, public) = lab()
        val id = UUID.randomUUID().toString()

        val valid = deliver(tokenId, sealed(public, id), id)
        val unknown = deliver(tokenId, sealed(ecKey("enc-v9"), id), id)
        val downgrade = deliver(tokenId, data)
        val forged = deliver(tokenId, encrypt(public, json(data)))

        assertThat(listOf(valid, unknown, downgrade, forged).map { it.statusCode() }).containsExactly(200, 500, 400, 400)
    }

    @Test
    @DisplayName("Dado uma regra que espera valid, quando a decifra falha, então o near_miss diz o estado e o motivo")
    fun regras_nearMiss_deveDizerOMotivo() {
        val (tokenId, _) = lab("""[{"name":"só válidas","match":{"decryption":"valid"},"response":{"status":202}}]""")

        val requestId = deliver(tokenId, data).headers().firstValue("X-Request-Id").orElseThrow()
        val message = api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT + secret))

        assertThat(message["near_miss"]["failed"][0].asString()).isEqualTo("decryption: expected valid, got invalid (downgrade)")
        assertThat(message["near_miss"]["conditions"][0].asString()).isEqualTo("match.decryption")
    }

    @Test
    @DisplayName("Dado uma URL sem e2ee, quando a regra espera unknown_kid, então não casa: got not configured")
    fun regras_semE2ee_naoDevemCasar() {
        val tokenId = api.tokenId()
        api.send("PUT", "/token/$tokenId/rules", LAB_RULES.toByteArray(), JSON_BODY)

        val message = api.capture(tokenId, method = "POST", body = "{}".toByteArray())

        assertThat(message["rule"].isNull).isTrue()
        assertThat(message["near_miss"]["failed"][0].asString()).isEqualTo("decryption: expected unknown_kid, got not configured")
    }

    @Test
    @DisplayName("Dado match.decryption com valor desconhecido, quando salva as regras, então 422 em 0.match.decryption")
    fun regras_valorInvalido_deveRecusar() {
        val tokenId = api.tokenId()

        val response = api.send("PUT", "/token/$tokenId/rules", """[{"match":{"decryption":"ok"}}]""".toByteArray(), JSON_BODY)

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response).has("0.match.decryption")).isTrue()
    }
}
