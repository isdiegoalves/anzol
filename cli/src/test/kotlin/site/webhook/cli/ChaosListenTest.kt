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
import site.webhook.cli.support.FakeAnzol
import site.webhook.cli.support.RawArrival
import site.webhook.cli.support.RawReceiver
import site.webhook.cli.support.Reply
import site.webhook.cli.support.message
import java.time.Duration

private const val CLOCK = """\d{2}:\d{2}:\d{2}"""
private val WAIT: Duration = Duration.ofSeconds(15)

@DisplayName("anzol listen com caos")
class ChaosListenTest {
    private val site = FakeAnzol()
    private val closing = mutableListOf<AutoCloseable>()

    @AfterEach
    fun close() {
        closing.reversed().forEach(AutoCloseable::close)
        site.close()
    }

    private fun receiver(vararg replies: Reply): RawReceiver =
        RawReceiver(replies.toList().ifEmpty { listOf(Reply(200)) }).also(closing::add)

    private fun listen(
        token: String,
        app: RawReceiver,
        vararg chaos: String,
    ): CliProcess {
        val process = CliProcess("listen", "--server", site.base, "--forward", app.url, "--token", token, *chaos).also(closing::add)
        process.awaitLine(Regex(Regex.escape("Listening on ${site.base}/$token (forwarding to ${app.url})")))
        return process
    }

    private fun publish(
        token: String,
        target: String,
        content: String = "corpo de $target",
    ) = site.publish(
        message(
            token,
            target = target,
            headers = mapOf("content-type" to listOf("text/plain"), "x-request-id" to listOf("evt$target")),
            content = content,
        ),
    )

    private fun fates(
        chaos: Chaos,
        count: Int,
    ): List<Fate> {
        val dice = ChaosDice(chaos.seed)
        return List(count) { chaos.fate(dice.nextMessage()) }
    }

    private fun awaitArrivals(
        app: RawReceiver,
        count: Int,
    ): List<RawArrival> {
        await().atMost(WAIT).until { app.arrivals.size >= count }
        return app.arrivals.toList()
    }

    private fun millisBetween(
        from: Long,
        to: Long,
    ): Long = Duration.ofNanos(to - from).toMillis()

    private fun number(
        pattern: Regex,
        line: String,
    ): Long = requireNotNull(pattern.find(line)).groupValues[1].toLong()

    @Nested
    @DisplayName("Duplicata e descarte")
    inner class DuplicateAndDrop {
        @Test
        @DisplayName(
            "Dado --chaos-duplicate 50 com semente, quando chegam 8, então as sorteadas chegam duas vezes, logo em seguida e iguais",
        )
        fun listen_duplicataComSemente_deveEntregarDuasVezesAsSorteadas() {
            val token = site.createToken()
            val app = receiver()
            val cli = listen(token, app, "--chaos-duplicate", "50", "--chaos-seed", "7")
            val duplicated = fates(Chaos(duplicate = Percent(50.0), seed = 7), 8).map { it.duplicated }
            assertThat(duplicated).contains(true, false)

            (1..8).forEach { publish(token, "/$it") }

            val arrivals = awaitArrivals(app, 8 + duplicated.count { it })
            val expectedOrder = (1..8).flatMap { n -> List(if (duplicated[n - 1]) 2 else 1) { "/$n" } }
            assertThat(arrivals.map { it.target }).containsExactlyElementsOf(expectedOrder)
            arrivals.groupBy { it.target }.values.filter { it.size == 2 }.forEach { (first, second) ->
                assertThat(second.headers).isEqualTo(first.headers)
                assertThat(second.text()).isEqualTo(first.text())
            }
            (1..8).filter { duplicated[it - 1] }.forEach { n ->
                cli.awaitLine(Regex("""$CLOCK POST /$n -> 200 \(\d+ ms\) \[chaos: duplicate]"""))
            }
            assertThat(cli.stdout).contains("Chaos: duplicate 50%; seed 7")
        }

        @Test
        @DisplayName("Dado --chaos-drop 50 com semente, quando chegam 6, então as sorteadas não chegam e a linha diz dropped")
        fun listen_descarteComSemente_naoDeveEntregarAsSorteadas() {
            val token = site.createToken()
            val app = receiver()
            val cli = listen(token, app, "--chaos-drop", "50", "--chaos-seed", "11")
            val dropped = fates(Chaos(drop = Percent(50.0), seed = 11), 6).map { it.dropped }
            assertThat(dropped).contains(true, false)

            (1..6).forEach { publish(token, "/$it") }

            (1..6).forEach { n ->
                val result = if (dropped[n - 1]) """dropped \[chaos: drop]""" else """200 \(\d+ ms\)"""
                cli.awaitLine(Regex("""$CLOCK POST /$n -> $result"""))
            }
            assertThat(app.arrivals.map { it.target }).containsExactlyElementsOf((1..6).filterNot { dropped[it - 1] }.map { "/$it" })
        }

        @Test
        @DisplayName("Dado --chaos-drop 100, quando chega uma mensagem, então nada é entregue")
        fun listen_descarteTotal_naoDeveEntregarNada() {
            val token = site.createToken()
            val app = receiver()
            val cli = listen(token, app, "--chaos-drop", "100%")

            publish(token, "/some")

            cli.awaitLine(Regex("""$CLOCK POST /some -> dropped \[chaos: drop]"""))
            assertThat(app.arrivals).isEmpty()
        }
    }

