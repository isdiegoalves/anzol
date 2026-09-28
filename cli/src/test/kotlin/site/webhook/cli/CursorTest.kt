package site.webhook.cli

import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import site.webhook.cli.support.CliProcess
import site.webhook.cli.support.FakeAnzol
import site.webhook.cli.support.FakeLocalApp
import site.webhook.cli.support.message
import java.util.UUID

private const val SECRET = "segredo-do-cursor-7Qp"

/**
 * `anzol cursor <token>`: a posição da fila (o `seq` da mensagem mais nova, `0` sem mensagens), para o teste lê-la antes
 * do disparo e esperar com `wait-for --after`. O stdout é só o número: vai dentro de `$(anzol cursor …)`.
 */
@DisplayName("anzol cursor")
class CursorTest {
    private val site = FakeAnzol()
    private val cli = mutableListOf<CliProcess>()

    @AfterEach
    fun close() {
        cli.forEach(CliProcess::close)
        site.close()
    }

    private fun run(
        vararg args: String,
        env: Map<String, String> = emptyMap(),
    ): CliProcess = CliProcess("cursor", *args, env = env).also(cli::add)

    @Test
    @DisplayName("Dado uma URL sem mensagens, quando roda cursor, então imprime 0 e sai com 0")
    fun cursor_urlVazia_deveImprimirZero() {
        val cli = run(site.createToken(), "--server", site.base)

        assertThat(cli.awaitExit()).isEqualTo(0)
        assertThat(cli.stdout).containsExactly("0")
        assertThat(cli.stderr).isEmpty()
    }

    @Test
    @DisplayName("Dado uma URL com mensagens, quando roda cursor, então imprime só o seq da mais nova")
    fun cursor_urlComMensagens_deveImprimirOSeqDaMaisNova() {
        val token = site.createToken()
        site.store(message(token, target = "/a"))
        val newest = site.store(message(token, target = "/b"))

        val cli = run(token, env = mapOf("WEBHOOK_SERVER" to site.base))

        assertThat(cli.awaitExit()).isEqualTo(0)
        assertThat(cli.stdout).containsExactly(
            newest
                .getValue("seq")
                .jsonPrimitive.long
                .toString(),
        )
    }

    @Test
    @DisplayName("Dado um token que não existe, quando roda cursor, então escreve Token not found, não imprime número e sai com 1")
    fun cursor_tokenInexistente_deveSairComErro() {
        val cli = run(UUID.randomUUID().toString(), "--server", site.base)

        assertThat(cli.awaitExit()).isEqualTo(1)
        assertThat(cli.stderr).containsExactly("Token not found")
        assertThat(cli.stdout).isEmpty()
    }

    @Test
    @DisplayName(
        "Dado uma URL protegida, quando roda cursor com e sem --read-secret, então imprime o cursor ou avisa, sem mostrar o segredo",
    )
    fun cursor_urlProtegida_deveExigirOSegredo() {
        val token = site.createToken().also { site.protect(it, SECRET) }
        val newest = site.store(message(token, target = "/a"))

        val com = run(token, "--read-secret", SECRET, "--server", site.base)
        val sem = run(token, "--server", site.base)

        assertThat(com.awaitExit()).isEqualTo(0)
        assertThat(com.stdout).containsExactly(
            newest
                .getValue("seq")
                .jsonPrimitive.long
                .toString(),
        )
        assertThat(sem.awaitExit()).isEqualTo(1)
        assertThat(sem.stdout).isEmpty()
        assertThat(sem.stderr).containsExactly("This URL is protected: pass --read-secret or set WEBHOOK_READ_SECRET")
        assertThat(com.stdout + com.stderr + sem.stderr).noneMatch { SECRET in it }
    }

    @Test
    @DisplayName("Dado o servidor fora do ar, quando roda cursor, então escreve Could not reach e sai com 1")
    fun cursor_servidorForaDoAr_deveSairComErro() {
        val server = "http://127.0.0.1:${FakeLocalApp.freePort()}"

        val cli = run(UUID.randomUUID().toString(), "--server", server)

        assertThat(cli.awaitExit()).isEqualTo(1)
        assertThat(cli.stderr).containsExactly("Could not reach $server: connection refused")
        assertThat(cli.stdout).isEmpty()
    }
}
