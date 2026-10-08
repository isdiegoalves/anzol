package anzol.e2ee.lab

import anzol.e2ee.ecKey
import anzol.e2ee.json
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
import java.net.http.HttpResponse

private const val DAY_SECONDS = 86_400L

@ApiTest
@DisplayName("URL de laboratório E2EE")
class LabApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun create(body: Map<String, Any?> = emptyMap()): HttpResponse<String> =
        api.send("POST", "/e2ee-lab", json(body).toByteArray(), JSON_BODY)

    private fun created(body: Map<String, Any?> = emptyMap()): JsonNode = api.json(create(body))

    private fun delete(lab: JsonNode) =
        api.send(
            "DELETE",
            "/token/${lab["token"]["uuid"].asString()}",
            headers = JSON_CLIENT + mapOf(SECRET_HEADER to lab["read_secret"].asString()),
        )

    @Test
    @DisplayName(
        "Dado um POST sem campos, quando cria, então 201 com segredos, chaves v1 e v2, remetente de teste, HMAC genérico, " +
            "status 202 e as regras do laboratório",
    )
    fun create_padrao_deveVirPronta() {
        val response = create()
        val lab = api.json(response)
        val token = lab["token"]
        val id = token["uuid"].asString()

        assertThat(response.statusCode()).isEqualTo(201)
        assertThat(lab["read_secret"].asString()).hasSizeGreaterThanOrEqualTo(16)
        assertThat(lab["hmac_secret"].asString()).hasSizeGreaterThanOrEqualTo(16)
        assertThat(lab["hmac_header"].asString()).isEqualTo("X-Signature")
        assertThat(token["protected"].asBoolean()).isTrue()
        assertThat(token["default_status"].asInt()).isEqualTo(202)
        assertThat(token["lab"]["signer_kid"].asString()).isEqualTo("lab-sig-1")
        assertThat(token["e2ee_keys"].toList().map { it["kid"].asString() }).containsExactly("enc-v1", "enc-v2")
        assertThat(token["e2ee"]["trusted_signers"].toList().map { it["kid"].asString() }).containsExactly("lab-sig-1")
        assertThat(token["signature"]["header"].asString()).isEqualTo("X-Signature")
        assertThat(token["signature"]["secret"].asString()).doesNotContain(lab["hmac_secret"].asString())
        assertThat(lab["jwks"]["keys"].toList().map { it["kid"].asString() }).containsExactly("enc-v1", "enc-v2")
        assertThat(response.body()).doesNotContain("\"d\":")
        assertThat(api.tree(redis.opsForValue().get("token:$id").orEmpty())["lab"]["signer"].has("d")).isTrue()
        assertThat(api.tree(redis.opsForValue().get("token:$id:rules").orEmpty()).toList().map { it["response"]["status"].asInt() })
            .containsExactly(401, 401, 500, 400)
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma URL de laboratório, quando é lida, então o TTL não passa de 24 h (o uso não renova)")
    fun ttl_leitura_naoDeveRenovar() {
        val lab = created()
        val id = lab["token"]["uuid"].asString()

        api.send("GET", "/token/$id", headers = JSON_CLIENT + mapOf(SECRET_HEADER to lab["read_secret"].asString()))

        assertThat(redis.getExpire("token:$id")).isBetween(DAY_SECONDS - 60, DAY_SECONDS)
        delete(lab)
    }

    @Test
    @DisplayName("Dado o cabeçalho do HMAC e um signatário externo, quando cria, então os usa, com o externo antes do de teste")
    fun create_cabecalhoESignatario_deveUsar() {
        val external = ecKey("cliente-sig-1").toPublicJWK().toJSONObject()

        val lab = created(mapOf("hmac_header" to "X-Canal-Assinatura", "trusted_signers" to listOf(external)))

        assertThat(lab["hmac_header"].asString()).isEqualTo("X-Canal-Assinatura")
        assertThat(
            lab["token"]["e2ee"]["trusted_signers"].toList().map { it["kid"].asString() },
        ).containsExactly("cliente-sig-1", "lab-sig-1")
        delete(lab)
    }

    @Test
    @DisplayName("Dado caminho com colchete, cabeçalho inválido ou signatário com d, quando cria, então 422 com a chave de cada campo")
    fun create_camposInvalidos_deveRecusar() {
        val private = ecKey("com-d").toJSONObject()

        val response = create(mapOf("path" to "$['payload']", "hmac_header" to "X Ruim", "trusted_signers" to listOf(private)))
        val errors = api.json(response)

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(errors.propertyNames().toList()).contains("path", "hmac_header", "trusted_signers.0")
    }

    @Test
    @DisplayName("Dado 20 URLs de laboratório ativas, quando cria a 21ª, então 422 em lab; apagar uma libera a vaga")
    fun create_acimaDoTeto_deveRecusar() {
        redis.delete("anzol:labs")
        val labs = (1..MAX_ACTIVE_LABS).map { created() }

        val refused = create()
        delete(labs.first())
        val again = created()

        assertThat(refused.statusCode()).isEqualTo(422)
        assertThat(api.json(refused).has("lab")).isTrue()
        assertThat(again["token"]["lab"].isObject).isTrue()
        (labs.drop(1) + listOf(again)).forEach(::delete)
        assertThat(redis.opsForZSet().size("anzol:labs")).isZero()
    }

    @Test
    @DisplayName("Dado uma URL de laboratório, quando o PUT manda lab null, então a marca fica; URL comum tem lab null")
    fun put_lab_naoDeveTrocarAMarca() {
        val lab = created()
        val id = lab["token"]["uuid"].asString()
        val secret = mapOf(SECRET_HEADER to lab["read_secret"].asString())
        val current = lab["token"]["e2ee"]

        val updated = api.json(api.send("PUT", "/token/$id", """{"lab":null,"e2ee":$current}""".toByteArray(), JSON_BODY + secret))

        assertThat(updated["lab"]["signer_kid"].asString()).isEqualTo("lab-sig-1")
        assertThat(api.createToken()["lab"].isNull).isTrue()
        delete(lab)
    }
}
