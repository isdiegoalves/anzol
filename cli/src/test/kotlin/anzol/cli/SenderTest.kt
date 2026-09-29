package anzol.cli

import anzol.cli.support.Arrival
import anzol.cli.support.FakeLocalApp
import anzol.cli.support.FakeReceiver
import anzol.cli.support.Reply
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.net.URI
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val SECRET = "whsec_simulador"

/** Relógio que só anda quando o [Sender] "dorme": as esperas não custam tempo de teste. */
private class SteppingClock(
    @Volatile var now: Instant = Instant.parse("2026-09-26T14:00:00Z"),
) : Clock() {
    override fun getZone(): ZoneId = ZoneOffset.UTC

    override fun withZone(zone: ZoneId?): Clock = this

    override fun instant(): Instant = now
}

/** `Stripe-Signature` confere com o corpo, pela fórmula da verificação do backend. */
private fun Arrival.stripeValid(secret: String): Boolean {
    val header = header("Stripe-Signature").orEmpty()
    val t = header.substringAfter("t=").substringBefore(',')
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret.toByteArray(), "HmacSHA256"))
    mac.update("$t.".toByteArray())
    return header.substringAfter("v1=") == HexFormat.of().formatHex(mac.doFinal(body))
}

private fun line(
    seq: Int,
    attempt: String,
    result: String,
): Regex = Regex("""\d{2}:\d{2}:\d{2} #$seq attempt $attempt -> $result""")

@DisplayName("Envio com retentativa")
class SenderTest {
    private val receivers = mutableListOf<AutoCloseable>()
    private val clock = SteppingClock()
    private val sleeps = mutableListOf<Duration>()
    private val lines = mutableListOf<String>()

    @AfterEach
    fun close() = receivers.forEach(AutoCloseable::close)

    private fun <T : AutoCloseable> T.closing(): T = also(receivers::add)

    /** POST com JSON e placeholders, sem assinatura, timeout de 5 s. */
    private fun outgoing(
        url: String,
        headers: List<Pair<String, String>> = listOf("Content-Type" to "application/json"),
        body: String? = """{"id":"{{uuid}}","n":{{seq}}}""",
    ) = Outgoing(
        target = URI.create(url),
        method = "POST",
        headers = headers.map { (name, value) -> name to Template.parse(value) },
        body = body?.let { Template.parse(it) },
        signer = null,
        timeout = Duration.ofSeconds(5),
    )

    /** Backoff exponencial a partir de 1 s; o sono só anda o relógio e fica em [sleeps]. */
    private fun sender(
        outgoing: Outgoing,
        retries: Int = 3,
        maxDelay: Duration = Duration.ofSeconds(30),
    ): Sender {
        val policy = RetryPolicy(retries, RetryBackoff.EXPONENTIAL, initialDelay = Duration.ofSeconds(1), maxDelay = maxDelay)
        val sleep = { delay: Duration ->
            sleeps += delay
            clock.now = clock.now.plus(delay)
        }
        return Sender(httpClient(), outgoing, policy, clock, sleep, lines::add)
    }

