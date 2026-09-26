package site.webhook.cli

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import site.webhook.cli.support.CliProcess
import site.webhook.cli.support.FakeLocalApp
import site.webhook.cli.support.FakeWebhookSite
import site.webhook.cli.support.forwardedLine
import site.webhook.cli.support.message
import site.webhook.cli.support.uuid
import java.nio.file.Path
import kotlin.io.path.writeText

private const val SECRET = "segredo-do-cli-3Kd"
private const val PROTECTED = "This URL is protected: pass --read-secret or set WEBHOOK_READ_SECRET"

/** `--read-secret` / `WEBHOOK_READ_SECRET` (item 12): o cabeçalho `X-Webhook-Secret` nas chamadas da URL, nunca na saída. */
@DisplayName("Segredo de leitura no CLI")
class ReadSecretTest {
    private val site = FakeWebhookSite()
    private val app = FakeLocalApp()
    private val cli = mutableListOf<CliProcess>()

    @AfterEach
    fun close() {
        cli.forEach(CliProcess::close)
        app.close()
        site.close()
    }

    private fun run(
        vararg args: String,
        env: Map<String, String> = emptyMap(),
    ): CliProcess = CliProcess(*args, env = env).also(cli::add)

    private fun protectedToken(secret: String = SECRET): String = site.createToken().also { site.protect(it, secret) }

    private fun CliProcess.output(): List<String> = stdout + stderr

    @Test
    @DisplayName("Dado --read-secret, quando roda listen, então toda chamada da URL leva o cabeçalho e as mensagens chegam")
    fun listen_comOpcao_deveMandarOCabecalho() {
        val token = protectedToken()
        val listen = run("listen", "--server", site.base, "--forward", app.url, "--token", token, "--read-secret", SECRET)
        listen.awaitLine(Regex(Regex.escape("Listening on ${site.base}/$token (forwarding to ${app.url})")))

        site.publish(message(token, target = "/privado"))

        listen.awaitLine(forwardedLine("POST", "/privado", 200))
        assertThat(site.secretHeaders).isNotEmpty().containsOnly(SECRET)
        assertThat(listen.output()).noneMatch { SECRET in it }
    }

    @Test
    @DisplayName("Dado WEBHOOK_READ_SECRET, quando roda replay, então reenvia a mensagem da URL protegida e sai com 0")
    fun replay_comVariavel_deveReenviar() {
        val token = protectedToken()
        val stored = message(token, target = "/pedido")
        site.store(stored)

        val replay =
            run("replay", token, stored.uuid(), "--to", app.url, "--server", site.base, env = mapOf("WEBHOOK_READ_SECRET" to SECRET))

        assertThat(replay.awaitExit()).isEqualTo(0)
        assertThat(app.received).hasSize(1)
        assertThat(site.secretHeaders).containsOnly(SECRET)
        assertThat(replay.output()).noneMatch { SECRET in it }
    }

    @Test
    @DisplayName("Dado --read-secret, quando roda wait-for e rules pull/push, então mandam o cabeçalho e saem com 0")
    fun waitForERules_comOpcao(
        @TempDir dir: Path,
    ) {
        val token = protectedToken()
        val file = dir.resolve("regras.json").also { it.writeText("""[{"name":"a"}]""") }

        val wait = run("wait-for", "--token", token, "--timeout", "0", "--server", site.base, "--read-secret", SECRET)
        val push = run("rules", "push", token, file.toString(), "--server", site.base, "--read-secret", SECRET)
        val pushed = push.awaitExit()
        val pull = run("rules", "pull", token, "--server", site.base, "--read-secret", SECRET)

        assertThat(wait.awaitExit()).isEqualTo(0)
        assertThat(pushed).isEqualTo(0)
        assertThat(pull.awaitExit()).isEqualTo(0)
        assertThat(site.secretHeaders).containsOnly(SECRET)
        assertThat(wait.output() + push.output() + pull.output()).noneMatch { SECRET in it }
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @ValueSource(strings = ["listen", "replay", "wait-for", "rules pull", "rules push"])
    @DisplayName("Dado uma URL protegida sem o segredo, quando roda o comando, então diz que está protegida e sai com erro")
    fun semSegredo_deveFalharComMensagemClara(
        command: String,
        @TempDir dir: Path,
    ) {
        val token = protectedToken()
        val file = dir.resolve("regras.json").also { it.writeText("[]") }
        val args =
            when (command) {
                "listen" -> listOf("listen", "--forward", app.url, "--token", token)
                "replay" -> listOf("replay", token, "00000000-0000-4000-8000-000000000000", "--to", app.url)
                "wait-for" -> listOf("wait-for", "--token", token, "--timeout", "0")
                "rules pull" -> listOf("rules", "pull", token)
                else -> listOf("rules", "push", token, file.toString())
            } + listOf("--server", site.base)

        val process = run(*args.toTypedArray())

        assertThat(process.awaitExit()).isEqualTo(if (command == "wait-for") WAIT_FOR_ERROR else 1)
        assertThat(process.stderr).contains(PROTECTED)
        assertThat(app.received).isEmpty()
        assertThat(site.rules(token)).isEmpty()
    }

    @Test
    @DisplayName("Dado o segredo errado, quando roda, então sai com erro sem imprimir o segredo errado")
    fun segredoErrado_naoDeveImprimir() {
        val token = protectedToken()

        val process = run("rules", "pull", token, "--server", site.base, "--read-secret", "errado-errado")

        assertThat(process.awaitExit()).isEqualTo(1)
        assertThat(process.stderr).contains(PROTECTED)
        assertThat(process.output()).noneMatch { "errado-errado" in it }
    }

    @Test
    @DisplayName("Dado um segredo fora do ASCII, quando roda, então recusa antes de chamar (o cabeçalho o trocaria por ?) sem imprimi-lo")
    fun segredoForaDoAscii_deveRecusar() {
        val token = protectedToken()

        val process = run("rules", "pull", token, "--server", site.base, "--read-secret", "senha-çãõ-123")

        assertThat(process.awaitExit()).isNotEqualTo(0)
        assertThat(process.stderr.joinToString("\n")).contains("printable ASCII")
        assertThat(process.output()).noneMatch { "senha-" in it }
        assertThat(site.secretHeaders).isEmpty()
    }

    @Test
    @DisplayName("Dado --read-secret numa URL aberta, quando roda, então funciona como sempre")
    fun urlAberta_comSegredo_deveFuncionar() {
        val token = site.createToken()

        val process = run("rules", "pull", token, "--server", site.base, "--read-secret", SECRET)

        assertThat(process.awaitExit()).isEqualTo(0)
    }
}
