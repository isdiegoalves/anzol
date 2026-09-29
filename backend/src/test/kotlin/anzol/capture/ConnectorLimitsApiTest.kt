package anzol.capture

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_CLIENT
import anzol.support.RawResponse
import anzol.support.rawHttp
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * O que o nginx do app antigo deixava passar e o Tomcat recusava com 400 antes do código:
 * medido contra o app Laravel (porta 8084) com os scripts da refutação.
 */
@ApiTest
@DisplayName("Conector HTTP alinhado ao nginx do app antigo")
class ConnectorLimitsApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun stored(
        tokenId: String,
        response: RawResponse,
    ): JsonNode {
        val requestId = checkNotNull(response.headers["x-request-id"]) { "sem X-Request-Id (status ${response.status})" }
        return api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT))
    }

    @Nested
    @DisplayName("Tamanho e quantidade de cabeçalhos (large_client_header_buffers 4 8k)")
    inner class HeaderLimits {
        @Test
        @DisplayName("Dado 3 cabeçalhos de 3000 bytes (~9 KB), quando chama o webhook, então responde o status do token e grava os três")
        fun capture_cabecalhosAcimaDe8KbNoTotal_deveGravar() {
            val tokenId = api.tokenId("""{"default_status":202}""")
            val headers = (0..2).map { "X-Grande-$it: ${it.toString().repeat(3000)}" }

            val response = rawHttp(port, "GET /$tokenId HTTP/1.1", headers)

            assertThat(response.status).isEqualTo(202)
            val stored = stored(tokenId, response)
            (0..2).forEach { assertThat(stored["headers"]["x-grande-$it"][0].asString()).isEqualTo(it.toString().repeat(3000)) }
        }

        @Test
        @DisplayName("Dado ~31 KB em 8 cabeçalhos, quando chama o webhook, então grava (o nginx aceita até 4 x 8 KB)")
        fun capture_cabecalhosPerto32Kb_deveGravar() {
            val tokenId = api.tokenId()
            val headers = (0..7).map { "X-B$it: ${"a".repeat(3950)}" }

            val response = rawHttp(port, "GET /$tokenId HTTP/1.1", headers)

            assertThat(response.status).isEqualTo(200)
            assertThat(stored(tokenId, response)["headers"]["x-b7"][0].asString()).hasSize(3950)
        }

        @Test
        @DisplayName("Dado 150 cabeçalhos, quando chama o webhook, então grava todos")
        fun capture_150Cabecalhos_deveGravarTodos() {
            val tokenId = api.tokenId()
            val headers = (0 until 150).map { "X-H-$it: v$it" }

            val response = rawHttp(port, "GET /$tokenId HTTP/1.1", headers)

            assertThat(response.status).isEqualTo(200)
            val stored = stored(tokenId, response)
            (0 until 150).forEach { assertThat(stored["headers"]["x-h-$it"][0].asString()).isEqualTo("v$it") }
        }

        @ParameterizedTest(name = "valor de {0} bytes → {1}")
        @DisplayName(
            "Dado uma linha de cabeçalho no limite de 8 KB, quando chama o webhook, então aceita até 8190 bytes e recusa acima com 400",
        )
        @CsvSource("8183, 200", "8184, 400")
        fun capture_linhaDeCabecalhoNoLimite_deveSeguirONginx(
            valueSize: Int,
            status: Int,
        ) {
            val tokenId = api.tokenId()

            val response = rawHttp(port, "GET /$tokenId HTTP/1.1", listOf("X-Big: ${"a".repeat(valueSize)}"))

            assertThat(response.status).isEqualTo(status)
            val total = api.json(api.send("GET", "/token/$tokenId/requests"))["total"].asInt()
            assertThat(total).isEqualTo(if (status == 200) 1 else 0)
        }
    }

    @Nested
    @DisplayName("Caracteres crus no alvo da requisição")
    inner class RequestTarget {
        @Test
        @DisplayName("Dado aspas cruas na query, quando chama o webhook, então decodifica a query e re-codifica na url")
        fun capture_aspasCruasNaQuery_deveGravar() {
            val tokenId = api.tokenId()

            val response = rawHttp(port, "GET /$tokenId?data={\"a\":1} HTTP/1.1")

            assertThat(response.status).isEqualTo(200)
            val stored = stored(tokenId, response)
            assertThat(stored["query"]).isEqualTo(api.tree("""{"data":"{\"a\":1}"}"""))
            assertThat(stored["url"].asString()).isEqualTo("${api.base}/$tokenId?data=%7B%22a%22%3A1%7D")
        }

        @Test
        @DisplayName("Dado aspas cruas no caminho e na query, quando chama o webhook, então o caminho fica cru na url")
        fun capture_aspasCruasNoCaminho_deveGravar() {
            val tokenId = api.tokenId()

            val response = rawHttp(port, "GET /$tokenId/x\"y?q=\"z\" HTTP/1.1")

            assertThat(response.status).isEqualTo(200)
            val stored = stored(tokenId, response)
            assertThat(stored["query"]).isEqualTo(api.tree("""{"q":"\"z\""}"""))
            assertThat(stored["url"].asString()).isEqualTo("${api.base}/$tokenId/x\"y?q=%22z%22")
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um caminho que o nginx aceita cru, quando chama o webhook, então responde o padrão e grava a url crua")
        @ValueSource(strings = ["/a\\b", "/a\\b/404", "/%5C", "/abc%", "/%", "/a%2", "/%FF", "/%FF/404", "/%C3", "/%C3%A9%FF"])
        fun capture_caminhoCru_deveGravarUrlCrua(path: String) {
            val tokenId = api.tokenId()

            val response = rawHttp(port, "GET /$tokenId$path HTTP/1.1")

            assertThat(response.status).isEqualTo(200)
            assertThat(stored(tokenId, response)["url"].asString()).isEqualTo("${api.base}/$tokenId$path")
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um escape que o nginx também recusa, quando chama o webhook, então responde 400 e não grava")
        @ValueSource(strings = ["/%zz", "/a%2/b", "/100%/x", "/%00", "/x%\"y"])
        fun capture_escapeInvalido_deveResponder400(path: String) {
            val tokenId = api.tokenId()

            val response = rawHttp(port, "GET /$tokenId$path HTTP/1.1")

            assertThat(response.status).isEqualTo(400)
            assertThat(api.json(api.send("GET", "/token/$tokenId/requests"))["total"].asInt()).isZero()
        }
    }

    @Nested
    @DisplayName("Cabeçalho Host que o Symfony aceita")
    inner class HostHeader {
        @ParameterizedTest(name = "Host {0} → hostname {1}, url {2}")
        @DisplayName("Dado um Host fora da RFC que o Symfony aceita, quando chama o webhook, então grava hostname e url como o app antigo")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            my_host.com      | my_host.com     | http://my_host.com/TOKEN?b=1
            My_Host.com:8086 | my_host.com     | http://my_host.com:8086/TOKEN?b=1
            example.com:abc  | example.com:abc | http://example.com:abc:0/TOKEN?b=1
            _                | _               | http://_/TOKEN?b=1
            [::1]:x          | [::1]:x         | http://[::1]:x:0/TOKEN?b=1""",
        )
        fun capture_hostQueOSymfonyAceita_deveGravar(
            host: String,
            hostname: String,
            url: String,
        ) {
            val tokenId = api.tokenId()

            val response = rawHttp(port, "GET /$tokenId?b=1 HTTP/1.1", host = host)

            assertThat(response.status).isEqualTo(200)
            val stored = stored(tokenId, response)
            assertThat(stored["hostname"].asString()).isEqualTo(hostname)
            assertThat(stored["url"].asString()).isEqualTo(url.replace("TOKEN", tokenId))
            assertThat(stored["headers"]["host"][0].asString()).isEqualTo(host)
        }

        @Test
        @DisplayName("Dado um Host que o Symfony também recusa, quando chama o webhook, então responde 400 e não grava")
        fun capture_hostInvalido_deveResponder400() {
            val tokenId = api.tokenId()

            val response = rawHttp(port, "GET /$tokenId HTTP/1.1", host = "exa\$mple.com")

            assertThat(response.status).isEqualTo(400)
            assertThat(api.json(api.send("GET", "/token/$tokenId/requests"))["total"].asInt()).isZero()
        }
    }
}
