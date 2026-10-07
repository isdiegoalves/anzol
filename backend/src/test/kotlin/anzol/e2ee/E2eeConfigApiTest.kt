package anzol.e2ee

import anzol.privacy.SECRET_HEADER
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import com.nimbusds.jose.jwk.Curve
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

@ApiTest
@DisplayName("Configuração da decifra (e2ee) na URL")
class E2eeConfigApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)
    private val withSecret = JSON_BODY + mapOf(SECRET_HEADER to READ_SECRET)
    private val signer = ecKey("remetente-sig-1")

    private fun create(fields: Map<String, Any?>) = api.send("POST", "/token", json(fields).toByteArray(), JSON_BODY)

    private fun protectedWith(e2ee: Any?) = create(mapOf("read_secret" to READ_SECRET, "e2ee" to e2ee))

    private fun put(
        tokenId: String,
        fields: Map<String, Any?>,
    ) = api.send("PUT", "/token/$tokenId", json(fields).toByteArray(), withSecret)

    private fun errors(e2ee: Any?): JsonNode {
        val response = protectedWith(e2ee)
        assertThat(response.statusCode()).isEqualTo(422)
        return api.json(response)
    }

    @Test
    @DisplayName("Dado um token protegido com e2ee, quando é criado e lido, então devolve o bloco com os padrões e só a pública")
    fun create_comE2ee_deveDevolverComPadroes() {
        val created = api.json(protectedWith(policy(signer, appIgnoreCase = false)))
        val tokenId = created["uuid"].asString()

        val e2ee = api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT + mapOf(SECRET_HEADER to READ_SECRET)))["e2ee"]

        assertThat(e2ee).isEqualTo(created["e2ee"])
        assertThat(e2ee["path"].asString()).isEqualTo("$.payload")
        assertThat(e2ee["required"].asBoolean()).isTrue()
        assertThat(e2ee["max_age_seconds"].asLong()).isEqualTo(43_200)
        assertThat(e2ee["bindings"]["app"].asString()).isEqualTo("$.servico.nome")
        assertThat(e2ee["trusted_signers"][0]["kid"].asString()).isEqualTo("remetente-sig-1")
        assertThat(e2ee["trusted_signers"][0].has("d")).isFalse()
        assertThat(api.tree(redis.opsForValue().get("token:$tokenId").orEmpty())["e2ee"]).isEqualTo(e2ee)
    }

    @Test
    @DisplayName("Dado um binding com ignore_case, quando é salvo, então volta como objeto com path e ignore_case")
    fun create_bindingSemCaixa_deveVoltarComoObjeto() {
        val app = api.json(protectedWith(policy(signer)))["e2ee"]["bindings"]["app"]

        assertThat(app).isEqualTo(api.tree("""{"path":"$.servico.nome","ignore_case":true}"""))
    }

    @Test
    @DisplayName("Dado um token sem e2ee, quando é criado, então e2ee é null")
    fun create_semE2ee_deveSerNull() {
        assertThat(api.createToken()["e2ee"].isNull).isTrue()
    }

    @Test
    @DisplayName("Dado e2ee sem segredo de leitura, quando cria, então 422 em e2ee")
    fun create_semSegredo_deveRecusar() {
        val response = create(mapOf("e2ee" to policy(signer)))

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response).has("e2ee")).isTrue()
    }

    @Test
    @DisplayName("Dado uma URL com e2ee, quando o PUT remove o segredo de leitura, então 422 e nada muda")
    fun update_removerSegredo_deveRecusar() {
        val tokenId = api.json(protectedWith(policy(signer)))["uuid"].asString()

        val response = put(tokenId, mapOf("read_secret" to null, "e2ee" to policy(signer)))

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.tree(redis.opsForValue().get("token:$tokenId").orEmpty())["read_secret_hash"].isNull).isFalse()
    }

    @Test
    @DisplayName("Dado uma URL com e2ee, quando o PUT vem sem e2ee, então a decifra é desligada")
    fun update_semE2ee_deveDesligar() {
        val tokenId = api.json(protectedWith(policy(signer)))["uuid"].asString()

        val edited = api.json(put(tokenId, emptyMap()))

        assertThat(edited["e2ee"].isNull).isTrue()
    }

    @Test
    @DisplayName("Dado um signatário com a parte privada d, quando cria, então 422 e a privada não é gravada")
    fun create_signatarioComD_deveRecusar() {
        val body = errors(policy(signer.toJSONObject()))

        assertThat(body.has("e2ee.trusted_signers.0")).isTrue()
    }

    @Test
    @DisplayName("Dado um signatário com o ponto fora da curva, quando cria, então 422")
    fun create_pontoForaDaCurva_deveRecusar() {
        assertThat(errors(policy(offCurve(signer))).has("e2ee.trusted_signers.0")).isTrue()
    }

    @Test
    @DisplayName("Dado um signatário P-384, sem kid, com alg HS256 ou use enc, quando cria, então 422 em cada um")
    fun create_signatariosInvalidos_deveRecusarCadaUm() {
        val semKid = signer.toPublicJWK().toJSONObject() - "kid"
        val hs256 = signer.toPublicJWK().toJSONObject() + ("alg" to "HS256")
        val enc = signer.toPublicJWK().toJSONObject() + ("use" to "enc")

        val body = errors(policy(ecKey("p384", Curve.P_384), semKid, hs256, enc))

        assertThat((0..3).map { body.has("e2ee.trusted_signers.$it") }).containsOnly(true)
    }

    @Test
    @DisplayName("Dado dois signatários com o mesmo kid, quando cria, então 422 em trusted_signers")
    fun create_kidRepetido_deveRecusar() {
        assertThat(errors(policy(signer, ecKey("remetente-sig-1"))).has("e2ee.trusted_signers")).isTrue()
    }

    @Test
    @DisplayName("Dado um path com filtro, sem bindings ou sem audience, quando cria, então 422 em cada campo")
    fun create_camposInvalidos_deveRecusar() {
        val e2ee = policy(signer) + mapOf("path" to "$.itens[?(@.a)]", "bindings" to null, "audience" to "")

        val body = errors(e2ee)

        assertThat(body.has("e2ee.path")).isTrue()
        assertThat(body.has("e2ee.bindings")).isTrue()
        assertThat(body.has("e2ee.audience")).isTrue()
    }

    @Test
    @DisplayName("Dado max_age_seconds fora de 60 a 604800, quando cria, então 422")
    fun create_maxAgeForaDaFaixa_deveRecusar() {
        assertThat(errors(policy(signer) + ("max_age_seconds" to 30)).has("e2ee.max_age_seconds")).isTrue()
    }
}
