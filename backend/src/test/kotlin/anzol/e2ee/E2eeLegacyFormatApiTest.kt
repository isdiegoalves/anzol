package anzol.e2ee

import anzol.privacy.SECRET_HEADER
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_CLIENT
import anzol.token.ReadSecretHash
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.UUID

@ApiTest
@DisplayName("URL com decifra gravada antes dos campos novos")
class E2eeLegacyFormatApiTest(
    @LocalServerPort port: Int,
    private val jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)
    private val secret = mapOf(SECRET_HEADER to READ_SECRET)
    private val tokenId = UUID.randomUUID().toString()
    private val requestId = UUID.randomUUID().toString()

    /** O token como a versão anterior o gravava: com chave de cifra e sem o registro de chaves apagadas. */
    private fun legacyToken(): String {
        val hash = jsonMapper.writeValueAsString(ReadSecretHash.of(READ_SECRET))
        val key = json(ecKey("enc-v1").toJSONObject())
        return """{"uuid":"$tokenId","ip":"1.1.1.1","user_agent":null,"default_content":"","default_status":200,""" +
            """"default_content_type":"text\/plain","timeout":0,"cors":false,"created_at":"2026-10-01 00:00:00",""" +
            """"updated_at":"2026-10-01 00:00:00","retry_after":null,"auto_cleanup":null,"signature":null,"schema":null,""" +
            """"read_secret_hash":$hash,"secret_version":1,"e2ee":${json(policy(ecKey("remetente-sig-1")))},""" +
            """"e2ee_keys":[{"kid":"enc-v1","created_at":"2026-10-01 00:00:00","jwk":$key}]}"""
    }

    /** A mensagem como a versão anterior a gravava: `decryption` com os seis campos de então. */
    private fun legacyMessage(): String =
        """{"uuid":"$requestId","token_id":"$tokenId","ip":"1.1.1.1","hostname":"localhost","method":"POST",""" +
            """"user_agent":null,"content":"{}","query":[],"headers":{"host":["localhost"]},""" +
            """"url":"http:\/\/localhost\/$tokenId","created_at":"2026-10-01 00:00:00","updated_at":"2026-10-01 00:00:00",""" +
            """"rule":null,"near_miss":null,"signature":null,"schema":null,"response":{"status":200},""" +
            """"decryption":{"state":"unknown_kid","kid":"enc-v0","signature_kid":null,"reason":null,"jti":null,"duplicate_of":null}}"""

    private fun seed() {
        redis.opsForValue().set("token:$tokenId", legacyToken(), Duration.ofDays(1))
        redis.opsForHash<String, String>().put("token:$tokenId:requests", requestId, legacyMessage())
    }

    @Test
    @DisplayName("Dado um token e uma mensagem no formato anterior, quando são lidos, então abrem e os campos novos vêm nulos")
    fun leitura_formatoAnterior_deveAbrir() {
        seed()

        val token = api.send("GET", "/token/$tokenId", headers = JSON_CLIENT + secret)
        val message = api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT + secret)

        assertThat(token.statusCode()).isEqualTo(200)
        assertThat(api.json(token)["e2ee_keys"][0]["kid"].asString()).isEqualTo("enc-v1")
        assertThat(message.statusCode()).isEqualTo(200)
        assertThat(api.json(message)["decryption"]["state"].asString()).isEqualTo("unknown_kid")
        assertThat(api.json(message)["decryption"]["kid_deleted_at"].isNull).isTrue()
        assertThat(api.json(message)["decryption"]["aud"].isNull).isTrue()
    }

    @Test
    @DisplayName("Dado um token no formato anterior, quando apaga a chave, então 204 e o registro começa com ela")
    fun apagarChave_formatoAnterior_deveRegistrar() {
        seed()

        val response = api.send("DELETE", "/token/$tokenId/keys/enc-v1", headers = JSON_CLIENT + secret)

        assertThat(response.statusCode()).isEqualTo(204)
        val stored = api.tree(redis.opsForValue().get("token:$tokenId").orEmpty())
        assertThat(stored["e2ee_deleted_keys"].toList().map { it["kid"].asString() }).containsExactly("enc-v1")
        assertThat(stored["e2ee_keys"]).isNull()
    }
}
