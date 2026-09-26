package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
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
    private val redis: StringRedisTemplate,
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

    private fun putRule(response: String): HttpResponse<String> =
        api.send("PUT", "/token/${api.tokenId()}/rules", """[{"name":"tpl","response":$response}]""".toByteArray(), JSON_BODY)

    private fun assertTooLarge(response: HttpResponse<String>) {
        assertThat(response.statusCode()).isEqualTo(500)
        assertThat(api.json(response)).isEqualTo(
            api.tree("""{"success":false,"error":{"message":"The rendered template is too large.","id":null}}"""),
        )
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
        @DisplayName("Dado nove cabeçalhos templados de 8 KiB (72 KiB somados), quando o webhook chega, então responde 500 com o envelope")
        fun capture_somaDosCabecalhosAcimaDoTeto_deveResponder500() {
            val headers = (1..9).joinToString(",") { "\"X-Eco-$it\":\"{{randomValue type='HEX' length=$MAX_RENDERED_HEADER}}\"" }
            val tokenId = tokenWithRule("""{"template":true,"headers":{$headers}}""")

            val response = api.send("GET", "/$tokenId", headers = JSON_CLIENT)

            assertTooLarge(response)
            assertThat(response.headers().firstValue("X-Eco-1")).isEmpty()
            assertStoredWithRule(tokenId)
        }

        @Test
        @DisplayName("Dado each com jsonPath caro sobre um corpo de ~900 KB, quando o webhook chega, então para a tempo e responde 500")
        fun capture_jsonPathCaroSobreCorpoGrande_deveResponder500() {
            val union = List(10) { "0" }.joinToString(",", "[", "]").repeat(20)
            val template = "{{#each request.headers}}{{jsonPath request.body '$.n$union'}}{{/each}}"
            val tokenId = tokenWithRule("""{"template":true,"body":"$template"}""")
            val body = """{"pad":"${"p".repeat(900_000)}","n":${"[".repeat(20)}1${"]".repeat(20)}}"""

            val (response, elapsed) = timed { api.send("POST", "/$tokenId", body.toByteArray(), crowdedHeaders(50) + JSON_BODY) }

            assertTooLarge(response)
            assertThat(elapsed).isLessThan(FAST)
            assertStoredWithRule(tokenId)
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
    @DisplayName("Tetos de compilação ao salvar")
    inner class CompileLimits {
        @Test
        @DisplayName("Dado 40 mil blocos if aninhados, quando salva, então responde 422 (e não 500)")
        fun put_quarentaMilBlocos_deveResponder422() {
            val body = "{{#if seq}}".repeat(40_000) + "{{/if}}".repeat(40_000)

            val response = putRule("""{"template":true,"body":"$body"}""")

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(
                api.tree("""{"0.response.body":["The template is invalid: longer than 65536 characters."]}"""),
            )
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado uma regra gravada antes dos tetos, quando o webhook chega, então grava a mensagem e responde 500 com o motivo")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            corpo acima de 64 KiB   | The template is invalid: longer than 65536 characters.
            cabeçalho com 33 blocos | The template is invalid: blocks nested more than 32 levels deep (line 1, column 353).""",
        )
        fun capture_regraGravadaAntesDosTetos_deveResponder500ComOMotivo(
            shape: String,
            expected: String,
        ) {
            val tokenId = tokenWithRule("""{"template":true,"headers":{"X-Eco":"h"},"body":"b"}""")
            val key = "token:$tokenId:rules"
            val stored = checkNotNull(redis.opsForValue().get(key))
            val nested = "{{#if seq}}".repeat(MAX_TEMPLATE_NESTING + 1) + "{{/if}}".repeat(MAX_TEMPLATE_NESTING + 1)
            val beforeLimits =
                when (shape) {
                    "corpo acima de 64 KiB" -> stored.replace("\"body\":\"b\"", "\"body\":\"${"a".repeat(MAX_TEMPLATE_LENGTH + 1)}\"")
                    else -> stored.replace("\"X-Eco\":\"h\"", "\"X-Eco\":\"$nested\"")
                }
            assertThat(beforeLimits).isNotEqualTo(stored)
            redis.opsForValue().set(key, beforeLimits, Duration.ofHours(1))

            val response = api.send("GET", "/$tokenId", headers = JSON_CLIENT)

            assertThat(response.statusCode()).isEqualTo(500)
            assertThat(api.json(response)).isEqualTo(api.tree("""{"success":false,"error":{"message":"$expected","id":null}}"""))
            assertThat(response.headers().firstValue("X-Eco")).isEmpty()
            assertStoredWithRule(tokenId)
            assertThat(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT).statusCode()).isEqualTo(200)
        }

        @Test
        @DisplayName("Dado 33 blocos aninhados num cabeçalho, quando salva, então responde 422 com o aninhamento na chave do cabeçalho")
        fun put_aninhamentoAcimaDoTeto_deveResponder422() {
            val value = "{{#if seq}}".repeat(MAX_TEMPLATE_NESTING + 1) + "{{/if}}".repeat(MAX_TEMPLATE_NESTING + 1)

            val response = putRule("""{"template":true,"headers":{"X-Eco":"$value"}}""")

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(
                api.tree(
                    """{"0.response.headers.X-Eco":""" +
                        """["The template is invalid: blocks nested more than 32 levels deep (line 1, column 353)."]}""",
                ),
            )
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

        @Test
        @DisplayName("Dado U+2028, emoji e letra acima de U+00FF num cabeçalho templado, quando responde, então cada um sai como ?")
        fun capture_foraDoLatin1NoCabecalhoTemplado_deveSairInterrogacao() {
            val tokenId = tokenWithRule("""{"template":true,"headers":{"X-Eco":"<{{jsonPath request.body '$.v'}}>"}}""")

            val lines = responseHeadLines(tokenId, """{"v":"a\u2028b\u2029c ĉ 😀 é"}""")

            assertThat(lines).contains("X-Eco: <a?b?c ? ? é>")
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um cabeçalho fixo com controle C0, DEL ou C1, quando responde sem template, então cada um sai como espaço")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            a\u000bb\u0085c | X-Fixo: <a b c>
            a\u007fb\u009fc | X-Fixo: <a b c>
            a\u0085b ĉ      | X-Fixo: <a b ?>""",
        )
        fun capture_controleNoCabecalhoFixo_deveSairEspaco(
            fixed: String,
            expectedLine: String,
        ) {
            val tokenId = tokenWithRule("""{"headers":{"X-Fixo":"<$fixed>"}}""")

            val lines = responseHeadLines(tokenId, "{}")

            assertThat(lines).contains(expectedLine)
            assertThat(lines.joinToString("\n")).doesNotContain("\u0085", "\u000b", "\u007f", "\u009f")
        }

        @Test
        @DisplayName("Dado um cabeçalho fixo com caractere acima de U+00FF, quando responde sem template, então sai com ? e não some")
        fun capture_foraDoLatin1NoCabecalhoFixo_deveSairInterrogacao() {
            val tokenId = tokenWithRule("""{"headers":{"X-Fixo":"a\u2028b ĉ é"}}""")

            val lines = responseHeadLines(tokenId, "{}")

            assertThat(lines).contains("X-Fixo: a?b ? é")
        }
    }
}
