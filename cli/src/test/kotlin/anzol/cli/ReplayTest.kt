package anzol.cli

import anzol.cli.support.CliProcess
import anzol.cli.support.FakeAnzol
import anzol.cli.support.FakeLocalApp
import anzol.cli.support.forwardedLine
import anzol.cli.support.message
import anzol.cli.support.uuid
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.util.UUID

@DisplayName("anzol replay")
class ReplayTest {
    private val site = FakeAnzol()
    private val app = FakeLocalApp()
    private val cli = mutableListOf<CliProcess>()

    @AfterEach
    fun close() {
        cli.forEach(CliProcess::close)
        app.close()
        site.close()
    }

    private fun replay(
        token: String,
        requestId: String,
    ): CliProcess = CliProcess("replay", token, requestId, "--to", app.url, "--server", site.base).also(cli::add)

    @Test
    @DisplayName("Dado uma mensagem gravada, quando roda replay, então o app local a recebe como no listen e o CLI sai com 0")
    fun replay_mensagemGravada_deveReenviarESairComZero() {
        val token = site.createToken()
        val stored =
            message(
                token,
                method = "PUT",
                target = "/pedidos/7?x=1",
                headers = mapOf("content-type" to listOf("application/json"), "x-assinatura" to listOf("abc")),
                content = """{"ok":true}""",
            )
        site.store(stored)
        app.status = 202

        val cli = replay(token, stored.uuid())

        assertThat(cli.awaitExit()).isEqualTo(0)
        val received = app.received.single()
        assertThat(received.method).isEqualTo("PUT")
        assertThat(received.path).isEqualTo("/pedidos/7")
        assertThat(received.query).isEqualTo("x=1")
        assertThat(received.headers["x-assinatura"]).containsExactly("abc")
        assertThat(received.body).isEqualTo("""{"ok":true}""")
        assertThat(cli.stdout).singleElement().matches { forwardedLine("PUT", "/pedidos/7?x=1", 202).matches(it) }
    }

    @Test
    @DisplayName("Dado um token que não existe, quando roda replay, então escreve Token not found no stderr e sai com 1")
    fun replay_tokenInexistente_deveSairComErro() {
        val cli = replay(UUID.randomUUID().toString(), UUID.randomUUID().toString())

        assertThat(cli.awaitExit()).isEqualTo(1)
        assertThat(cli.stderr).containsExactly("Token not found")
        assertThat(app.received).isEmpty()
    }

    @Test
    @DisplayName("Dado uma mensagem que não existe no token, quando roda replay, então escreve Request not found e sai com 1")
    fun replay_mensagemInexistente_deveSairComErro() {
        val token = site.createToken()

        val cli = replay(token, UUID.randomUUID().toString())

        assertThat(cli.awaitExit()).isEqualTo(1)
        assertThat(cli.stderr).containsExactly("Request not found")
        assertThat(app.received).isEmpty()
    }
}