    @Nested
    @DisplayName("Entrega")
    inner class Delivery {
        @Test
        @DisplayName("Dado um receptor que aceita, quando envia, então chegam método, headers e corpo resolvidos e sai uma linha")
        fun send_receptorAceita_deveEntregarNaPrimeira() {
            val receiver = FakeReceiver.capturing(status = 201).closing()

            val delivered =
                sender(
                    outgoing(
                        receiver.url + "/hooks?x=1",
                        headers =
                            listOf(
                                "Content-Type" to "application/json",
                                "X-Evento" to "e-{{seq}}",
                            ),
                    ),
                ).send(seq = 7)

            val arrival = receiver.arrivals.single()
            assertThat(delivered).isTrue()
            assertThat(arrival.method).isEqualTo("POST")
            assertThat(arrival.path).isEqualTo("/hooks?x=1")
            assertThat(arrival.header("X-Evento")).isEqualTo("e-7")
            assertThat(arrival.text()).matches("""\{"id":"[0-9a-f-]{36}","n":7}""")
            assertThat(lines).hasSize(2)
            assertThat(lines[0]).matches(line(7, "1/4", """201 \(\d+ ms\)""").pattern)
            assertThat(lines[1]).isEqualTo("#7 delivered after 1 attempt(s)")
            assertThat(sleeps).isEmpty()
        }

        @Test
        @DisplayName("Dado GET sem corpo e assinatura, quando envia, então chega sem corpo e assinado sobre zero bytes")
        fun send_getSemCorpo_deveAssinarZeroBytes() {
            val receiver = FakeReceiver.capturing().closing()

            val get =
                outgoing(
                    receiver.url,
                    headers = emptyList(),
                    body = null,
                ).copy(method = "GET", signer = Signer(Provider.Stripe, SECRET))

            sender(get).send(1)

            val arrival = receiver.arrivals.single()
            assertThat(arrival.method).isEqualTo("GET")
            assertThat(arrival.body).isEmpty()
            assertThat(arrival.stripeValid(SECRET)).isTrue()
        }

        @Test
        @DisplayName("Dado um header do usuário com o nome do header da assinatura, quando envia, então vale só o da assinatura")
        fun send_headerDoUsuarioComONomeDaAssinatura_deveSerSubstituido() {
            val receiver = FakeReceiver.capturing().closing()

            val github =
                outgoing(
                    receiver.url,
                    headers = listOf("x-hub-signature-256" to "falsa"),
                ).copy(signer = Signer(Provider.GitHub, SECRET))

            sender(github).send(1)

            assertThat(receiver.arrivals.single().headers["x-hub-signature-256"]).singleElement().asString().startsWith("sha256=")
        }

        @Test
        @DisplayName("Dado dois envios, quando envia, então uuid e seq mudam de um para o outro")
        fun send_doisEnvios_deveMudarUuidESeq() {
            val receiver = FakeReceiver.capturing().closing()
            val sender = sender(outgoing(receiver.url))

            sender.send(1)
            sender.send(2)

            val bodies = receiver.arrivals.map { it.text() }
            assertThat(bodies.map { it.substringAfter("\"n\":") }).containsExactly("1}", "2}")
            assertThat(bodies.map { it.substringBefore(",\"n\"") }.distinct()).hasSize(2)
        }
    }

