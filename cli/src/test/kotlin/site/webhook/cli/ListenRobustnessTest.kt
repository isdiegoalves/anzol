package site.webhook.cli

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import site.webhook.cli.support.CliProcess
import site.webhook.cli.support.FakeLocalApp
import site.webhook.cli.support.FakeWebhookSite
import site.webhook.cli.support.Received
import site.webhook.cli.support.forwardedLine
import site.webhook.cli.support.message
import site.webhook.cli.support.with
import java.time.Duration

private val ANY_FORWARD_LINE = Regex("""\d{2}:\d{2}:\d{2} \S+ \S+ -> .*""")

@DisplayName("webhook listen: robustez")
class ListenRobustnessTest {
    private val site = FakeWebhookSite()
    private val apps = mutableListOf(FakeLocalApp())
    private val app get() = apps.first()
    private val cli = mutableListOf<CliProcess>()

    @AfterEach
    fun close() {
        cli.forEach(CliProcess::close)
        apps.forEach(FakeLocalApp::close)
        site.close()
    }

    private fun listen(
        token: String,
        forward: String = app.url,
    ): CliProcess {
        val process = CliProcess("listen", "--server", site.base, "--forward", forward, "--token", token).also(cli::add)
        process.awaitLine(Regex(Regex.escape("Listening on ${site.base}/$token (forwarding to $forward)")))
        return process
    }

    private fun awaitReceived(count: Int): List<Received> {
        await().atMost(Duration.ofSeconds(15)).until { app.received.size >= count }
        return app.received.toList()
    }

    /** Derruba o SSE e o mantém recusado enquanto [whileDown] roda; depois deixa o CLI voltar. */
    private fun outage(whileDown: () -> Unit) {
        site.streamsRefused = true
        site.dropConnections()
        whileDown()
        site.streamsRefused = false
    }

    @Test
    @DisplayName("Dado um evento truncado (> 1 MB), quando reenvia, então busca a mensagem inteira e o app local recebe o corpo todo")
    fun listen_eventoTruncado_deveBuscarMensagemInteira() {
        val token = site.createToken()
        listen(token)
        val content = "a".repeat(1_100_000)

        site.publish(message(token, target = "/grande", content = content), truncated = true)

        val received = awaitReceived(1).single()
        assertThat(received.body).hasSize(content.length).isEqualTo(content)
        assertThat(received.headers["content-type"]).containsExactly("text/plain")
    }

    @Test
    @DisplayName("Dado o app local fora do ar, quando chega mensagem, então imprime error: e reenvia a próxima quando o app volta")
    fun listen_appLocalForaDoAr_deveImprimirErroESeguirOuvindo() {
        val token = site.createToken()
        val port = FakeLocalApp.freePort()
        val cli = listen(token, forward = "http://127.0.0.1:$port")

        site.publish(message(token, target = "/primeira"))
        cli.awaitLine(Regex("""\d{2}:\d{2}:\d{2} POST /primeira -> error: connection refused"""))
        apps += FakeLocalApp(port = port)
        site.publish(message(token, target = "/segunda"))

        cli.awaitLine(forwardedLine("POST", "/segunda", 200))
        assertThat(apps.last().received.map { it.path }).containsExactly("/segunda")
    }

    @Test
    @DisplayName("Dado um multipart gravado, quando reenvia, então remonta os campos de texto com o boundary gravado e avisa dos arquivos")
    fun listen_multipart_deveReenviarCamposDeTextoEAvisar() {
        val token = site.createToken()
        val cli = listen(token)
        val fields =
            buildJsonObject {
                put("nome", "Ana")
                put(
                    "tags",
                    buildJsonArray {
                        add(JsonPrimitive("a"))
                        add(JsonPrimitive("b"))
                    },
                )
                putJsonObject("end") { put("rua", "X") }
            }
        val contentType = "multipart/form-data; boundary=----b0undary"

        site.publish(message(token, target = "/upload", headers = mapOf("content-type" to listOf(contentType))).with("request", fields))

        val received = awaitReceived(1).single()
        assertThat(received.headers["content-type"]).containsExactly(contentType)
        assertThat(received.body).isEqualTo(
            listOf("nome" to "Ana", "tags[0]" to "a", "tags[1]" to "b", "end[rua]" to "X").joinToString("") { (name, value) ->
                "------b0undary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n"
            } + "------b0undary--\r\n",
        )
        cli.awaitLine(
            Regex(forwardedLine("POST", "/upload", 200).pattern + Regex.escape(" [files were not forwarded: not stored by the server]")),
        )
    }