    @Test
    @DisplayName("Dado --chaos-delay 300..600, quando chega uma mensagem, então ela sai depois do atraso sorteado, que a linha mostra")
    fun listen_atraso_deveEsperarOAtrasoSorteado() {
        val token = site.createToken()
        val app = receiver()
        val cli = listen(token, app, "--chaos-delay", "300..0.6s")

        val published = System.nanoTime()
        publish(token, "/devagar")

        val line = cli.awaitLine(Regex("""$CLOCK POST /devagar -> 200 \(\d+ ms\) \[chaos: delay (\d+) ms]"""))
        val delay = number(Regex("""delay (\d+) ms"""), line)
        assertThat(delay).isBetween(300, 600)
        assertThat(millisBetween(published, awaitArrivals(app, 1).single().started)).isGreaterThanOrEqualTo(delay)
    }

    @Nested
    @DisplayName("Embaralhamento")
    inner class Reorder {
        @Test
        @DisplayName(
            "Dado --chaos-reorder 3, quando chegam 3, então segura as 3 e as entrega noutra ordem, com a posição de chegada na linha",
        )
        fun listen_reorder_deveSegurarEEntregarNoutraOrdem() {
            val token = site.createToken()
            val app = receiver()
            val cli = listen(token, app, "--chaos-reorder", "3", "--chaos-seed", "5")

            (1..3).forEach { n ->
                publish(token, "/$n")
                cli.awaitLine(Regex("""$CLOCK POST /$n -> held $n of 3 \[chaos: reorder]"""))
            }

            val order = awaitArrivals(app, 3).map { it.target }
            assertThat(order).containsExactlyInAnyOrder("/1", "/2", "/3").isNotEqualTo(listOf("/1", "/2", "/3"))
            order.forEach { target ->
                val arrived = target.removePrefix("/")
                cli.awaitLine(Regex("""$CLOCK POST $target -> 200 \(\d+ ms\) \[chaos: reordered \(arrived $arrived of 3\)]"""))
            }
        }

        @Test
        @DisplayName("Dado --chaos-reorder 3 e só 2 mensagens, quando passam 2 s sem outra, então entrega as 2 trocadas")
        fun listen_reorderIncompleto_deveSoltarALevaDepoisDaEspera() {
            val token = site.createToken()
            val app = receiver()
            val cli = listen(token, app, "--chaos-reorder", "3")

            publish(token, "/1")
            publish(token, "/2")
            cli.awaitLine(Regex("""$CLOCK POST /2 -> held 2 of 3 \[chaos: reorder]"""))
            val held = System.nanoTime()

            val arrivals = awaitArrivals(app, 2)
            assertThat(arrivals.map { it.target }).containsExactly("/2", "/1")
            assertThat(millisBetween(held, arrivals.first().started)).isGreaterThanOrEqualTo(1500)
        }
    }

    @Test
    @DisplayName("Dado --chaos-abort 100, quando chega uma mensagem, então o app recebe cabeçalhos e metade do corpo e a conexão fecha")
    fun listen_corte_deveMandarMetadeDoCorpoEFechar() {
        val token = site.createToken()
        val app = receiver()
        val cli = listen(token, app, "--chaos-abort", "100")

        publish(token, "/cortado", content = "0123456789")

        cli.awaitLine(Regex("""$CLOCK POST /cortado -> cut after 5 of 10 bytes \[chaos: abort]"""))
        val arrival = awaitArrivals(app, 1).single()
        assertThat(arrival.method).isEqualTo("POST")
        assertThat(arrival.declared).isEqualTo(10)
        assertThat(arrival.text()).isEqualTo("01234")
        assertThat(arrival.complete).isFalse()
        assertThat(arrival.headers["x-request-id"]).containsExactly("evt/cortado")
        assertThat(arrival.headers["host"]).containsExactly(app.url.removePrefix("http://"))
    }

