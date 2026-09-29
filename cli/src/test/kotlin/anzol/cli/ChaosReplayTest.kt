package anzol.cli

import anzol.cli.support.CliProcess
import anzol.cli.support.FakeAnzol
import anzol.cli.support.RawReceiver
import anzol.cli.support.Reply
import anzol.cli.support.message
import anzol.cli.support.uuid
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.util.UUID

private const val CLOCK = """\d{2}:\d{2}:\d{2}"""
private val CLOCK_AND_MILLIS = Regex("""^\d{2}:\d{2}:\d{2} |\(\d+ ms\)""")

@DisplayName("anzol replay com caos")
class ChaosReplayTest {
    private val site = FakeAnzol()
    private val closing = mutableListOf<AutoCloseable>()

    @AfterEach
    fun close() {
        closing.reversed().forEach(AutoCloseable::close)
        site.close()
    }

    private fun receiver(vararg replies: Reply): RawReceiver =
        RawReceiver(replies.toList().ifEmpty { listOf(Reply(200)) }).also(closing::add)

    /** Grava [count] mensagens `/1`, `/2`… e devolve os ids, na ordem. */
    private fun stored(
        token: String,
        count: Int,
    ): List<String> =
        (1..count).map { n ->
            message(
                token,
                target = "/$n",
                headers = mapOf("x-request-id" to listOf("evt-$n")),
                content = "corpo $n",
            ).also(site::store).uuid()
        }

    private fun replay(
        token: String,
        ids: List<String>,
        app: RawReceiver,
        vararg chaos: String,
    ): CliProcess = CliProcess("replay", token, *ids.toTypedArray(), "--to", app.url, "--server", site.base, *chaos).also(closing::add)

    @Test
    @DisplayName("Dado vários ids, quando roda replay sem caos, então entrega cada um na ordem dada, uma linha por id, e sai com 0")
    fun replay_variosIds_deveEntregarNaOrdemDada() {
        val token = site.createToken()
        val ids = stored(token, 3)
        val app = receiver()

        val cli = replay(token, ids.reversed(), app)

        assertThat(cli.awaitExit()).isZero()
        assertThat(app.arrivals.map { it.target }).containsExactly("/3", "/2", "/1")
        assertThat(cli.stdout).hasSize(3)
    }

    @Test
    @DisplayName("Dado --chaos-duplicate 100, quando roda replay de 2 ids, então cada um chega duas vezes, igual, e sai com 0")
    fun replay_duplicataTotal_deveEntregarCadaUmDuasVezes() {
        val token = site.createToken()
        val app = receiver()

        val cli = replay(token, stored(token, 2), app, "--chaos-duplicate", "100")

        assertThat(cli.awaitExit()).isZero()
        assertThat(app.arrivals.map { it.target }).containsExactly("/1", "/1", "/2", "/2")
        assertThat(app.arrivals.map { it.headers["x-request-id"] }).containsExactly(
            listOf("evt-1"),
            listOf("evt-1"),
            listOf("evt-2"),
            listOf("evt-2"),
        )
        assertThat(cli.stdout.filter { it.endsWith("[chaos: duplicate]") }).hasSize(2)
    }

    @Test
    @DisplayName("Dado --chaos-reorder 3 com 3 ids, quando roda replay, então os entrega noutra ordem e sai com 0")
    fun replay_reorder_deveEntregarNoutraOrdem() {
        val token = site.createToken()
        val app = receiver()

        val cli = replay(token, stored(token, 3), app, "--chaos-reorder", "3", "--chaos-seed", "1")

        assertThat(cli.awaitExit()).isZero()
        assertThat(app.arrivals.map { it.target }).containsExactlyInAnyOrder("/1", "/2", "/3").isNotEqualTo(listOf("/1", "/2", "/3"))
        assertThat(cli.stdout.filter { it.contains("-> held ") }).hasSize(3)
    }

    @Test
    @DisplayName("Dado --chaos-reorder 3 com 2 ids, quando roda replay, então solta a leva incompleta no fim, trocada")
    fun replay_reorderIncompleto_deveSoltarALevaNoFim() {
        val token = site.createToken()
        val app = receiver()

        val cli = replay(token, stored(token, 2), app, "--chaos-reorder", "3")

        assertThat(cli.awaitExit()).isZero()
        assertThat(app.arrivals.map { it.target }).containsExactly("/2", "/1")
    }

