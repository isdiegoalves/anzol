package site.webhook.http

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.support.ApiTest
import site.webhook.support.rawHttp

/** Sem `WEBHOOK_ALLOWED_HOSTS` (o padrão do app): a API não confere Host nem Origin. O `/mcp` ligado é o `McpServerApiTest`. */
@ApiTest
@DisplayName("Host e Origin sem a lista")
class AllowedHostDisabledApiTest(
    @LocalServerPort private val port: Int,
) {
    @Test
    @DisplayName("Dado a lista vazia, quando chega Host e Origin de fora na gestão, então passa como antes")
    fun listaVazia_naoDeveConferir() {
        val body = "{}".toByteArray()
        val headers =
            listOf(
                "Content-Type: application/json",
                "Content-Length: ${body.size}",
                "Accept: application/json",
                "Origin: https://evil.example",
            )

        val response = rawHttp(port, "POST /token HTTP/1.1", headers, body, host = "evil.example")

        assertThat(response.status).isEqualTo(201)
    }
}
