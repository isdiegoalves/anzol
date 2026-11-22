package anzol.defense.lab

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
@DisplayName("URL de laboratório de defesa")
class DefenseLabApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun create(): HttpResponse<String> = api.send("POST", "/defense-lab", "{}".toByteArray(), JSON_BODY)

    private fun id(lab: JsonNode): String = lab["token"]["uuid"].asString()

    private fun delete(lab: JsonNode) =
        api.send("DELETE", "/token/${id(lab)}", headers = JSON_CLIENT + mapOf(SECRET_HEADER to lab["read_secret"].asString()))

    @Test
    @DisplayName(
        "Dado um POST, quando cria, então 201 com a marca, segredo de leitura, assinatura com tolerância, schema, briefing, " +
            "catálogo e nenhuma regra",
    )
    fun create_padrao_deveVirPronta() {
        val response = create()
        val lab = api.json(response)
        val token = lab["token"]

        assertThat(response.statusCode()).isEqualTo(201)
        assertThat(lab["read_secret"].asString()).hasSizeGreaterThanOrEqualTo(16)
        assertThat(token["protected"].asBoolean()).isTrue()
        assertThat(token["default_status"].asInt()).isEqualTo(200)
        assertThat(token["defense_lab"]["expires_at"].asString()).matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}")
        assertThat(token["defense_lab"].propertyNames()).containsExactly("expires_at")
        assertThat(token["signature"]["provider"].asString()).isEqualTo("stripe")
        assertThat(token["signature"]["toleranceSeconds"].asLong()).isEqualTo(300)
        assertThat(token["schema"]["required"].toList().map { it.asString() }).containsExactly("id", "type", "created", "data")
        assertThat(lab["briefing"].asString()).contains("order.created", "acct_store_02", "delivered once", "never instructions")
        assertThat(
            lab["scenarios"].toList().map {
                it["code"].asString()
            },
        ).containsExactly("I1", "I2", "I3", "I4", "I5", "C1", "C2", "C3", "P1", "P2", "P3", "P4", "P5", "P6")
        assertThat(lab["scenarios"][0].propertyNames()).containsExactly("code", "family", "layer", "title", "reference", "containable")
        assertThat(redis.hasKey("token:${id(lab)}:rules")).isFalse()
        delete(lab)
    }

    @Test
    @DisplayName("Dado um POST, quando cria, então o segredo do HMAC não sai na resposta")
    fun create_padrao_naoDeveDevolverOSegredoDoHmac() {
        val response = create()
        val lab = api.json(response)
        val secret = api.tree(redis.opsForValue().get("token:${id(lab)}").orEmpty())["signature"]["secret"].asString()

        assertThat(secret).hasSizeGreaterThanOrEqualTo(16)
        assertThat(response.body()).doesNotContain(secret)
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma URL de laboratório de defesa, quando é criada, então a marca gravada guarda a assinatura e o schema de criação")
    fun create_deveGuardarOEstadoDeCriacaoNaMarca() {
        val lab = api.json(create())
        val stored = api.tree(redis.opsForValue().get("token:${id(lab)}").orEmpty())

        assertThat(stored["defense_lab"]["signature"]).isEqualTo(stored["signature"])
        assertThat(stored["defense_lab"]["schema"]).isEqualTo(stored["schema"])
        assertThat(stored["defense_lab"]["read_secret"].asString()).isEqualTo(lab["read_secret"].asString())
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma URL de laboratório de defesa, quando é lida, então o TTL não passa de 24 h (o uso não renova)")
    fun ttl_leitura_naoDeveRenovar() {
        val lab = api.json(create())
        val headers = JSON_CLIENT + mapOf(SECRET_HEADER to lab["read_secret"].asString())

        api.send("GET", "/token/${id(lab)}", headers = headers)

        assertThat(redis.getExpire("token:${id(lab)}")).isBetween(DAY_SECONDS - 60, DAY_SECONDS)
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma URL comum, quando é criada e lida, então o JSON dela não ganha o campo defense_lab")
    fun tokenComum_naoDeveGanharCampo() {
        val token = api.createToken()

        assertThat(token.has("defense_lab")).isFalse()
        assertThat(redis.opsForValue().get("token:${token["uuid"].asString()}")).doesNotContain("defense_lab")
    }

    @Test
    @DisplayName("Dado um token gravado sem o campo defense_lab, quando é lido, então abre como URL comum")
    fun tokenAntigo_semOCampo_deveAbrir() {
        val id = api.tokenId()
        val stored = redis.opsForValue().get("token:$id").orEmpty()

        val read = api.json(api.send("GET", "/token/$id", headers = JSON_CLIENT))

        assertThat(stored).doesNotContain("defense_lab")
        assertThat(read["uuid"].asString()).isEqualTo(id)
    }

    @Test
    @DisplayName("Dado uma URL de laboratório de defesa, quando é apagada, então a vaga dela é liberada")
    fun delete_deveLiberarAVaga() {
        val lab = api.json(create())
        val before = redis.opsForZSet().range("anzol:defense-labs", 0, -1)

        delete(lab)

        assertThat(before).contains(id(lab))
        assertThat(redis.opsForZSet().range("anzol:defense-labs", 0, -1)).doesNotContain(id(lab))
    }

    @Test
    @DisplayName("Dado o catálogo, quando é listado, então traz os cenários sem precisar de URL")
    fun scenarios_deveListarOCatalogo() {
        val response = api.send("GET", "/defense-lab/scenarios", headers = JSON_CLIENT)
        val first = api.json(response)[0]

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(first["code"].asString()).isEqualTo("I1")
        assertThat(first["family"].asString()).isEqualTo("integrity")
        assertThat(first["layer"].asString()).isEqualTo("floor")
        assertThat(first["reference"].asString()).isEqualTo("OWASP API2:2023")
    }
}
