package site.webhook.capture

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import tools.jackson.databind.json.JsonMapper
import java.net.Socket
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets.ISO_8859_1

private const val SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-modals"
private const val READ_TIMEOUT_MS = 20_000

/**
 * Toda resposta da captura sai com `Content-Security-Policy: sandbox` sem `allow-same-origin`: a página que uma URL
 * responde roda numa origem opaca, e não na da tela e da API (que servem pelo mesmo endereço).
 */
@ApiTest
@DisplayName("Captura isolada por CSP sandbox")
class CaptureSandboxApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun tokenWithRule(response: String): String {
        val tokenId = api.tokenId()
        val saved = api.send("PUT", "/token/$tokenId/rules", """[{"name":"r","response":$response}]""".toByteArray(), JSON_BODY)
        check(saved.statusCode() == 200) { saved.body() }
        return tokenId
    }

    private fun HttpResponse<String>.csp(): List<String> = headers().allValues("Content-Security-Policy")

    @ParameterizedTest(name = "[{index}] {0}")
    @ValueSource(strings = ["GET", "POST", "HEAD", "OPTIONS"])
    @DisplayName("Dado a resposta padrão da URL (HTML com script), quando chega um webhook, então vem o CSP sandbox")
    fun padrao_deveSairEmSandbox(method: String) {
        val tokenId = api.tokenId("""{"default_content_type":"text/html","default_content":"<script>alert(1)</script>"}""")

        val response = api.send(method, "/$tokenId/pagina")

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.csp()).containsExactly(SANDBOX)
    }

    @Test
    @DisplayName("Dado uma regra que responde HTML, quando casa, então vem o CSP sandbox")
    fun regra_deveSairEmSandbox() {
        val tokenId = tokenWithRule("""{"status":201,"headers":{"Content-Type":"text/html"},"body":"<script>alert(1)</script>"}""")

        val response = api.send("GET", "/$tokenId")

        assertThat(response.statusCode()).isEqualTo(201)
        assertThat(response.csp()).containsExactly(SANDBOX)
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @ValueSource(strings = ["Content-Security-Policy", "content-security-policy"])
    @DisplayName(
        "Dado uma regra que define o próprio CSP (sem sandbox), quando casa, então o dela sai e o sandbox sai também: o " +
            "navegador aplica os dois",
    )
    fun regra_comCspProprio_naoDeveTirarOSandbox(name: String) {
        val tokenId = tokenWithRule("""{"headers":{"$name":"default-src *","Content-Type":"text/html"},"body":"<p>oi</p>"}""")

        val response = api.send("GET", "/$tokenId")

        assertThat(response.csp()).containsExactlyInAnyOrder("default-src *", SANDBOX)
    }

    @Test
    @DisplayName("Dado uma regra com dribble, quando casa, então o CSP sandbox vem nos cabeçalhos enviados antes do corpo")
    fun regra_comDribble_deveSairEmSandbox() {
        val tokenId = tokenWithRule("""{"body":"<p>devagar</p>","dribble":{"chunks":2,"durationMs":100}}""")

        val response = api.send("GET", "/$tokenId")

        assertThat(response.body()).isEqualTo("<p>devagar</p>")
        assertThat(response.csp()).containsExactly(SANDBOX)
    }

    @Test
    @DisplayName("Dado a falha malformed_chunk (status, cabeçalhos e corpo inválido), quando casa, então o CSP sandbox vem nos cabeçalhos")
    fun falha_malformedChunk_deveSairEmSandbox() {
        val tokenId = tokenWithRule("""{"fault":"malformed_chunk"}""")

        val head =
            Socket("localhost", port).use { socket ->
                socket.soTimeout = READ_TIMEOUT_MS
                socket.getOutputStream().write("GET /$tokenId HTTP/1.1\r\nHost: localhost:$port\r\n\r\n".toByteArray(ISO_8859_1))
                String(socket.getInputStream().readAllBytes(), ISO_8859_1).substringBefore("\r\n\r\n")
            }

        assertThat(head.lines()).contains("Content-Security-Policy: $SANDBOX")
    }
}