    @Test
    @DisplayName("Dado --chaos-drop 100, quando roda replay, então nada chega, a linha diz dropped e sai com 0")
    fun replay_descarteTotal_naoDeveEntregarESairComZero() {
        val token = site.createToken()
        val app = receiver()

        val cli = replay(token, stored(token, 1), app, "--chaos-drop", "100")

        assertThat(cli.awaitExit()).isZero()
        assertThat(app.arrivals).isEmpty()
        assertThat(cli.stdout).anySatisfy { assertThat(it).matches("""$CLOCK POST /1 -> dropped \[chaos: drop]""") }
    }

    @Test
    @DisplayName("Dado --chaos-abort 100, quando roda replay, então o app não responde e sai com 1")
    fun replay_corte_deveSairComUm() {
        val token = site.createToken()
        val app = receiver()

        val cli = replay(token, stored(token, 1), app, "--chaos-abort", "100")

        assertThat(cli.awaitExit()).isEqualTo(1)
        assertThat(cli.stdout).anySatisfy { assertThat(it).matches("""$CLOCK POST /1 -> cut after 3 of 7 bytes \[chaos: abort]""") }
        assertThat(app.arrivals.single().text()).isEqualTo("cor")
    }

    @Test
    @DisplayName("Dado --retries 1 e um app que responde 503 e depois 200, quando roda replay, então retenta e sai com 0")
    fun replay_retries_deveRetentarESairComZero() {
        val token = site.createToken()
        val app = receiver(Reply(503), Reply(200))

        val cli = replay(token, stored(token, 1), app, "--retries", "1")

        assertThat(cli.awaitExit()).isZero()
        assertThat(app.arrivals).hasSize(2)
        assertThat(cli.stdout.last()).matches("""$CLOCK POST /1 attempt 2/2 -> 200 \(\d+ ms\)""")
    }

    @Test
    @DisplayName("Dado a mesma semente, quando roda replay duas vezes, então as linhas se repetem, tirando hora e ms")
    fun replay_mesmaSemente_deveRepetirAsFalhas() {
        val token = site.createToken()
        val ids = stored(token, 8)
        val chaos = arrayOf("--chaos-drop", "30", "--chaos-duplicate", "40", "--chaos-reorder", "3", "--chaos-seed", "3")

        val runs =
            List(2) { _ ->
                val cli = replay(token, ids, receiver(), *chaos)
                assertThat(cli.awaitExit()).isZero()
                cli.stdout.map { line -> line.replace(CLOCK_AND_MILLIS, "") }
            }

        assertThat(runs[0]).isEqualTo(runs[1])
        assertThat(runs[0].joinToString("\n")).contains("[chaos: drop]", "duplicate", "reordered")
    }

    @Test
    @DisplayName("Dado um dos ids inexistente, quando roda replay, então escreve Request not found, nada chega e sai com 1")
    fun replay_umIdInexistente_naoDeveEntregarNada() {
        val token = site.createToken()
        val app = receiver()

        val cli = replay(token, stored(token, 1) + UUID.randomUUID().toString(), app)

        assertThat(cli.awaitExit()).isEqualTo(1)
        assertThat(cli.stderr).containsExactly("Request not found")
        assertThat(app.arrivals).isEmpty()
    }

    @Test
    @DisplayName("Dado uma opção de caos inválida, quando roda replay, então sai com 2 e nada chega")
    fun replay_opcaoInvalida_deveSairComDois() {
        val token = site.createToken()
        val app = receiver()

        val cli = replay(token, stored(token, 1), app, "--chaos-delay", "9..3")

        assertThat(cli.awaitExit()).isEqualTo(2)
        assertThat(cli.stderr).anySatisfy { assertThat(it).contains("invalid value for --chaos-delay") }
        assertThat(app.arrivals).isEmpty()
    }

    @Test
    @DisplayName("Dado --help, quando pede, então lista as opções de caos e --retries")
    fun replay_help_deveListarAsOpcoesDeCaos() {
        val cli = CliProcess("replay", "--help").also(closing::add)

        assertThat(cli.awaitExit()).isZero()
        val help = cli.stdout.joinToString("\n")
        listOf("--chaos-drop", "--chaos-reorder", "--chaos-abort", "--chaos-slow", "--retries", "--chaos-seed").forEach {
            assertThat(help).contains(it)
        }
    }
}
