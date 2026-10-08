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
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.util.UUID

@ApiTest
@DisplayName("Decifra do atributo na captura")
class E2eeReceiverApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)
    private val secret = mapOf(SECRET_HEADER to READ_SECRET)
    private val sender = ecKey("remetente-sig-1")
    private val data = mapOf("texto" to "Olá, ação concluída 🎉")

    /** URL protegida com a política do laboratório e uma chave de cifra; devolve o id e a pública da chave. */
    private fun lab(): Pair<String, ECKey> {
        val tokenId = api.tokenId(json(mapOf("read_secret" to READ_SECRET, "e2ee" to policy(sender))))
        val key = api.json(api.send("POST", "/token/$tokenId/keys", """{"kid":"enc-v1"}""".toByteArray(), JSON_BODY + secret))
        return tokenId to ECKey.parse(api.tree(key["jwk"].toString()).toString())
    }

    private fun post(
        tokenId: String,
        body: String,
    ): JsonNode {
        val response = api.send("POST", "/$tokenId", body.toByteArray(), mapOf("Content-Type" to "application/json"))
        val requestId = response.headers().firstValue("X-Request-Id").orElseThrow()
        return api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT + secret))
    }

    @Test
    @DisplayName("Dado o JWE do laboratório, quando chega, então grava decryption valid e decrypted, com o content como chegou")
    fun captura_jweValido_deveGravarAberto() {
        val (tokenId, public) = lab()
        val id = UUID.randomUUID().toString()
        val body = envelope(id, encrypt(public, sign(sender, claims(id, data))))

        val message = post(tokenId, body)

        assertThat(message["decryption"]["state"].asString()).isEqualTo("valid")
        assertThat(message["decryption"]["kid"].asString()).isEqualTo("enc-v1")
        assertThat(message["decryption"]["signature_kid"].asString()).isEqualTo("remetente-sig-1")
        assertThat(message["decryption"]["jti"].asString()).isEqualTo(id)
        assertThat(message["decryption"]["duplicate_of"].isNull).isTrue()
        assertThat(message["decrypted"]).isEqualTo(api.tree(json(data)))
        assertThat(message["content"].asString()).isEqualTo(body)
    }

    @Test
    @DisplayName("Dado a mesma mensagem entregue duas vezes, quando chega a segunda, então valid com duplicate_of da primeira")
    fun captura_reentrega_deveApontarAPrimeira() {
        val (tokenId, public) = lab()
        val id = UUID.randomUUID().toString()
        val body = envelope(id, encrypt(public, sign(sender, claims(id, data))))

        val first = post(tokenId, body)
        val second = post(tokenId, body)

        assertThat(second["decryption"]["state"].asString()).isEqualTo("valid")
        assertThat(second["decryption"]["duplicate_of"].asString()).isEqualTo(first["uuid"].asString())
        assertThat(redis.getExpire("token:$tokenId:e2ee:jti")).isPositive()
    }

    @Test
    @DisplayName("Dado um kid que a URL não tem, quando chega, então unknown_kid e nada aberto")
    fun captura_kidDesconhecido_deveGravarUnknownKid() {
        val (tokenId, _) = lab()
        val id = UUID.randomUUID().toString()

        val message = post(tokenId, envelope(id, encrypt(ecKey("enc-v9"), sign(sender, claims(id, data)))))

        assertThat(message["decryption"]["state"].asString()).isEqualTo("unknown_kid")
        assertThat(message["decryption"]["kid"].asString()).isEqualTo("enc-v9")
        assertThat(message.has("decrypted")).isFalse()
    }

    @Test
    @DisplayName("Dado uma URL sem e2ee, quando chega um JSON, então decryption null e sem decrypted")
    fun captura_semE2ee_deveSerNull() {
        val tokenId = api.tokenId()

        val message = api.capture(tokenId, method = "POST", body = """{"payload":"a.b.c.d.e"}""".toByteArray())

        assertThat(message["decryption"].isNull).isTrue()
        assertThat(message.has("decrypted")).isFalse()
    }

    @Test
    @DisplayName("Dado uma URL apagada, quando é apagada, então o hash de jti sai junto")
    fun delete_token_deveApagarOsJti() {
        val (tokenId, public) = lab()
        val id = UUID.randomUUID().toString()
        post(tokenId, envelope(id, encrypt(public, sign(sender, claims(id, data)))))

        api.send("DELETE", "/token/$tokenId", headers = JSON_CLIENT + secret)

        assertThat(redis.hasKey("token:$tokenId:e2ee:jti")).isFalse()
    }

    @Test
    @DisplayName("Dado data com decimal longo e inteiro grande, quando grava e lê a mensagem, então decrypted sai sem arredondar")
    fun captura_numerosExatos_naoDeveArredondar() {
        val (tokenId, public) = lab()
        val id = UUID.randomUUID().toString()
        val exact = """{"precise":0.1000000000000000055511151231257827,"big":123456789012345678901234567890}"""
        val claims = claims(id, null).also { it["data"] = anzol.e2ee.exactMapper.readTree(exact) }

        val message =
            api.send(
                "POST",
                "/$tokenId",
                envelope(id, encrypt(public, signExact(sender, claims))).toByteArray(),
                mapOf("Content-Type" to "application/json"),
            )
        val requestId = message.headers().firstValue("X-Request-Id").orElseThrow()
        val raw = api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT + secret).body()

        assertThat(raw).contains("0.1000000000000000055511151231257827", "123456789012345678901234567890")
    }
}