    @Test
    @DisplayName("Dado --chaos-slow 20, quando chega um corpo de 20 bytes, então ele pinga aos pedaços por cerca de 1 s e chega inteiro")
    fun listen_gotejamento_deveMandarOCorpoAosPedacos() {
        val token = site.createToken()
        val app = receiver()
        val cli = listen(token, app, "--chaos-slow", "20")

        publish(token, "/pinga", content = "abcdefghijklmnopqrst")

        cli.awaitLine(Regex("""$CLOCK POST /pinga -> 200 \((\d{3,}) ms\) \[chaos: slow 20 B/s]"""))
        val arrival = awaitArrivals(app, 1).single()
        assertThat(arrival.text()).isEqualTo("abcdefghijklmnopqrst")
        assertThat(arrival.reads).hasSizeGreaterThanOrEqualTo(5)
        assertThat(millisBetween(arrival.started, arrival.reads.last())).isGreaterThanOrEqualTo(800)
    }

    @Test
    @DisplayName("Dado --chaos-timeout 300ms e um app que demora 5 s, quando entrega, então desiste em 300 ms e a linha diz")
    fun listen_timeout_deveDesistirDeEsperarOApp() {
        val token = site.createToken()
        val app = receiver(Reply(200, delay = Duration.ofSeconds(5)))
        val cli = listen(token, app, "--chaos-timeout", "300ms")

        val published = System.nanoTime()
        publish(token, "/lento")

        cli.awaitLine(Regex("""$CLOCK POST /lento -> error: timed out after 300 ms \[chaos: timeout]"""))
        assertThat(millisBetween(published, System.nanoTime())).isLessThan(3000)
        assertThat(awaitArrivals(app, 1).single().complete).isTrue()
    }

    @Nested
    @DisplayName("Retentativas")
    inner class Retries {
        @Test
        @DisplayName("Dado --retries 2 e um app que responde 503, 503, 200, quando entrega, então tenta 3 vezes, mesmos bytes, com jitter")
        fun listen_retries_deveRetentarComBackoffEOsMesmosBytes() {
            val token = site.createToken()
            val app = receiver(Reply(503), Reply(503), Reply(200))
            val cli = listen(token, app, "--retries", "2")

            publish(token, "/pedido")

            val first = cli.awaitLine(Regex("""$CLOCK POST /pedido attempt 1/3 -> 503 \(\d+ ms\), retrying in (\d+) ms"""))
            val second = cli.awaitLine(Regex("""$CLOCK POST /pedido attempt 2/3 -> 503 \(\d+ ms\), retrying in (\d+) ms"""))
            cli.awaitLine(Regex("""$CLOCK POST /pedido attempt 3/3 -> 200 \(\d+ ms\)"""))
            val waits = listOf(first, second).map { number(Regex("""retrying in (\d+) ms"""), it) }
            assertThat(waits[0]).isBetween(500, 1000)
            assertThat(waits[1]).isBetween(1000, 2000)
            val arrivals = awaitArrivals(app, 3)
            assertThat(arrivals.map { it.headers }.distinct()).hasSize(1)
            assertThat(arrivals.map { it.text() }.distinct()).containsExactly("corpo de /pedido")
            assertThat(millisBetween(arrivals[0].started, arrivals[1].started)).isGreaterThanOrEqualTo(waits[0])
            assertThat(millisBetween(arrivals[1].started, arrivals[2].started)).isGreaterThanOrEqualTo(waits[1])
        }

        @Test
        @DisplayName("Dado um 429 com Retry-After: 1, quando retenta, então espera 1000 ms, como o app pediu")
        fun listen_retryAfter_deveEsperarOQueOAppPediu() {
            val token = site.createToken()
            val app = receiver(Reply(429, mapOf("Retry-After" to "1")), Reply(200))
            val cli = listen(token, app, "--retries", "3")

            publish(token, "/limite")

            cli.awaitLine(Regex("""$CLOCK POST /limite attempt 1/4 -> 429 \(\d+ ms\), retrying in 1000 ms \(Retry-After\)"""))
            cli.awaitLine(Regex("""$CLOCK POST /limite attempt 2/4 -> 200 \(\d+ ms\)"""))
            val arrivals = awaitArrivals(app, 2)
            assertThat(millisBetween(arrivals[0].started, arrivals[1].started)).isGreaterThanOrEqualTo(1000)
        }

        @Test
        @DisplayName("Dado --chaos-timeout e --retries 1, quando a 1ª tentativa estoura o prazo, então retenta e entrega")
        fun listen_timeoutComRetries_deveRetentar() {
            val token = site.createToken()
            val app = receiver(Reply(200, delay = Duration.ofSeconds(5)), Reply(201))
            val cli = listen(token, app, "--chaos-timeout", "200", "--retries", "1")

            publish(token, "/lento")

            cli.awaitLine(
                Regex("""$CLOCK POST /lento attempt 1/2 -> error: timed out after 200 ms, retrying in \d+ ms \[chaos: timeout]"""),
            )
            cli.awaitLine(Regex("""$CLOCK POST /lento attempt 2/2 -> 201 \(\d+ ms\)"""))
        }

        @Test
        @DisplayName("Dado --chaos-abort 100 e --retries 1, quando entrega, então corta as duas tentativas e desiste")
        fun listen_corteComRetries_deveCortarTodasAsTentativas() {
            val token = site.createToken()
            val app = receiver()
            val cli = listen(token, app, "--chaos-abort", "100", "--retries", "1")

            publish(token, "/cortado", content = "abcd")

            cli.awaitLine(Regex("""$CLOCK POST /cortado attempt 1/2 -> cut after 2 of 4 bytes, retrying in \d+ ms \[chaos: abort]"""))
            cli.awaitLine(Regex("""$CLOCK POST /cortado attempt 2/2 -> cut after 2 of 4 bytes \[chaos: abort]"""))
            assertThat(awaitArrivals(app, 2).map { it.text() }).containsExactly("ab", "ab")
        }
    }

