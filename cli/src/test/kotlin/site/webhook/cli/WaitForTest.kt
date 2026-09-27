package site.webhook.cli

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import site.webhook.cli.support.CliProcess
import site.webhook.cli.support.FakeAnzol
import site.webhook.cli.support.message
import java.net.ServerSocket
import java.nio.file.Path
import java.time.Duration
import kotlin.io.path.writeText

private const val MESSAGE = """{"uuid":"11111111-1111-4111-8111-111111111111","seq":7,"method":"POST","url":"http://x/t/p","content":"ç"}"""

@DisplayName("anzol wait-for")
class WaitForTest {
    private val site = FakeAnzol()
    private val token = site.createToken()
    private val cli = mutableListOf<CliProcess>()

    @AfterEach
    fun close() {
        cli.forEach(CliProcess::close)
        site.close()
    }

    private fun waitFor(vararg args: String): CliProcess = CliProcess("wait-for", *args).also(cli::add)

    private fun onSite(vararg args: String): CliProcess = waitFor("--token", token, "--server", site.base, *args)

    private fun sent(): JsonObject = site.waits.single()

    private fun json(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

    @Nested
    @DisplayName("Corpo da chamada")
    inner class Body {
        @Test
        @DisplayName("Dado só o token, quando roda, então pede match {}, count 1 e timeout 30000, sem after (histórico inteiro)")
        fun waitFor_padrao_deveMandarOsPadroes() {
            assertThat(onSite().awaitExit()).isZero()

            assertThat(sent()).isEqualTo(json("""{"match":{},"count":1,"timeout":30000}"""))
        }

        @Test
        @DisplayName("Dado --match-file, atalhos, --count, --timeout e --after, quando roda, então manda o match montado e os números")
        fun waitFor_opcoes_deveMontarOCorpo(
            @TempDir dir: Path,
        ) {
            val file = dir.resolve("match.json").also { it.writeText("""{"method":["GET"],"query":{"tipo":{"equals":"pix"}}}""") }

            val exit =
                onSite(
                    "--match-file",
                    file.toString(),
                    "--method",
                    "POST",
                    "--header",
                    "X-Conta: 7",
                    "--count",
                    "3",
                    "--timeout",
                    "500",
                    "--after",
                    "42",
                ).awaitExit()

            assertThat(exit).isZero()
            assertThat(sent()).isEqualTo(
                json(
                    """{"match":{"method":["POST"],"query":{"tipo":{"equals":"pix"}},"headers":{"X-Conta":{"equals":"7"}}},""" +
                        """"after":42,"count":3,"timeout":500}""",
                ),
            )
        }

        @Test
        @DisplayName("Dado --new, quando roda, então lê o seq da mensagem mais nova antes e o manda como after")
        fun waitFor_new_deveMandarOSeqMaisNovo() {
            site.store(message(token))
            site.store(message(token))

            assertThat(onSite("--new").awaitExit()).isZero()

            assertThat(sent()["after"].toString()).isEqualTo("2")
        }
    }

    @Nested
    @DisplayName("Saída e códigos")
    inner class Output {
        @Test
        @DisplayName("Dado matched, quando termina, então stdout é o array das mensagens, o resumo vai ao stderr e sai com 0")
        fun waitFor_casou_deveSair0() {
            site.waitReply = 200 to """{"matched":true,"count":1,"requests":[$MESSAGE],"near_miss":null}"""

            val process = onSite()

            assertThat(process.awaitExit()).isZero()
            assertThat(process.stdout).containsExactly("[$MESSAGE]")
            assertThat(process.stderr.single()).matches("""matched 1/1 in \d+ ms""")
        }

        @Test
        @DisplayName(
            "Dado matched=false com near miss, quando termina, então stdout traz as que casaram e o stderr o mais próximo, saída 1",
        )
        fun waitFor_prazo_deveSair1ComClosest() {
            val miss = """{"uuid":"22222222-2222-4222-8222-222222222222","seq":9,"failed":["method: expected POST, got GET","path: x"]}"""
            site.waitReply = 200 to """{"matched":false,"count":1,"requests":[$MESSAGE],"near_miss":$miss}"""

            val process = onSite("--count", "2")

            assertThat(process.awaitExit()).isEqualTo(1)
            assertThat(process.stdout).containsExactly("[$MESSAGE]")
            assertThat(process.stderr[0]).matches("""timed out after \d+ ms: 1/2 matched""")
            assertThat(process.stderr.drop(1)).containsExactly(
                "closest: #9 22222222-2222-4222-8222-222222222222",
                "  - method: expected POST, got GET",
                "  - path: x",
            )
        }

        @Test
        @DisplayName("Dado matched=false sem near miss, quando termina, então stdout [] e só a linha do prazo, saída 1")
        fun waitFor_prazoSemMensagens_deveSair1SemClosest() {
            site.waitReply = 200 to """{"matched":false,"count":0,"requests":[],"near_miss":null}"""

            val process = onSite()

            assertThat(process.awaitExit()).isEqualTo(1)
            assertThat(process.stdout).containsExactly("[]")
            assertThat(process.stderr.single()).matches("""timed out after \d+ ms: 0/1 matched""")
        }

        @Test
        @DisplayName("Dado um servidor que responde depois do --timeout, quando espera, então o prazo HTTP tem folga e a resposta vale")
        fun waitFor_respostaDepoisDoTimeout_deveAceitar() {
            site.waitDelay = Duration.ofMillis(1500)

            assertThat(onSite("--timeout", "500").awaitExit()).isZero()
        }

        @Test
        @DisplayName("Dado um 422, quando termina, então cada chave: mensagem no stderr, stdout vazio e saída 2")
        fun waitFor_422_deveSair2() {
            site.waitReply = 422 to """{"match.path.regex":["The regex is invalid."],"count":["The count must be between 1 and 100."]}"""

            val process = onSite()

            assertThat(process.awaitExit()).isEqualTo(2)
            assertThat(process.stdout).isEmpty()
            assertThat(
                process.stderr,
            ).containsExactly("match.path.regex: The regex is invalid.", "count: The count must be between 1 and 100.")
        }

        @Test
        @DisplayName("Dado um token inexistente, quando roda (com ou sem --new), então Token not found e saída 2")
        fun waitFor_tokenInexistente_deveSair2() {
            site.deleteToken(token)

            listOf(onSite(), onSite("--new")).forEach { process ->
                assertThat(process.awaitExit()).isEqualTo(2)
                assertThat(process.stderr).containsExactly("Token not found")
            }
        }

        @Test
        @DisplayName("Dado o servidor fora do ar, quando roda, então Could not reach e saída 2")
        fun waitFor_servidorFora_deveSair2() {
            val closedPort = ServerSocket(0).use { it.localPort }

            val process = waitFor("--token", token, "--server", "http://127.0.0.1:$closedPort")

            assertThat(process.awaitExit()).isEqualTo(2)
            assertThat(process.stderr.single()).isEqualTo("Could not reach http://127.0.0.1:$closedPort: connection refused")
        }
    }

    @Nested
    @DisplayName("Uso inválido")
    inner class Usage {
        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado opções inválidas, quando roda, então sai com 2 sem chamar o servidor")
        @ValueSource(
            strings = [
                "--after 1 --new",
                "--match {} --match-file x.json",
                "--match [1]",
                "--match {\"method\":[POST]}",
                "--match-file nao-existe.json",
                "--header semdoispontos",
                "--count abc",
                "--timeout 1.5",
                "--opcao-que-nao-existe",
            ],
        )
        fun waitFor_usoInvalido_deveSair2(args: String) {
            val process = onSite(*args.split(' ').toTypedArray())

            assertThat(process.awaitExit()).isEqualTo(2)
            assertThat(process.stderr).isNotEmpty()
            assertThat(site.waits).isEmpty()
        }

        @Test
        @DisplayName("Dado nenhum --token, quando roda, então sai com 2")
        fun waitFor_semToken_deveSair2() {
            assertThat(waitFor("--server", site.base).awaitExit()).isEqualTo(2)
        }

        @Test
        @DisplayName("Dado um uso inválido, quando o CLI mostra o uso, então o comando se chama anzol")
        fun waitFor_usoInvalido_deveMostrarOComandoAnzol() {
            val process = waitFor("--server", site.base)

            assertThat(process.awaitExit()).isEqualTo(2)
            assertThat(process.stderr).anySatisfy { assertThat(it).startsWith("Usage: anzol wait-for") }
        }

        @Test
        @DisplayName("Dado os outros comandos, quando o uso é inválido, então continuam saindo com 1")
        fun outrosComandos_usoInvalido_deveSair1() {
            val process = CliProcess("send", "--retries", "abc").also(cli::add)

            assertThat(process.awaitExit()).isEqualTo(1)
        }
    }
}
