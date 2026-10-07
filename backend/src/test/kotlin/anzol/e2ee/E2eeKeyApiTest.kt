package anzol.e2ee

import anzol.privacy.SECRET_HEADER
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

@ApiTest
@DisplayName("Chaves de cifra da URL e JWKS")
class E2eeKeyApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)
    private val secret = mapOf(SECRET_HEADER to READ_SECRET)

    private fun protectedToken(): String = api.tokenId(json(mapOf("read_secret" to READ_SECRET)))

    private fun createKey(
        tokenId: String,
        body: String = "{}",
    ) = api.send("POST", "/token/$tokenId/keys", body.toByteArray(), JSON_BODY + secret)

    private fun jwks(tokenId: String): JsonNode = api.json(api.send("GET", "/token/$tokenId/jwks.json", headers = JSON_CLIENT))

    private fun stored(tokenId: String): JsonNode = api.tree(redis.opsForValue().get("token:$tokenId").orEmpty())

    @Test
    @DisplayName("Dado uma URL, quando gera uma chave sem kid, então 201 com a pública, kid gerado, e a privada só no Redis")
    fun create_semKid_deveGerarPublica() {
        val tokenId = protectedToken()

        val response = createKey(tokenId)
        val key = api.json(response)

        assertThat(response.statusCode()).isEqualTo(201)
        assertThat(key["kid"].asString()).matches("enc-\\d{8}-[0-9a-f]{4}")
        assertThat(key["jwk"]["use"].asString()).isEqualTo("enc")
        assertThat(key["jwk"]["alg"].asString()).isEqualTo("ECDH-ES")
        assertThat(key["jwk"]["crv"].asString()).isEqualTo("P-256")
        assertThat(key["jwk"].has("d")).isFalse()
        assertThat(stored(tokenId)["e2ee_keys"][0]["jwk"].has("d")).isTrue()
        val view = api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT + secret))["e2ee_keys"]
        assertThat(view.toList()).containsExactly(key)
    }

    @Test
    @DisplayName("Dado uma URL protegida com duas chaves, quando lê o JWKS sem segredo, então 200 com as duas públicas")
    fun jwks_semSegredo_deveListarPublicas() {
        val tokenId = protectedToken()
        createKey(tokenId, """{"kid":"enc-v1"}""")
        createKey(tokenId, """{"kid":"enc-v2"}""")

        val keys = jwks(tokenId)["keys"]

        assertThat(keys.toList().map { it["kid"].asString() }).containsExactly("enc-v1", "enc-v2")
        assertThat(keys.toList().none { it.has("d") }).isTrue()
    }

    @Test
    @DisplayName("Dado duas chaves, quando gera a terceira, então 422 em keys")
    fun create_terceira_deveRecusar() {
        val tokenId = protectedToken()
        createKey(tokenId, """{"kid":"enc-v1"}""")
        createKey(tokenId, """{"kid":"enc-v2"}""")

        val response = createKey(tokenId, """{"kid":"enc-v3"}""")

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response).has("keys")).isTrue()
    }

    @Test
    @DisplayName("Dado um kid repetido ou com caractere fora do padrão, quando gera, então 422 em kid")
    fun create_kidInvalido_deveRecusar() {
        val tokenId = protectedToken()
        createKey(tokenId, """{"kid":"enc-v1"}""")

        val repeated = createKey(tokenId, """{"kid":"enc-v1"}""")
        val malformed = createKey(tokenId, """{"kid":"enc v1/2"}""")

        assertThat(listOf(repeated.statusCode(), malformed.statusCode())).containsOnly(422)
        assertThat(api.json(repeated).has("kid")).isTrue()
        assertThat(api.json(malformed).has("kid")).isTrue()
    }

    @Test
    @DisplayName("Dado uma chave, quando é apagada, então 204 e sai do JWKS; kid que não existe: 404")
    fun delete_chave_deveSairDoJwks() {
        val tokenId = protectedToken()
        createKey(tokenId, """{"kid":"enc-v1"}""")
        createKey(tokenId, """{"kid":"enc-v2"}""")

        val deleted = api.send("DELETE", "/token/$tokenId/keys/enc-v1", headers = JSON_CLIENT + secret)
        val missing = api.send("DELETE", "/token/$tokenId/keys/enc-v1", headers = JSON_CLIENT + secret)

        assertThat(deleted.statusCode()).isEqualTo(204)
        assertThat(missing.statusCode()).isEqualTo(404)
        assertThat(jwks(tokenId)["keys"].toList().map { it["kid"].asString() }).containsExactly("enc-v2")
    }

    @Test
    @DisplayName("Dado uma URL protegida, quando gera chave sem segredo, então 401 e nada é gerado")
    fun create_semSegredo_deveSer401() {
        val tokenId = protectedToken()

        val response = api.send("POST", "/token/$tokenId/keys", "{}".toByteArray(), JSON_BODY)

        assertThat(response.statusCode()).isEqualTo(401)
        assertThat(jwks(tokenId)["keys"].toList()).isEmpty()
    }

    @Test
    @DisplayName("Dado uma URL com chave, quando o PUT troca a configuração, então as chaves ficam")
    fun update_put_deveManterChaves() {
        val tokenId = protectedToken()
        createKey(tokenId, """{"kid":"enc-v1"}""")

        api.send("PUT", "/token/$tokenId", """{"default_status":201}""".toByteArray(), JSON_BODY + secret)

        assertThat(jwks(tokenId)["keys"].toList().map { it["kid"].asString() }).containsExactly("enc-v1")
    }

    @Test
    @DisplayName("Dado uma URL que não existe, quando lê o JWKS, então 410")
    fun jwks_urlInexistente_deveSer410() {
        val tokenId = protectedToken()
        api.send("DELETE", "/token/$tokenId", headers = JSON_CLIENT + secret)

        assertThat(api.send("GET", "/token/$tokenId/jwks.json", headers = JSON_CLIENT).statusCode()).isEqualTo(410)
    }
}
