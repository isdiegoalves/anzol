package anzol.http

import anzol.support.ApiTest
import anzol.support.rawHttp
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.TestPropertySource

/** `ANZOL_ALLOWED_HOSTS=*` (inseguro, documentado assim): a gestão não confere Host nem Origin; o formulário continua recusado. */
@ApiTest
@TestPropertySource(properties = ["anzol.allowed-hosts=*", "anzol.mcp.enabled=true"])
@DisplayName("Host e Origin com a lista desligada (*)")
class AllowedHostDisabledApiTest(
    @LocalServerPort private val port: Int,
) {
    private val json = "{}".toByteArray()
    private val jsonHeaders = listOf("Content-Type: application/json", "Content-Length: ${json.size}", "Accept: application/json")

    @Test
    @DisplayName("Dado a lista *, quando chega Host e Origin de fora na gestão, então passa como antes")
    fun asterisco_naoDeveConferirAGestao() {
        val response = rawHttp(port, "POST /token HTTP/1.1", jsonHeaders + "Origin: https://evil.example", json, host = "evil.example")

        assertThat(response.status).isEqualTo(201)
    }

    @Test
    @DisplayName("Dado a lista *, quando chega Host de fora no /mcp ou um formulário com Origin na gestão, então 403 do mesmo jeito")
    fun asterisco_mcpEFormularioContinuamConferidos() {
        val mcp = rawHttp(port, "POST /mcp HTTP/1.1", jsonHeaders, json, host = "evil.example")
        val form =
            rawHttp(
                port,
                "POST /token HTTP/1.1",
                listOf("Origin: https://evil.example", "Content-Type: text/plain", "Content-Length: 1"),
                "x".toByteArray(),
            )

        assertThat(mcp.status).isEqualTo(403)
        assertThat(mcp.body).isEqualTo("""{"error":"host not allowed"}""")
        assertThat(form.status).isEqualTo(403)
        assertThat(form.body).isEqualTo("""{"error":"form not allowed"}""")
    }
}
