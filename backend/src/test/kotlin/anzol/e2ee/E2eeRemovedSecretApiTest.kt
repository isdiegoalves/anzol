package anzol.e2ee

import anzol.RequestId
import anzol.TokenId
import anzol.capture.CapturedRequest
import anzol.capture.RequestStore
import anzol.capture.highestSeq
import anzol.privacy.SECRET_HEADER
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import anzol.token.StoredToken
import anzol.token.TokenStore
import com.nimbusds.jose.jwk.ECKey
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.json.JsonMapper
import java.time.Instant
import java.util.UUID

@ApiTest
@DisplayName("A captura e o PUT que remove o segredo, em qualquer ordem, não deixam o valor decifrado sem segredo")
class E2eeRemovedSecretApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val tokens: TokenStore,
    private val requests: RequestStore,
) {
    private val api = ApiClient(port, jsonMapper)
    private val secret = mapOf(SECRET_HEADER to READ_SECRET)
    private val sender = ecKey("remetente-sig-1")

    /** URL protegida com a decifra ligada e uma mensagem decifrada: o token como estava e a mensagem gravada. */
    private fun decrypted(): Pair<StoredToken, CapturedRequest> {
        val tokenId = api.tokenId(json(mapOf("read_secret" to READ_SECRET, "e2ee" to policy(sender))))
        val key = api.json(api.send("POST", "/token/$tokenId/keys", """{"kid":"enc-v1"}""".toByteArray(), JSON_BODY + secret))
        val id = UUID.randomUUID().toString()
        val body = envelope(id, encrypt(ECKey.parse(key["jwk"].toString()), sign(sender, claims(id, mapOf("segredo" to "aberto")))))
        val response = api.send("POST", "/$tokenId", body.toByteArray(), mapOf("Content-Type" to "application/json"))
        val read = tokens.read(TokenId(UUID.fromString(tokenId))) ?: error("token $tokenId sumiu")
        val requestId = RequestId(UUID.fromString(response.headers().firstValue("X-Request-Id").orElseThrow()))
        return read to (requests.find(read.token, requestId) ?: error("mensagem $requestId sumiu"))
    }

    private fun removeSecret(tokenId: TokenId) {
        api.send("DELETE", "/token/$tokenId/request", headers = JSON_CLIENT + secret)
        val removed = api.send("PUT", "/token/$tokenId", """{"read_secret":null}""".toByteArray(), JSON_BODY + secret)
        assertThat(removed.statusCode()).isEqualTo(200)
    }

    @Test
    @DisplayName(
        "Dado uma captura que leu a URL ainda com segredo, quando ela grava depois de o segredo sair, " +
            "então a mensagem fica com decryption e sem decrypted",
    )
    fun captura_depoisDeRemoverOSegredo_naoDeveGravarODecifrado() {
        val (read, message) = decrypted()
        removeSecret(read.token.uuid)
        val late = message.copy(uuid = RequestId(UUID.randomUUID()), seq = null)

        requests.store(read.token, late, Instant.now())

        val opened = api.send("GET", "/token/${read.token.uuid}/request/${late.uuid}", headers = JSON_CLIENT)
        assertThat(opened.statusCode()).isEqualTo(200)
        assertThat(api.json(opened)["decryption"]["state"].asString()).isEqualTo("valid")
        assertThat(api.json(opened).has("decrypted")).isFalse()
        assertThat(opened.body()).doesNotContain("aberto")
    }

    @Test
    @DisplayName("Dado a captura atrasada já gravada sem o segredo, quando ela é regravada com a resposta, então segue sem decrypted")
    fun regravacao_depoisDeRemoverOSegredo_naoDeveGravarODecifrado() {
        val (read, message) = decrypted()
        removeSecret(read.token.uuid)
        val late = message.copy(uuid = RequestId(UUID.randomUUID()), seq = null)
        requests.store(read.token, late, Instant.now())

        requests.replace(read.token, late)

        val opened = api.send("GET", "/token/${read.token.uuid}/request/${late.uuid}", headers = JSON_CLIENT)
        assertThat(api.json(opened).has("decrypted")).isFalse()
    }

    @Test
    @DisplayName(
        "Dado uma mensagem decifrada gravada depois da leitura da URL, quando o token sem segredo é gravado, " +
            "então a troca não grava e a URL segue protegida",
    )
    fun trocaDoToken_comDecifradaChegadaDepois_naoDeveGravar() {
        val (read, message) = decrypted()
        val since = requests.highestSeq(read.token)
        requests.store(read.token, message.copy(uuid = RequestId(UUID.randomUUID()), seq = null), Instant.now())

        val replaced = tokens.replace(read, read.token.copy(readSecretHash = null, e2ee = null), decryptedAfter = since)

        assertThat(replaced).isFalse()
        assertThat(tokens.find(read.token.uuid)?.isProtected()).isTrue()
    }

    @Test
    @DisplayName("Dado nenhuma mensagem decifrada depois da leitura da URL, quando o token sem segredo é gravado, então grava")
    fun trocaDoToken_semDecifradaDepois_deveGravar() {
        val (read, message) = decrypted()
        requests.delete(read.token, message)
        val since = requests.highestSeq(read.token)
        requests.store(read.token, message.copy(uuid = RequestId(UUID.randomUUID()), seq = null, decrypted = null), Instant.now())

        val replaced = tokens.replace(read, read.token.copy(readSecretHash = null, e2ee = null), decryptedAfter = since)

        assertThat(replaced).isTrue()
    }
}