    @Test
    @DisplayName("Dado o listen rodando, quando recebe Ctrl+C, então sai com 0")
    fun listen_ctrlC_deveSairComZero() {
        val cli = listen(site.createToken())

        cli.interrupt()

        assertThat(cli.awaitExit()).isEqualTo(0)
    }

    @Nested
    @DisplayName("Queda da conexão com o servidor")
    inner class Reconnection {
        @Test
        @DisplayName(
            "Dado mensagens gravadas durante a queda, quando reconecta, então reenvia as da janela em ordem, sem repetir as de antes",
        )
        fun listen_quedaComMensagens_deveReenviarAsDaJanelaEmOrdemSemDuplicar() {
            val token = site.createToken()
            val cli = listen(token)
            site.publish(message(token, target = "/1"))
            awaitReceived(1)

            outage { (2..3).forEach { site.store(message(token, target = "/$it")) } }
            cli.awaitLine(Regex(Regex.escape("Reconnected; forwarding 2 missed request(s)")))
            site.publish(message(token, target = "/4"))

            assertThat(awaitReceived(4).map { it.path }).containsExactly("/1", "/2", "/3", "/4")
            assertThat(cli.stdout.filter(ANY_FORWARD_LINE::matches)).hasSize(4)
        }

        @Test
        @DisplayName("Dado mensagens anteriores ao listen e nenhuma na queda, quando reconecta, então não reenvia nada")
        fun listen_quedaSemMensagens_naoDeveReenviarHistorico() {
            val token = site.createToken()
            site.store(message(token, target = "/antiga"))
            val cli = listen(token)

            outage {}

            cli.awaitLine(Regex(Regex.escape("Reconnected; forwarding 0 missed request(s)")))
            site.publish(message(token, target = "/nova"))
            assertThat(awaitReceived(1).map { it.path }).containsExactly("/nova")
        }

        @Test
        @DisplayName("Dado 55 mensagens na queda (mais de uma página da listagem), quando reconecta, então reenvia as 55 em ordem")
        fun listen_quedaLonga_devePercorrerPaginasDaListagem() {
            val token = site.createToken()
            val cli = listen(token)

            outage { (1..55).forEach { site.store(message(token, target = "/$it")) } }

            cli.awaitLine(Regex(Regex.escape("Reconnected; forwarding 55 missed request(s)")))
            assertThat(awaitReceived(55).map { it.path }).containsExactlyElementsOf((1..55).map { "/$it" })
        }

        @Test
        @DisplayName("Dado mensagem que chega logo após a reassinatura, quando está no SSE e na listagem, então reenvia uma vez só")
        fun listen_mensagemNoSseENaListagem_deveReenviarUmaVez() {
            val token = site.createToken()
            val cli = listen(token)
            val overlapping = message(token, target = "/dupla")
            site.onNextSubscribe = { site.publish(overlapping) }

            outage { site.store(message(token, target = "/queda")) }

            cli.awaitLine(Regex(Regex.escape("Reconnected; forwarding 2 missed request(s)")))
            site.publish(message(token, target = "/depois"))
            assertThat(awaitReceived(3).map { it.path }).containsExactly("/queda", "/dupla", "/depois")
        }

        @Test
        @DisplayName("Dado a última reenviada apagada na queda, quando reconecta, então reenvia só as mais novas que ela")
        fun listen_ultimaReenviadaApagada_deveReenviarSoAsMaisNovas() {
            val token = site.createToken()
            site.store(message(token, target = "/historico").with("created_at", JsonPrimitive("2020-01-01 00:00:00")))
            val cli = listen(token)
            val last = message(token, target = "/ultima")
            site.publish(last)
            awaitReceived(1)

            outage {
                site.remove(last)
                site.store(message(token, target = "/queda"))
            }

            cli.awaitLine(Regex(Regex.escape("Reconnected; forwarding 1 missed request(s)")))
            assertThat(awaitReceived(2).map { it.path }).containsExactly("/ultima", "/queda")
        }

        @Test
        @DisplayName("Dado o token apagado durante a queda, quando tenta reconectar, então escreve Token not found e sai com 1")
        fun listen_tokenApagadoNaQueda_deveSairComErro() {
            val token = site.createToken()
            val cli = listen(token)

            outage { site.deleteToken(token) }

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly("Token not found")
        }
    }
}
