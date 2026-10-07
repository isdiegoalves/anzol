package anzol.privacy

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import anzol.support.Route
import anzol.support.rawHttp
import anzol.support.routes
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import tools.jackson.databind.json.JsonMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpRequest.BodyPublishers
import java.net.http.HttpResponse.BodyHandlers
import java.net.http.HttpTimeoutException
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration

private const val SECRET = "segredo-da-varredura"
private const val PROTECTED = """{"error":"This URL is protected","protected":true}"""

/** As únicas rotas de uma URL que respondem sem acesso: as do §1 do item 12 e o JWKS (só chaves públicas). */
private val OPEN_ROUTES = setOf("POST /token/{tokenId}/unlock", "POST /token/{tokenId}/lock", "GET /token/{tokenId}/jwks.json")

/** Menos que isto é sinal de que a varredura não achou as rotas, e passaria sem provar nada. */
private const val MIN_TOKEN_ROUTES = 25
private const val UNAUTHORIZED = 401

/** Status registrado para quem não respondeu no prazo: uma rota que escapou e ficou aberta. */
private const val NO_ANSWER = 0
private val PROMPTLY: Duration = Duration.ofSeconds(10)

/**
 * Guarda da §1: **toda** rota `/token/{tokenId}/...` do Spring MVC responde 401 a uma URL protegida sem acesso, exceto
 * `unlock` e `lock`. A lista vem dos mapeamentos do Spring, não de uma lista escrita à mão: rota nova sem proteção
 * (ou marcada [WithoutReadAccess] sem estar em [OPEN_ROUTES]) faz este teste falhar.
 */
@ApiTest
@DisplayName("Guarda: nenhuma rota da URL escapa do controle de acesso")
class ReadAccessCoverageApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
    @param:Qualifier("requestMappingHandlerMapping") private val mapping: RequestMappingHandlerMapping,
) {
    private val api = ApiClient(port, jsonMapper)
    private val http = HttpClient.newHttpClient()

    @Test
    @DisplayName(
        "Dado uma URL protegida com mensagem e link, quando chama cada rota mapeada sem acesso (e HEAD nas de GET fechadas), então " +
            "401 com o corpo da §1 em todas, menos unlock, lock e o JWKS, e nada muda",
    )
    fun varredura_todasAsRotas_devemResponder401() {
        val tokenId = api.tokenId("""{"read_secret":"$SECRET"}""")
        val secret = mapOf(SECRET_HEADER to SECRET)
        val requestId =
            api
                .send("POST", "/$tokenId", "guardada".toByteArray())
                .headers()
                .firstValue("X-Request-Id")
                .orElseThrow()
        val shareId =
            api.json(api.send("POST", "/token/$tokenId/request/$requestId/share", "{}".toByteArray(), JSON_BODY + secret))["id"].asString()
        val values = mapOf("tokenId" to tokenId, "requestId" to requestId, "shareId" to shareId)
        val routes = mapping.routes().filter { it.pattern.startsWith("/token/{") }

        val answers = routes.associateWith { call(it, it.path(values)) }
        val heads = routes.filter { it.method == "GET" && it.normalized() !in OPEN_ROUTES }.associateWith { head(it.path(values)) }

        val open =
            answers
                .filterValues { it != 401 to PROTECTED }
                .keys
                .map { it.normalized() }
                .toSet()
        assertThat(routes).hasSizeGreaterThanOrEqualTo(MIN_TOKEN_ROUTES)
        assertThat(
            routes.map { it.normalized() },
        ).contains("GET /token/{tokenId}/stream", "DELETE /token/{tokenId}", "GET /token/{tokenId}/shares")
        assertThat(open)
            .`as`("rotas que responderam sem acesso: %s", answers.filterKeys { it.normalized() in open })
            .isEqualTo(OPEN_ROUTES)
        assertThat(heads.filterValues { it != 401 }).isEmpty()
        assertThat(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT + secret).body()).contains("guardada")
        assertThat(api.send("GET", "/share/$shareId", headers = JSON_CLIENT).statusCode()).isEqualTo(200)
    }

    @Test
    @DisplayName(
        "Dado uma URL protegida, quando o caminho vem com barra final, ;parâmetro ou escape, então nenhuma variação responde 200",
    )
    fun varredura_variacoesDoCaminho_naoDevemEscapar() {
        val tokenId = api.tokenId("""{"read_secret":"$SECRET"}""")
        val escaped = tokenId.replaceFirst("-", "%2D")
        val variations =
            listOf(
                "/token/$tokenId/requests/",
                "/token/$tokenId;x=1/requests",
                "/token;x=1/$tokenId/requests",
                "/token/$escaped/requests",
                "/%74oken/$tokenId/requests",
                "//token/$tokenId/requests",
                "/token/$tokenId/./requests",
                "/token/x/../$tokenId/requests",
            )

        val statuses = variations.associateWith { rawHttp(port, "GET $it HTTP/1.1", listOf("Accept: application/json")).status }

        assertThat(statuses.filterValues { it in 200..299 }).isEmpty()
    }

    /**
     * Status e corpo; o corpo só é lido no 401 (curto). Rota que abriu sem acesso pode ser um stream sem fim (o SSE):
     * fecha sem ler, e o status já diz que escapou; sem resposta no prazo, [NO_ANSWER].
     */
    private fun call(
        route: Route,
        path: String,
    ): Pair<Int, String> {
        val body = if (route.method in setOf("GET", "HEAD", "DELETE")) BodyPublishers.noBody() else BodyPublishers.ofString("{}")
        val request =
            HttpRequest
                .newBuilder(URI.create(api.base + path))
                .method(route.method, body)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .timeout(PROMPTLY)
                .build()
        val response =
            try {
                http.send(request, BodyHandlers.ofInputStream())
            } catch (_: HttpTimeoutException) {
                // Sem cabeçalhos no prazo (o HEAD de um SSE aberto): não foi o 401 de quem não tem acesso.
                return NO_ANSWER to ""
            }
        return response.body().use { stream ->
            val text = if (response.statusCode() == UNAUTHORIZED) String(stream.readAllBytes(), UTF_8) else ""
            response.statusCode() to text
        }
    }

    private fun head(path: String): Int = call(Route("HEAD", path), path).first
}

/** A rota com as variáveis sem a regex: `/token/{tokenId:[0-9a-f]{8}...}` → `/token/{tokenId}`. */
private fun Route.normalized(): String = "$method ${pathWithNames()}"

private fun Route.pathWithNames(): String {
    val names = Regex("\\{(\\w+)").findAll(pattern).map { it.groupValues[1] }.toList()
    return path(names.associateWith { "{$it}" })
}
