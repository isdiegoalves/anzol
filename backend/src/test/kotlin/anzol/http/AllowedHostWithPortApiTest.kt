package anzol.http

import anzol.support.ApiTest
import anzol.support.rawHttp
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.TestPropertySource

/** Um `nome:porta` na lista libera o `Origin` dessa porta, e só dela (ex.: uma tela servida em outra porta). */
@ApiTest
@TestPropertySource(properties = ["anzol.allowed-hosts=localhost,127.0.0.1,localhost:4200"])
@DisplayName("Origin de outra porta com nome:porta na lista")
class AllowedHostWithPortApiTest(
    @LocalServerPort private val port: Int,
) {
    private val json = "{}".toByteArray()
    private val jsonHeaders = listOf("Content-Type: application/json", "Content-Length: ${json.size}", "Accept: application/json")

    @Test
    @DisplayName("Dado localhost:4200 na lista, quando o Origin é localhost:4200, então passa; localhost:4300 e 127.0.0.1:4200, 403")
    fun origin_comPortaNaLista_deveValerSoParaEla() {
        val listed = rawHttp(port, "POST /token HTTP/1.1", jsonHeaders + "Origin: http://localhost:4200", json)
        val otherPort = rawHttp(port, "POST /token HTTP/1.1", jsonHeaders + "Origin: http://localhost:4300", json)
        val otherName = rawHttp(port, "POST /token HTTP/1.1", jsonHeaders + "Origin: http://127.0.0.1:4200", json)

        assertThat(listed.status).isEqualTo(201)
        assertThat(listOf(otherPort, otherName)).allSatisfy {
            assertThat(it.status).isEqualTo(403)
            assertThat(it.body).isEqualTo("""{"error":"origin not allowed"}""")
        }
    }
}
