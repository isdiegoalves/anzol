package site.webhook.http

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_CLIENT
import site.webhook.support.rawHttp
import tools.jackson.databind.json.JsonMapper

/** Erros que não passam por controller nenhum saem no formato do app antigo, não no do Spring Boot. */
@ApiTest
@DisplayName("Erros fora dos controllers, pelo servidor")
class LegacyErrorApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)
    private val emptyEnvelope = api.tree("""{"success":false,"error":{"message":"","id":null}}""")

    @Test
    @DisplayName("Dado um TRACE no webhook, quando o cliente pede JSON, então responde 405 no envelope do app antigo")
    fun trace_clienteJson_deveResponderEnvelope() {
        val response = rawHttp(port, "TRACE /${api.tokenId()} HTTP/1.1", listOf("Accept: application/json"))

        assertThat(response.status).isEqualTo(405)
        assertThat(response.headers["content-type"]).isEqualTo("application/json")
        assertThat(api.tree(response.body)).isEqualTo(emptyEnvelope)
    }

    @Test
    @DisplayName("Dado um TRACE no webhook, quando o cliente é um navegador, então responde 405 em HTML")
    fun trace_clienteHtml_deveResponderPagina() {
        val response = rawHttp(port, "TRACE /${api.tokenId()} HTTP/1.1")

        assertThat(response.status).isEqualTo(405)
        assertThat(response.headers["content-type"]).isEqualTo(PHP_DEFAULT_CONTENT_TYPE.replace(" ", ""))
        assertThat(response.body).contains("<h1>Error</h1>")
    }

    @ParameterizedTest(name = "{0} /error")
    @DisplayName("Dado uma chamada direta a /error, quando o cliente pede JSON, então é rota inexistente como no app antigo")
    @ValueSource(strings = ["GET", "POST", "DELETE"])
    fun error_chamadaDireta_deveResponder404(method: String) {
        val response = api.send(method, "/error", headers = JSON_CLIENT)

        assertThat(response.statusCode()).isEqualTo(404)
        assertThat(api.json(response)).isEqualTo(emptyEnvelope)
    }
}
