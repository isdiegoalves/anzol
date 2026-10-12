package anzol.http

import jakarta.servlet.FilterChain
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.http.MediaType
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse

private val BIG_JSON = """{"itens":[${(1..200).joinToString(",") { "\"item-$it\"" }}]}""".toByteArray()

@DisplayName("Compressão da API de gestão: quais rotas")
class ApiCompressionFilterTest {
    private val filter = ApiCompressionFilter()

    /** Um JSON de mais de 1 kB respondido a quem aceita gzip, no caminho dado. */
    private fun respond(path: String): MockHttpServletResponse {
        val request = MockHttpServletRequest("GET", path).apply { addHeader("Accept-Encoding", "gzip") }
        val response = MockHttpServletResponse()
        val handler =
            FilterChain { _, answer ->
                answer.contentType = MediaType.APPLICATION_JSON_VALUE
                answer.outputStream.write(BIG_JSON)
            }
        filter.doFilter(request, response, handler)
        return response
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "/token",
            "/token/3dbd68f4-8890-4f56-affb-c7c9b297e666",
            "/token/3dbd68f4-8890-4f56-affb-c7c9b297e666/requests",
            "/token/3dbd68f4-8890-4f56-affb-c7c9b297e666/rules/stream",
            "/%74oken/3dbd68f4-8890-4f56-affb-c7c9b297e666/requests",
        ],
    )
    @DisplayName("Dado uma rota da API de gestão, quando a resposta é um JSON grande, então sai em gzip")
    fun gestao_deveComprimir(path: String) {
        val response = respond(path)

        assertThat(response.getHeader("Content-Encoding")).isEqualTo("gzip")
        assertThat(response.contentLength).isEqualTo(response.contentAsByteArray.size).isLessThan(BIG_JSON.size)
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "/mcp",
            "/3dbd68f4-8890-4f56-affb-c7c9b297e666",
            "/3dbd68f4-8890-4f56-affb-c7c9b297e666/token/requests",
            "/share/abc",
            "/token/3dbd68f4-8890-4f56-affb-c7c9b297e666/stream",
            "/token/3dbd68f4-8890-4f56-affb-c7c9b297e666/stream/",
            "/token/3dbd68f4-8890-4f56-affb-c7c9b297e666/stream;v=1",
            "/token/3dbd68f4-8890-4f56-affb-c7c9b297e666/%73tream",
        ],
    )
    @DisplayName("Dado o /mcp, a captura, o link compartilhado ou o /stream, quando a resposta é um JSON grande, então sai como veio")
    fun foraDaGestao_naoDeveComprimir(path: String) {
        val response = respond(path)

        assertThat(response.getHeader("Content-Encoding")).isNull()
        assertThat(response.contentAsByteArray).isEqualTo(BIG_JSON)
    }
}
