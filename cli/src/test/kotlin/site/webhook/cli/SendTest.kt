package site.webhook.cli

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import site.webhook.cli.support.CliProcess
import site.webhook.cli.support.FakeReceiver
import site.webhook.cli.support.Reply
import java.nio.file.Path
import java.time.Duration
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.io.path.writeText

private const val SECRET = "s3gr3do-que-nao-aparece"
private val ATTEMPT_LINE = Regex("""\d{2}:\d{2}:\d{2} #\d+ attempt \d+/\d+ -> .*""")

@DisplayName("anzol send")
class SendTest {
    private val receivers = mutableListOf<FakeReceiver>()
    private val cli = mutableListOf<CliProcess>()

    @AfterEach
    fun close() {
        cli.forEach(CliProcess::close)
        receivers.forEach(FakeReceiver::close)
    }

    private fun receiver(receiver: FakeReceiver = FakeReceiver.capturing()): FakeReceiver = receiver.also(receivers::add)

    private fun send(vararg args: String): CliProcess = CliProcess("send", *args).also(cli::add)

    private fun millisBetween(
        receiver: FakeReceiver,
        from: Int,
        to: Int,
    ): Long = Duration.ofNanos(receiver.arrivals[to].nanos - receiver.arrivals[from].nanos).toMillis()

    @Nested
    @DisplayName("Envio e repetição")
    inner class Repeat {
        @Test
        @DisplayName("Dado --repeat 3, quando envia, então chegam 3 eventos com seq 1..3 e uuids diferentes, e sai com 0")
        fun send_repeat_deveMudarSeqEUuidPorEnvio() {
            val receiver = receiver()

            val cli =
                send(
                    "--to",
                    receiver.url + "/webhooks",
                    "--data",
                    """{"id":"{{uuid}}","seq":{{seq}}}""",
                    "--repeat",
                    "3",
                    "--interval",
                    "50",
                )

            assertThat(cli.awaitExit()).isEqualTo(0)
            val bodies = receiver.arrivals.map { it.text() }
            assertThat(bodies.map { it.substringAfter("\"seq\":") }).containsExactly("1}", "2}", "3}")
            assertThat(bodies.map { it.substringBefore(",") }.distinct()).hasSize(3)
            assertThat(millisBetween(receiver, 0, 1)).isGreaterThanOrEqualTo(50)
            assertThat(cli.stdout.filterNot(ATTEMPT_LINE::matches))
                .containsExactly("#1 delivered after 1 attempt(s)", "#2 delivered after 1 attempt(s)", "#3 delivered after 1 attempt(s)")
        }

        @Test
        @DisplayName("Dado um dos envios recusado com 404, quando termina, então os outros entregam e sai com 1")
        fun send_umEnvioRecusado_deveSairComUm() {
            val receiver = receiver(FakeReceiver(listOf(Reply(200), Reply(404), Reply(204))))

            val cli = send("--to", receiver.url, "--repeat", "3", "--retries", "2", "--method", "PUT")

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(receiver.arrivals.map { it.method }).containsExactly("PUT", "PUT", "PUT")
            assertThat(cli.stdout).contains("#2 gave up after 1 attempt(s)", "#3 delivered after 1 attempt(s)")
        }

        @Test
        @DisplayName("Dado --header com placeholder e --data-file, quando envia, então headers e corpo do arquivo chegam resolvidos")
        fun send_dataFileEHeaders_deveResolverPlaceholders(
            @TempDir dir: Path,
        ) {
            val receiver = receiver()
            val file = dir.resolve("evento.json").also { it.writeText("""{"evento":"pedido.pago","n":{{seq}}}""") }

            val cli =
                send(
                    "--to",
                    receiver.url,
                    "--data-file",
                    file.toString(),
                    "--header",
                    "X-Id: evt-{{seq}}",
                    "-H",
                    "Content-Type: application/json",
                )

            assertThat(cli.awaitExit()).isEqualTo(0)
            val arrival = receiver.arrivals.single()
            assertThat(arrival.text()).isEqualTo("""{"evento":"pedido.pago","n":1}""")
            assertThat(arrival.header("X-Id")).isEqualTo("evt-1")
            assertThat(arrival.header("Content-Type")).isEqualTo("application/json")
        }
    }

