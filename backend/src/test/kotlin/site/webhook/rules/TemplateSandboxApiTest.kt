package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.json.JsonMapper
import java.net.Socket
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration

private const val SOCKET_TIMEOUT_MS = 20_000

/** Folga larga sobre o prazo de 1 s da renderização. */
private val FAST = Duration.ofSeconds(2)

@ApiTest
@DisplayName("Tetos do template e cabeçalho renderizado no webhook de verdade (Tomcat)")
class TemplateSandboxApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun tokenWithRule(response: String): String {
        val tokenId = api.tokenId()
        val saved = api.send("PUT", "/token/$tokenId/rules", """[{"name":"tpl","response":$response}]""".toByteArray(), JSON_BODY)
        assertThat(saved.statusCode()).isEqualTo(200)
        return tokenId
    }

    /** Cabeçalhos `X-H1` a `X-H{count}`, como um remetente pode mandar. */
    private fun crowdedHeaders(count: Int): Map<String, String> = JSON_CLIENT + (1..count).associate { "X-H$it" to "v$it" }

    private fun timed(send: () -> HttpResponse<String>): Pair<HttpResponse<String>, Duration> {
        val start = System.nanoTime()
        val response = send()
        return response to Duration.ofNanos(System.nanoTime() - start)
    }

    private fun assertStoredWithRule(tokenId: String) {
        val stored = api.json(api.send("GET", "/token/$tokenId/requests?sorting=newest", headers = JSON_CLIENT))
        assertThat(stored["total"].asInt()).isEqualTo(1)
        assertThat(stored["data"][0]["rule"]["name"].asString()).isEqualTo("tpl")
    }

    @Nested
    @DisplayName("Teto de saída e de tempo")
    inner class Limits {
        @Test
        @DisplayName("Dado each sobre centenas de cabeçalhos com randomValue no teto, quando o webhook chega, então grava e responde 500")
        fun capture_corpoAcimaDoTeto_deveGravarEResponder500() {
            val body = "{{#each request.headers}}{{randomValue type='HEX' length=10000}}{{/each}}"
            val tokenId = tokenWithRule("""{"template":true,"body":"$body"}""")

            val (response, elapsed) = timed { api.send("GET", "/$tokenId", headers = crowdedHeaders(200)) }

            assertThat(response.statusCode()).isEqualTo(500)
            assertThat(api.json(response)).isEqualTo(
                api.tree("""{"success":false,"error":{"message":"The rendered template is too large.","id":null}}"""),
            )
            assertThat(elapsed).isLessThan(FAST)
            assertStoredWithRule(tokenId)
        }

        @Test
        @DisplayName("Dado um valor de cabeçalho que rende exatamente 8 KiB, quando o webhook chega, então o cabeçalho sai inteiro")
        fun capture_cabecalhoNoTeto_deveSairInteiro() {
            val value = "{{randomValue type='HEX' length=$MAX_RENDERED_HEADER}}"
            val tokenId = tokenWithRule("""{"template":true,"headers":{"X-Eco":"$value"}}""")

            val response = api.send("GET", "/$tokenId", headers = JSON_CLIENT)

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(response.headers().firstValue("X-Eco").orElseThrow()).hasSize(MAX_RENDERED_HEADER)
        }

        @Test
        @DisplayName("Dado um valor de cabeçalho que rende mais de 8 KiB, quando o webhook chega, então responde 500 com o envelope")
        fun capture_cabecalhoAcimaDoTeto_deveResponder500() {
            val tokenId = tokenWithRule("""{"template":true,"headers":{"X-Eco":"{{randomValue type='HEX' length=8193}}"}}""")

            val response = api.send("GET", "/$tokenId", headers = JSON_CLIENT)

            assertThat(response.statusCode()).isEqualTo(500)
            assertThat(api.json(response)["error"]["message"].asString()).isEqualTo(TEMPLATE_TOO_LARGE)
            assertThat(response.headers().firstValue("X-Eco")).isEmpty()
        }

        @Test
        @DisplayName("Dado blocos aninhados que giram sem produzir saída, quando o webhook chega, então para em ~1 s e responde 500")
        fun capture_renderizacaoLonga_devePararEResponder500() {
            val nested = "{{#each @root.request.headers}}".repeat(3) + "{{/each}}".repeat(3)
            val tokenId = tokenWithRule("""{"template":true,"body":"{{#each request.headers}}$nested{{/each}}"}""")

            val (response, elapsed) = timed { api.send("GET", "/$tokenId", headers = crowdedHeaders(300)) }

            assertThat(response.statusCode()).isEqualTo(500)
            assertThat(api.json(response)["error"]["message"].asString()).isEqualTo(TEMPLATE_TOO_SLOW)
            assertThat(elapsed).isLessThan(FAST)
            assertStoredWithRule(tokenId)
        }
    }

    @Nested
    @DisplayName("Controle no valor de cabeçalho, lido em bytes do socket")
    inner class HeaderBytes {
        /** Manda o corpo JSON e devolve as linhas do cabeçalho da resposta, como chegaram no fio. */
        private fun responseHeadLines(
            tokenId: String,
            json: String,
        ): List<String> =
            Socket("localhost", port).use { socket ->
                socket.soTimeout = SOCKET_TIMEOUT_MS
                val body = json.toByteArray(UTF_8)
                val head =
                    "POST /$tokenId HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n" +
                        "Content-Length: ${body.size}\r\nConnection: close\r\n\r\n"
                socket.getOutputStream().apply {
                    write(head.toByteArray(ISO_8859_1))
                    write(body)
                    flush()
                }
                String(socket.getInputStream().readAllBytes(), ISO_8859_1).substringBefore("\r\n\r\n").split("\r\n")
            }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado CR, LF ou controle C0/C1 do remetente num cabeçalho templado, quando responde, então sai uma linha só")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            a\r\nX-Injetado: sim | X-Eco: <a  X-Injetado: sim>
            a\nX-Injetado: sim   | X-Eco: <a X-Injetado: sim>
            a\rX-Injetado: sim   | X-Eco: <a X-Injetado: sim>
            a\u0000b\u007fc      | X-Eco: <a b c>
            a\u0085b             | X-Eco: <a b>""",
        )
        fun capture_controleNoCabecalho_naoDeveAbrirLinha(
            sent: String,
            expectedLine: String,
        ) {
            val tokenId = tokenWithRule("""{"template":true,"headers":{"X-Eco":"<{{jsonPath request.body '$.v'}}>"}}""")

            val lines = responseHeadLines(tokenId, """{"v":"$sent"}""")

            assertThat(lines).contains(expectedLine)
            assertThat(lines).noneMatch { it.startsWith("X-Injetado", ignoreCase = true) }
            assertThat(lines.joinToString("\n")).doesNotContain("\u0085", "\u0000", "\u007f")
        }
    }
}
