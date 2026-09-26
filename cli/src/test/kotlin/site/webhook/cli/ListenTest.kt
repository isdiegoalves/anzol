package site.webhook.cli

import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import site.webhook.cli.support.CliProcess
import site.webhook.cli.support.FakeLocalApp
import site.webhook.cli.support.FakeWebhookSite
import site.webhook.cli.support.Received
import site.webhook.cli.support.forwardedLine
import site.webhook.cli.support.message
import java.time.Duration

@DisplayName("webhook listen")
class ListenTest {
    private val site = FakeWebhookSite()
    private val app = FakeLocalApp()
    private val cli = mutableListOf<CliProcess>()

    @AfterEach
    fun close() {
        cli.forEach(CliProcess::close)
        app.close()
        site.close()
    }

    /** Sobe o `listen` com `--token` e espera a linha de início, impressa com o SSE já assinado. */
    private fun listen(
        token: String,
        forward: String = app.url,
    ): CliProcess {
        val process = CliProcess("listen", "--server", site.base, "--forward", forward, "--token", token).also(cli::add)
        process.awaitLine(Regex(Regex.escape("Listening on ${site.base}/$token (forwarding to $forward)")))
        return process
    }

    private fun awaitReceived(count: Int): List<Received> {
        await().atMost(Duration.ofSeconds(10)).until { app.received.size >= count }
        return app.received.toList()
    }

    @Nested
    @DisplayName("Encaminhamento de uma mensagem")
    inner class Forwarding {
        @Test
        @DisplayName("Dado o listen com --token, quando chega um POST, então o app local recebe método, caminho, query e corpo iguais")
        fun listen_postGravado_deveReenviarMetodoCaminhoQueryECorpo() {
            val token = site.createToken()
            app.status = 201
            val cli = listen(token)

            site.publish(
                message(
                    token,
                    method = "POST",
                    target = "/pedidos/42?a=1&b=%C3%A7",
                    headers = mapOf("content-type" to listOf("application/json"), "content-length" to listOf("11")),
                    content = """{"id":"ç"}""",
                ),
            )

            val received = awaitReceived(1).single()
            assertThat(received.method).isEqualTo("POST")
            assertThat(received.path).isEqualTo("/pedidos/42")
            assertThat(received.query).isEqualTo("a=1&b=%C3%A7")
            assertThat(received.body).isEqualTo("""{"id":"ç"}""")
            assertThat(received.headers["content-type"]).containsExactly("application/json")
            cli.awaitLine(forwardedLine("POST", "/pedidos/42?a=1&b=%C3%A7", 201))
        }

        @Test
        @DisplayName("Dado headers gravados, quando reenvia, então descarta hop-by-hop, host e content-length e mantém o resto")
        fun listen_headersGravados_deveDescartarHopByHopEManterOsDemais() {
            val token = site.createToken()
            listen(token)
            val headers =
                mapOf(
                    "x-foo" to listOf("com underscore na origem"),
                    "x-repetido" to listOf("um", "dois"),
                    "user-agent" to listOf("Stripe/1.0"),
                    "content-type" to listOf(""),
                    "host" to listOf("webhook.site"),
                    "content-length" to listOf("999"),
                    "connection" to listOf("close"),
                    "keep-alive" to listOf("timeout=5"),
                    "transfer-encoding" to listOf("chunked"),
                    "te" to listOf("trailers"),
                    "trailer" to listOf("x-fim"),
                    "upgrade" to listOf("h2c"),
                    "proxy-authorization" to listOf("Basic eDp5"),
                    "proxy-connection" to listOf("keep-alive"),
                )

            site.publish(message(token, headers = headers, content = "abc"))

            val received = awaitReceived(1).single()
            assertThat(received.headers["x-foo"]).containsExactly("com underscore na origem")
            assertThat(received.headers["x-repetido"]).containsExactly("um", "dois")
            assertThat(received.headers["user-agent"]).containsExactly("Stripe/1.0")
            assertThat(received.headers["content-type"]).containsExactly("")
            assertThat(received.headers["host"]).containsExactly(app.url.removePrefix("http://"))
            assertThat(received.headers["content-length"]).containsExactly("3")
            assertThat(received.headers)
                .doesNotContainKeys("keep-alive", "transfer-encoding", "te", "trailer", "upgrade")
                .doesNotContainKeys("proxy-authorization", "proxy-connection")
            assertThat(received.headers["connection"].orEmpty()).doesNotContain("close")
        }

        @Test
        @DisplayName("Dado mensagem na raiz do token e --forward com caminho e barra final, quando reenvia, então vai a esse caminho")
        fun listen_mensagemNaRaiz_deveReenviarAoCaminhoDoForward() {
            val token = site.createToken()
            val cli = listen(token, forward = "${app.url}/hooks/")

            site.publish(message(token, method = "GET"))

            assertThat(awaitReceived(1).single().path).isEqualTo("/hooks")
            cli.awaitLine(forwardedLine("GET", "/", 200))
        }
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource("GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")
    @DisplayName("Dado uma mensagem com o método, quando reenvia, então o app local recebe o mesmo método")
    fun listen_cadaMetodo_deveReenviarComOMesmoMetodo(method: String) {
        val token = site.createToken()
        val cli = listen(token)

        site.publish(message(token, method = method, target = "/x"))

        assertThat(awaitReceived(1).single().method).isEqualTo(method)
        cli.awaitLine(forwardedLine(method, "/x", 200))
    }

    @Test
    @DisplayName("Dado três mensagens seguidas, quando reenvia, então o app local as recebe na ordem de chegada")
    fun listen_variasMensagens_deveReenviarNaOrdemDeChegada() {
        val token = site.createToken()
        listen(token)

        (1..3).forEach { site.publish(message(token, target = "/$it")) }

        assertThat(awaitReceived(3).map { it.path }).containsExactly("/1", "/2", "/3")
    }
}