    @Nested
    @DisplayName("Assinatura pela linha de comando")
    inner class Signing {
        @Test
        @DisplayName(
            "Dado o genérico com algoritmo, codificação e prefixo, quando envia, então o header confere com o JCA e o segredo não sai",
        )
        fun send_generico_deveAssinarEEsconderOSegredo() {
            val receiver = receiver()

            val cli =
                send(
                    "--to",
                    receiver.url,
                    "--data",
                    "corpo",
                    "--provider",
                    "generic",
                    "--secret",
                    SECRET,
                    "--sig-header",
                    "X-Assinatura",
                    "--algorithm",
                    "sha512",
                    "--encoding",
                    "base64",
                    "--prefix",
                    "v1=",
                )

            assertThat(cli.awaitExit()).isEqualTo(0)
            val mac = Mac.getInstance("HmacSHA512").apply { init(SecretKeySpec(SECRET.toByteArray(), "HmacSHA512")) }
            val expected = "v1=" + Base64.getEncoder().encodeToString(mac.doFinal("corpo".toByteArray()))
            assertThat(receiver.arrivals.single().header("X-Assinatura")).isEqualTo(expected)
            assertThat(cli.stdout + cli.stderr).noneMatch { SECRET in it }
        }

        @ParameterizedTest(name = "{0}")
        @CsvSource(
            delimiter = '|',
            value = [
                "--secret x | --secret requires --provider",
                "--provider stripe | --provider requires --secret",
                "--provider generic --secret x | --provider generic requires --sig-header",
                "--provider github --secret x --sig-header X-A | " +
                    "--sig-header, --algorithm, --encoding and --prefix apply only to --provider generic",
                "--data a --data-file b | --data and --data-file cannot be used together",
                "--header semdoispontos | Invalid header (expected \"Name: value\"): semdoispontos",
                "--header Host:x | Header not allowed: Host",
                "--header X-Fixo:espaço | Header value must be ASCII (the HTTP client would send ? instead): X-Fixo",
                "--data {{foo}} | Invalid template in --data: unknown placeholder {{foo}}",
                "--header X:{{nada}} | Invalid template in --header: unknown placeholder {{nada}}",
                "--data-file /nao/existe.json | File not found: /nao/existe.json",
                "--to nao-e-url | Invalid URL (expected http:// or https://): nao-e-url",
            ],
        )
        @DisplayName("Dado uma combinação inválida, quando roda, então diz o motivo no stderr, não envia nada e sai com 1")
        fun send_combinacaoInvalida_deveRecusarSemEnviar(
            args: String,
            message: String,
        ) {
            val receiver = receiver()

            val cli = send("--to", receiver.url, *args.split(' ').toTypedArray())

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly(message)
            assertThat(receiver.arrivals).isEmpty()
        }
    }

    @Nested
    @DisplayName("Retentativa em tempo real")
    inner class RealTime {
        @Test
        @DisplayName("Dado 503 duas vezes, quando envia com backoff fixo de 100 ms, então espera entre as tentativas e entrega")
        fun send_backoffFixo_deveEsperarEntreTentativas() {
            val receiver = receiver(FakeReceiver.failing(times = 2))

            val cli = send("--to", receiver.url, "--retries", "3", "--backoff", "fixed", "--initial-delay", "100")

            assertThat(cli.awaitExit()).isEqualTo(0)
            assertThat(receiver.arrivals).hasSize(3)
            assertThat(millisBetween(receiver, 0, 1)).isGreaterThanOrEqualTo(100)
            assertThat(millisBetween(receiver, 1, 2)).isGreaterThanOrEqualTo(100)
            assertThat(cli.stdout).last().isEqualTo("#1 delivered after 3 attempt(s)")
        }

        @Test
        @DisplayName("Dado Retry-After: 1 e --max-delay 300, quando retenta, então espera 300 ms e não 1 s")
        fun send_retryAfterComTeto_deveEsperarOTeto() {
            val receiver = receiver(FakeReceiver.retryAfter("1"))

            val cli = send("--to", receiver.url, "--retries", "1", "--max-delay", "300")

            assertThat(cli.awaitExit()).isEqualTo(0)
            assertThat(millisBetween(receiver, 0, 1)).isBetween(300, 999)
            assertThat(cli.stdout.first()).matches(""".* -> 429 \(\d+ ms\), retrying in 300 ms \(Retry-After\)""")
        }

        @Test
        @DisplayName("Dado Ctrl+C durante a espera da retentativa, quando interrompe, então sai com 130 sem reenviar")
        fun send_ctrlCNaEspera_deveSairCom130SemReenviar() {
            val receiver = receiver(FakeReceiver.failing(times = 10))
            val cli = send("--to", receiver.url, "--retries", "5", "--initial-delay", "20000")
            cli.awaitLine(Regex(""".* -> 503 \(\d+ ms\), retrying in 20000 ms"""))

            cli.interrupt()

            assertThat(cli.awaitExit()).isEqualTo(130)
            assertThat(receiver.arrivals).hasSize(1)
        }
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(
        delimiter = '|',
        value = ["--retries 11", "--repeat 0", "--initial-delay -1", "--timeout 0", "--backoff linear", "--provider paypal --secret x"],
    )
    @DisplayName("Dado um valor fora do permitido, quando roda, então é erro de uso e não envia nada")
    fun send_valorForaDoPermitido_deveSerErroDeUso(args: String) {
        val receiver = receiver()

        val cli = send("--to", receiver.url, *args.split(' ').toTypedArray())

        assertThat(cli.awaitExit()).isEqualTo(1)
        assertThat(cli.stderr.joinToString("\n")).contains("Error: invalid value for ${args.substringBefore(' ')}")
        assertThat(receiver.arrivals).isEmpty()
    }
}