    @Nested
    @DisplayName("Opções inválidas")
    inner class Invalid {
        @ParameterizedTest(name = "{0} {1}")
        @CsvSource(
            "--chaos-drop,150",
            "--chaos-duplicate,x",
            "--chaos-abort,101",
            "--chaos-delay,5..1",
            "--chaos-delay,1.5",
            "--chaos-reorder,1",
            "--chaos-reorder,101",
            "--chaos-slow,0",
            "--chaos-timeout,0",
            "--chaos-timeout,2m",
            "--retries,11",
            "--chaos-seed,x",
        )
        @DisplayName("Dado uma opção de caos com valor inválido, quando sobe, então sai com 2 e o stderr cita a opção")
        fun listen_opcaoInvalida_deveSairComDois(
            option: String,
            value: String,
        ) {
            val token = site.createToken()
            val app = receiver()
            val cli = CliProcess("listen", "--server", site.base, "--forward", app.url, "--token", token, option, value).also(closing::add)

            assertThat(cli.awaitExit()).isEqualTo(2)
            assertThat(cli.stderr).anySatisfy { assertThat(it).contains("invalid value for $option") }
            assertThat(cli.stdout).isEmpty()
        }

        @Test
        @DisplayName("Dado --chaos-drop sem valor, quando sobe, então sai com 2")
        fun listen_opcaoSemValor_deveSairComDois() {
            val cli = CliProcess("listen", "--server", site.base, "--forward", "http://127.0.0.1:9", "--chaos-drop").also(closing::add)

            assertThat(cli.awaitExit()).isEqualTo(2)
            assertThat(cli.stderr).anySatisfy { assertThat(it).contains("--chaos-drop") }
        }

        @Test
        @DisplayName("Dado --chaos-abort com --forward https://, quando sobe, então sai com 2: o corte só vale em http://")
        fun listen_corteComHttps_deveSairComDois() {
            val token = site.createToken()
            val cli =
                CliProcess("listen", "--server", site.base, "--forward", "https://localhost:3000", "--token", token, "--chaos-abort", "10")
                    .also(closing::add)

            assertThat(cli.awaitExit()).isEqualTo(2)
            assertThat(cli.stderr).containsExactly("--chaos-abort works only with an http:// target")
            assertThat(site.subscriberCount()).isZero()
        }
    }

    @Test
    @DisplayName("Dado --help, quando pede, então lista as opções de caos e --retries")
    fun listen_help_deveListarAsOpcoesDeCaos() {
        val cli = CliProcess("listen", "--help").also(closing::add)

        assertThat(cli.awaitExit()).isZero()
        val help = cli.stdout.joinToString("\n")
        listOf(
            "--chaos-drop",
            "--chaos-duplicate",
            "--chaos-delay",
            "--chaos-reorder",
            "--chaos-abort",
            "--chaos-slow",
            "--chaos-timeout",
            "--retries",
            "--chaos-seed",
        ).forEach { assertThat(help).contains(it) }
    }
}