    @Nested
    @DisplayName("Retentativa")
    inner class Retry {
        @Test
        @DisplayName("Dado 503 duas vezes e depois 200, quando envia, então 3 tentativas com as esperas do backoff e o mesmo corpo")
        fun send_falhaDuasVezes_deveRetentarComBackoffEMesmoCorpo() {
            val receiver = FakeReceiver.failing(times = 2).closing()

            val delivered = sender(outgoing(receiver.url), retries = 3).send(1)

            assertThat(delivered).isTrue()
            assertThat(receiver.arrivals).hasSize(3)
            assertThat(receiver.arrivals.map { it.text() }.distinct()).hasSize(1)
            assertThat(sleeps).containsExactly(Duration.ofSeconds(1), Duration.ofSeconds(2))
            assertThat(lines[0]).matches(line(1, "1/4", """503 \(\d+ ms\), retrying in 1000 ms""").pattern)
            assertThat(lines[1]).matches(line(1, "2/4", """503 \(\d+ ms\), retrying in 2000 ms""").pattern)
            assertThat(lines[2]).matches(line(1, "3/4", """200 \(\d+ ms\)""").pattern)
            assertThat(lines[3]).isEqualTo("#1 delivered after 3 attempt(s)")
        }

        @Test
        @DisplayName("Dado Stripe e retentativas, quando reenvia, então cada tentativa leva timestamp novo e assinatura válida")
        fun send_stripeComRetentativas_deveReassinarACadaTentativa() {
            val receiver = FakeReceiver.failing(times = 2).closing()

            sender(outgoing(receiver.url).copy(signer = Signer(Provider.Stripe, SECRET))).send(1)

            val signatures = receiver.arrivals.map { it.header("Stripe-Signature").orEmpty() }
            assertThat(signatures.map { it.substringBefore(',') }).containsExactly("t=1790431200", "t=1790431201", "t=1790431203")
            assertThat(receiver.arrivals).allMatch { it.stripeValid(SECRET) }
        }

        @Test
        @DisplayName("Dado 503 em todas, quando acabam as tentativas, então desiste sem esperar depois da última")
        fun send_falhaSempre_deveDesistirNoFim() {
            val receiver = FakeReceiver.failing(times = 10).closing()

            val delivered = sender(outgoing(receiver.url), retries = 2).send(4)

            assertThat(delivered).isFalse()
            assertThat(receiver.arrivals).hasSize(3)
            assertThat(sleeps).hasSize(2)
            assertThat(lines[2]).matches(line(4, "3/3", """503 \(\d+ ms\)""").pattern)
            assertThat(lines[3]).isEqualTo("#4 gave up after 3 attempt(s)")
        }

        @ParameterizedTest(name = "{0}")
        @ValueSource(ints = [301, 400, 404, 422])
        @DisplayName("Dado 3xx ou 4xx (fora o 429), quando envia, então não retenta e desiste")
        fun send_statusQueNaoRetenta_deveDesistirNaPrimeira(status: Int) {
            val receiver = FakeReceiver.capturing(status).closing()

            val delivered = sender(outgoing(receiver.url), retries = 3).send(1)

            assertThat(delivered).isFalse()
            assertThat(receiver.arrivals).hasSize(1)
            assertThat(sleeps).isEmpty()
            assertThat(lines).last().isEqualTo("#1 gave up after 1 attempt(s)")
        }

        @Test
        @DisplayName("Dado ninguém escutando, quando envia, então a linha diz error, retenta e desiste")
        fun send_conexaoRecusada_deveRetentarComErro() {
            val delivered = sender(outgoing("http://127.0.0.1:${FakeLocalApp.freePort()}"), retries = 1).send(1)

            assertThat(delivered).isFalse()
            assertThat(lines).containsExactly(
                lines[0],
                lines[1],
                "#1 gave up after 2 attempt(s)",
            )
            assertThat(lines[0]).matches(line(1, "1/2", "error: connection refused, retrying in 1000 ms").pattern)
            assertThat(lines[1]).matches(line(1, "2/2", "error: connection refused").pattern)
        }

        @Test
        @DisplayName("Dado um receptor que demora mais que o --timeout, quando envia, então a tentativa é timeout e retenta")
        fun send_receptorLento_deveDarTimeoutERetentar() {
            val receiver = FakeReceiver(listOf(Reply(200, delay = Duration.ofSeconds(5)), Reply(200))).closing()

            val delivered = sender(outgoing(receiver.url).copy(timeout = Duration.ofMillis(200)), retries = 1).send(1)

            assertThat(delivered).isTrue()
            assertThat(lines[0]).matches(line(1, "1/2", "error: timed out, retrying in 1000 ms").pattern)
        }
    }

    @Nested
    @DisplayName("Retry-After")
    inner class RetryAfterHeader {
        @Test
        @DisplayName("Dado 429 com Retry-After: 3, quando retenta, então espera 3 s e a linha diz (Retry-After)")
        fun send_retryAfterEmSegundos_deveEsperarOHeader() {
            val receiver = FakeReceiver.retryAfter("3").closing()

            sender(outgoing(receiver.url)).send(1)

            assertThat(sleeps).containsExactly(Duration.ofSeconds(3))
            assertThat(lines[0]).matches(line(1, "1/4", """429 \(\d+ ms\), retrying in 3000 ms \(Retry-After\)""").pattern)
        }

        @Test
        @DisplayName("Dado 503 com Retry-After acima do --max-delay, quando retenta, então espera o teto")
        fun send_retryAfterAcimaDoTeto_deveEsperarOTeto() {
            val receiver = FakeReceiver.retryAfter("120", status = 503).closing()

            sender(outgoing(receiver.url), maxDelay = Duration.ofMillis(1500)).send(1)

            assertThat(sleeps).containsExactly(Duration.ofMillis(1500))
            assertThat(lines[0]).endsWith(", retrying in 1500 ms (Retry-After)")
        }

        @Test
        @DisplayName("Dado Retry-After numa resposta que não retenta (400), quando envia, então ignora e desiste")
        fun send_retryAfterEm400_naoDeveRetentar() {
            val receiver = FakeReceiver.retryAfter("1", status = 400).closing()

            sender(outgoing(receiver.url)).send(1)

            assertThat(receiver.arrivals).hasSize(1)
            assertThat(sleeps).isEmpty()
        }
    }
}
