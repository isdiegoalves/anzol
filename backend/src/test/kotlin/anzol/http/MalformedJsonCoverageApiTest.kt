package anzol.http

import anzol.support.AiApiTest
import anzol.support.ApiClient
import anzol.support.FakeLlm
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import anzol.support.Route
import anzol.support.routes
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import tools.jackson.databind.json.JsonMapper

private val BODY_METHODS = setOf("POST", "PUT", "PATCH")

/** Rotas de gestão que não leem corpo nenhum: o que vier é ignorado. Rota nova só entra aqui por decisão. */
private val WITHOUT_BODY = setOf("PUT /token/{tokenId}/cors/toggle", "POST /token/{tokenId}/lock")

/** As que leem o corpo pelo [requireJsonObject]: JSON quebrado é 400, com a mensagem do `POST /token`. */
private val BAD_REQUEST =
    setOf(
        "POST /token",
        "PUT /token/{tokenId}",
        "POST /token/{tokenId}/unlock",
        "POST /token/{tokenId}/request/{requestId}/share",
        "POST /token/{tokenId}/keys",
        "POST /e2ee-lab",
        "POST /token/{tokenId}/e2ee-lab/run",
    )

/** Menos que isto é sinal de que a varredura não achou as rotas, e passaria sem provar nada. */
private const val MIN_BODY_ROUTES = 12

private const val BROKEN = """{"secret": "segredo-valido-123", "expires_in": "1h", "default_status": 201"""

/**
 * Guarda: nenhuma rota de gestão lê JSON quebrado como entrada vazia. A lista vem dos mapeamentos do Spring: toda rota
 * `POST`/`PUT`/`PATCH` de `/token`, `/share` e `/e2ee-lab` responde 400 (as do [requireJsonObject]) ou o 422 da validação própria
 * dela, e nunca 2xx. Rota nova que leia o corpo de outro jeito e o aceite quebrado faz este teste falhar.
 */
@AiApiTest
@DisplayName("Guarda: JSON quebrado nunca vira entrada vazia nas rotas de gestão")
class MalformedJsonCoverageApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    @param:Qualifier("requestMappingHandlerMapping") private val mapping: RequestMappingHandlerMapping,
) {
    private val api = ApiClient(port, jsonMapper)

    @BeforeEach
    fun reset() = FakeLlm.reset()

    private fun Route.normalized(): String {
        val names = Regex("\\{(\\w+)").findAll(pattern).map { it.groupValues[1] }.toList()
        return "$method ${path(names.associateWith { "{$it}" })}"
    }

    private fun bodyRoutes(): List<Route> =
        mapping.routes().filter {
            it.method in BODY_METHODS &&
                (it.pattern.startsWith("/token") || it.pattern.startsWith("/share") || it.pattern.startsWith("/e2ee-lab"))
        }

    @Test
    @DisplayName("Dado JSON quebrado, quando chama cada rota que recebe corpo, então 400 ou o 422 dela, nunca 2xx, e nada muda")
    fun varredura_jsonQuebrado_nuncaDeveSerAceito() {
        val tokenId = api.tokenId("""{"default_status":418,"read_secret":null}""")
        val requestId = api.capture(tokenId, "POST", body = "guardada".toByteArray())["uuid"].asString()
        val values = mapOf("tokenId" to tokenId, "requestId" to requestId, "name" to "cenario")
        val routes = bodyRoutes().filterNot { it.normalized() in WITHOUT_BODY }

        val answers = routes.associate { it.normalized() to api.send(it.method, it.path(values), BROKEN.toByteArray(), JSON_BODY) }

        assertThat(routes).hasSizeGreaterThanOrEqualTo(MIN_BODY_ROUTES)
        assertThat(answers.keys).containsAll(BAD_REQUEST)
        assertThat(answers.filterValues { it.statusCode() !in setOf(400, 422) }.mapValues { it.value.statusCode() }).isEmpty()
        assertThat(answers.filterValues { it.statusCode() == 400 }.keys).isEqualTo(BAD_REQUEST)
        assertThat(answers.filterKeys { it in BAD_REQUEST }.values.map { api.json(it)["error"]["message"].asString() })
            .containsOnly(MALFORMED_JSON_MESSAGE)
        assertThat(api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))["default_status"].asInt()).isEqualTo(418)
        assertThat(api.json(api.send("GET", "/token/$tokenId/shares", headers = JSON_CLIENT)).size()).isZero()
        assertThat(api.json(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT)).size()).isZero()
        assertThat(FakeLlm.received).isEmpty()
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado um corpo JSON que não é objeto, quando cria o link só-leitura ou desbloqueia, então 400 e nenhum link criado")
    @ValueSource(strings = ["{\"expires_in\":\"1h\"", "[1,2]", "\"texto\"", "42", "null", "{\"a\":1} x"])
    fun shareEUnlock_naoObjeto_deveResponder400(body: String) {
        val tokenId = api.tokenId()
        val requestId = api.capture(tokenId)["uuid"].asString()

        val share = api.send("POST", "/token/$tokenId/request/$requestId/share", body.toByteArray(), JSON_BODY)
        val unlock = api.send("POST", "/token/$tokenId/unlock", body.toByteArray(), mapOf("Content-Type" to "application/json"))

        assertThat(share.statusCode()).`as`(share.body()).isEqualTo(400)
        assertThat(unlock.statusCode()).`as`(unlock.body()).isEqualTo(400)
        assertThat(api.json(unlock)["error"]["message"].asString()).isEqualTo(MALFORMED_JSON_MESSAGE)
        assertThat(api.json(api.send("GET", "/token/$tokenId/shares", headers = JSON_CLIENT)).size()).isZero()
    }

    @Test
    @DisplayName("Dado corpo vazio ou {}, quando cria o link só-leitura, então continua criando com os padrões")
    fun share_corpoVazioOuObjetoVazio_deveContinuarAceito() {
        val tokenId = api.tokenId()
        val requestId = api.capture(tokenId)["uuid"].asString()

        val empty = api.send("POST", "/token/$tokenId/request/$requestId/share", headers = JSON_BODY)
        val braces = api.send("POST", "/token/$tokenId/request/$requestId/share", "{}".toByteArray(), JSON_BODY)

        assertThat(listOf(empty, braces).map { it.statusCode() }).containsOnly(empty.statusCode()).doesNotContain(400, 422)
        assertThat(api.json(api.send("GET", "/token/$tokenId/shares", headers = JSON_CLIENT)).size()).isEqualTo(2)
    }
}
