package anzol.cli

import anzol.cli.support.CliProcess
import anzol.cli.support.FakeAnzol
import anzol.cli.support.FakeLocalApp
import anzol.cli.support.message
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.util.UUID
import kotlin.io.path.readText
import kotlin.io.path.writeText

private const val SUMMARY = """matched 1/1 in \d+ ms"""

/** O servidor falso não avalia o `match`: só grava o corpo do `requests/wait` e responde o que o teste mandar. */
@DisplayName("anzol test")
class TestCycleTest {
    private val site = FakeAnzol()
    private val cli = mutableListOf<CliProcess>()

    @AfterEach
    fun close() {
        cli.forEach(CliProcess::close)
        site.close()
    }

    private fun run(vararg args: String): CliProcess = CliProcess("test", "--server", site.base, *args).also(cli::add)

    private fun json(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

    /** 0 é a conferência do match antes do gatilho; o `--timeout`, a espera. */
    private fun timeout(wait: JsonObject): Long = wait.getValue("timeout").jsonPrimitive.long

    private fun reply(
        matched: Boolean,
        vararg messages: JsonObject,
        nearMiss: String = "null",
    ) {
        val requests = messages.joinToString(",", prefix = "[", postfix = "]")
        site.waitReply = 200 to """{"matched":$matched,"count":${messages.size},"requests":$requests,"near_miss":$nearMiss}"""
    }

    private fun createdToken(cli: CliProcess): String =
        Regex("""url: ${Regex.escape(site.base)}/(\S+) \(created; deleted at the end\)""")
            .let { line -> cli.stderr.firstNotNullOfOrNull { line.matchEntire(it)?.groupValues?.get(1) } }
            ?: error("sem a linha url:; stderr=${cli.stderr}")

    @Nested
    @DisplayName("Sem --token")
    inner class Created {
        @Test
        @DisplayName(
            "Dado um gatilho, quando roda, então cria a URL, confere o match antes do gatilho, espera depois dele com after 0 " +
                "(a URL é nova) e apaga a URL",
        )
        fun test_semToken_deveFazerOCicloInteiro(
            @TempDir dir: Path,
        ) {
            val out = dir.resolve("gatilho.txt")
            val listed = mutableListOf<String>()
            val waitAfterTrigger = mutableListOf<Boolean>()
            site.onList = { listed += it }
            site.onWait = { waitAfterTrigger += Files.exists(out) }
            val pago = message("x", target = "/pedidos", content = """{"status":"pago"}""")
            reply(true, pago)

            val cli =
                run(
                    "--method",
                    "POST",
                    "--path",
                    "/pedidos",
                    "--json-path",
                    "$.status=pago",
                    "--timeout",
                    "5000",
                    "--",
                    "sh",
                    "-c",
                    "printf '%s|%s|%s' \"$1\" \"\$ANZOL_URL\" \"\$ANZOL_TOKEN\" > \"$2\"",
                    "sh",
                    "{url}",
                    out.toString(),
                )

            assertThat(cli.awaitExit()).isZero()
            val token = createdToken(cli)
            assertThat(out.readText()).isEqualTo("${site.base}/$token|${site.base}/$token|$token")
            assertThat(listed).describedAs("a URL nova não precisa ler o cursor").isEmpty()
            assertThat(waitAfterTrigger).describedAs("a conferência antes do gatilho, a espera depois").containsExactly(false, true)
            val match = """{"method":["POST"],"path":{"prefix":"/pedidos"},"body":[{"jsonPath":{"path":"$.status","equals":"pago"}}]}"""
            assertThat(site.waits).containsExactly(
                json("""{"match":$match,"after":0,"count":1,"timeout":0}"""),
                json("""{"match":$match,"after":0,"count":1,"timeout":5000}"""),
            )
            assertThat(cli.stdout).hasSize(1)
            assertThat(Json.parseToJsonElement(cli.stdout.single())).isEqualTo(Json.parseToJsonElement("[$pago]"))
            assertThat(site.deleted).containsExactly(token)
            assertThat(cli.stderr).contains("cursor: 0", "url: deleted")
            assertThat(cli.stderr).anyMatch { Regex("""trigger: sh exited with 0 after \d+ ms""").matches(it) }
            assertThat(cli.stderr).anyMatch { Regex(SUMMARY).matches(it) }
        }

        @Test
        @DisplayName("Dado o prazo esgotado, quando roda, então sai com 1, imprime o que casou e o mais perto, e apaga a URL")
        fun test_prazoEsgotado_deveSairComUmEApagar() {
            val near = """{"uuid":"11111111-1111-4111-8111-111111111111","seq":9,"failed":["method: expected POST, got GET"]}"""
            reply(false, nearMiss = near)

            val cli = run("--method", "POST", "--timeout", "300", "--", "true")

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stdout).containsExactly("[]")
            assertThat(cli.stderr).anyMatch { Regex("""timed out after \d+ ms: 0/1 matched""").matches(it) }
            assertThat(cli.stderr).contains("closest: #9 11111111-1111-4111-8111-111111111111", "  - method: expected POST, got GET")
            assertThat(site.deleted).containsExactly(createdToken(cli))
        }

        @Test
        @DisplayName("Dado um gatilho que sai com erro, quando roda, então não espera, sai com 3 e apaga a URL")
        fun test_gatilhoFalha_deveSairComTres() {
            val cli = run("--", "sh", "-c", "exit 7")

            assertThat(cli.awaitExit()).isEqualTo(3)
            assertThat(site.waits.map(::timeout)).describedAs("só a conferência do match, sem espera").containsExactly(0L)
            assertThat(cli.stdout).isEmpty()
            assertThat(cli.stderr).anyMatch { Regex("""trigger: sh exited with 7 after \d+ ms""").matches(it) }
            assertThat(site.deleted).containsExactly(createdToken(cli))
        }

        @Test
        @DisplayName("Dado um gatilho que não existe, quando roda, então sai com 3 e apaga a URL")
        fun test_gatilhoInexistente_deveSairComTres() {
            val cli = run("--", "/nao/existe/dispara.sh", "{url}")

            assertThat(cli.awaitExit()).isEqualTo(3)
            assertThat(site.waits.map(::timeout)).describedAs("só a conferência do match, sem espera").containsExactly(0L)
            assertThat(cli.stderr).anyMatch { it.startsWith("trigger: could not start /nao/existe/dispara.sh: ") }
            assertThat(site.deleted).containsExactly(createdToken(cli))
        }

        @Test
        @DisplayName("Dado um gatilho que escreve no stdout, quando roda, então o texto vai para o stderr e o stdout fica só com o JSON")
        fun test_saidaDoGatilho_deveIrParaOStderr() {
            reply(true, message("x"))

            val cli = run("--", "sh", "-c", "echo barulho-do-gatilho")

            assertThat(cli.awaitExit()).isZero()
            assertThat(cli.stdout).hasSize(1)
            assertThat(Json.parseToJsonElement(cli.stdout.single()).toString()).startsWith("[")
            assertThat(cli.stderr).contains("barulho-do-gatilho")
        }

        @Test
        @DisplayName("Dado um --rules válido, quando roda, então sobe as regras antes do gatilho")
        fun test_regras_deveSubirAntesDoGatilho(
            @TempDir dir: Path,
        ) {
            val file = dir.resolve("regras.json").also { it.writeText("""[{"name":"Pedido pago","response":{"status":202}}]""") }
            val out = dir.resolve("gatilho.txt")
            val triggerRanBeforePush = mutableListOf<Boolean>()
            site.onRulesPut = { triggerRanBeforePush += Files.exists(out) }
            reply(true, message("x"))

            val cli = run("--rules", file.toString(), "--", "touch", out.toString())

            assertThat(cli.awaitExit()).isZero()
            assertThat(triggerRanBeforePush).containsExactly(false)
            assertThat(out).exists()
            assertThat(cli.stderr).contains("rules: pushed 1 rule(s) from $file")
        }

        @Test
        @DisplayName("Dado um --rules que o servidor recusa, quando roda, então mostra o 422, não roda o gatilho, sai com 2 e apaga a URL")
        fun test_regrasInvalidas_deveSairComDois(
            @TempDir dir: Path,
        ) {
            val file = dir.resolve("regras.json").also { it.writeText("""[{"response":{"status":202}}]""") }
            val out = dir.resolve("gatilho.txt")

            val cli = run("--rules", file.toString(), "--", "touch", out.toString())

            assertThat(cli.awaitExit()).isEqualTo(2)
            assertThat(cli.stderr).contains("0.name: The name field is required.")
            assertThat(out).doesNotExist()
            assertThat(site.waits).isEmpty()
            assertThat(site.deleted).containsExactly(createdToken(cli))
        }

        @Test
        @DisplayName("Dado o match recusado pelo servidor (422), quando roda, então não roda o gatilho, sai com 2 e apaga a URL")
        fun test_matchRecusado_deveSairComDoisSemRodarOGatilho(
            @TempDir dir: Path,
        ) {
            site.waitReply = 422 to """{"match.path.regex":["The regex is invalid."]}"""
            val out = dir.resolve("gatilho.txt")

            val cli = run("--", "touch", out.toString())

            assertThat(cli.awaitExit()).isEqualTo(2)
            assertThat(cli.stderr).contains("match.path.regex: The regex is invalid.")
            assertThat(out).doesNotExist()
            assertThat(site.waits.map(::timeout)).containsExactly(0L)
            assertThat(cli.stdout).isEmpty()
            assertThat(site.deleted).containsExactly(createdToken(cli))
        }

        @Test
        @DisplayName("Dado nenhum gatilho, quando Ctrl+C chega durante a espera, então a URL criada é apagada")
        fun test_interrompido_deveApagarAURL() {
            site.waitDelay = Duration.ofSeconds(30)

            val cli = run("--timeout", "20000")
            await().atMost(Duration.ofSeconds(15)).until { site.waits.any { timeout(it) > 0 } }
            val token = createdToken(cli)
            assertThat(cli.stderr).contains("waiting: send the requests to ${site.base}/$token")
            cli.interrupt()

            assertThat(cli.awaitExit()).isNotZero()
            assertThat(site.deleted).containsExactly(token)
        }
    }

    @Nested
    @DisplayName("Com --token")
    inner class Existing {
        @Test
        @DisplayName(
            "Dado uma URL com mensagens, quando roda, então lê o cursor antes do gatilho, espera depois da mais nova e não cria nem " +
                "apaga a URL",
        )
        fun test_comToken_deveUsarOCursorENaoApagar(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            site.store(message(token, target = "/a"))
            val newest = site.store(message(token, target = "/b"))
            reply(true, message(token))
            val out = dir.resolve("gatilho.txt")
            val cursorBeforeTrigger = mutableListOf<Boolean>()
            site.onList = { cursorBeforeTrigger += !Files.exists(out) }

            val cli = run("--token", token, "--", "touch", out.toString())

            assertThat(cli.awaitExit()).isZero()
            assertThat(cursorBeforeTrigger).containsExactly(true)
            assertThat(out).exists()
            val cursor = newest.getValue("seq").jsonPrimitive.long
            assertThat(site.waits.map { it.getValue("after").jsonPrimitive.long })
                .describedAs("a conferência e a espera, as duas depois da mais nova")
                .containsExactly(cursor, cursor)
            assertThat(site.tokens()).containsExactly(token)
            assertThat(site.deleted).isEmpty()
            assertThat(cli.stderr).contains("url: ${site.base}/$token")
        }

        @Test
        @DisplayName("Dado um token que não existe, quando roda, então escreve Token not found, sai com 2 e não cria URL")
        fun test_tokenInexistente_deveSairComDois(
            @TempDir dir: Path,
        ) {
            val out = dir.resolve("gatilho.txt")

            val cli = run("--token", UUID.randomUUID().toString(), "--", "touch", out.toString())

            assertThat(cli.awaitExit()).isEqualTo(2)
            assertThat(cli.stderr).containsExactly("Token not found")
            assertThat(out).doesNotExist()
            assertThat(site.tokens()).isEmpty()
        }
    }

    @Nested
    @DisplayName("--status")
    inner class Status {
        private val answered = message("x").let { JsonObject(it + ("response" to json("""{"status":202}"""))) }

        @Test
        @DisplayName("Dado as que casaram respondidas com o status pedido, quando roda, então sai com 0")
        fun test_statusIgual_deveSairComZero() {
            reply(true, answered)

            val cli = run("--status", "202", "--", "true")

            assertThat(cli.awaitExit()).isZero()
            assertThat(cli.stderr).contains("status: 1/1 answered 202")
        }

        @Test
        @DisplayName("Dado uma que casou respondida com outro status, quando roda, então diz qual e sai com 1")
        fun test_statusDiferente_deveSairComUm() {
            reply(true, answered)
            val uuid = answered.getValue("uuid").jsonPrimitive.content

            val cli = run("--status", "201", "--", "true")

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).anyMatch { it == "status: expected 201, $uuid was answered 202" }
        }
    }

    @Nested
    @DisplayName("Erros de uso e de servidor")
    inner class Errors {
        @Test
        @DisplayName("Dado uma opção com valor errado, quando roda, então sai com 2 (o 1 é não casou) sem criar URL")
        fun test_usoInvalido_deveSairComDois() {
            val cli = run("--count", "muitos", "--", "true")

            assertThat(cli.awaitExit()).isEqualTo(2)
            assertThat(site.tokens()).isEmpty()
        }

        @Test
        @DisplayName("Dado um --match que não é JSON, quando roda, então sai com 2 sem criar URL")
        fun test_matchQueNaoEJson_deveSairComDois() {
            val cli = run("--match", "{method", "--", "true")

            assertThat(cli.awaitExit()).isEqualTo(2)
            assertThat(cli.stderr).containsExactly("Invalid JSON in --match")
            assertThat(site.tokens()).isEmpty()
        }

        @Test
        @DisplayName("Dado o servidor fora do ar, quando roda, então escreve Could not reach e sai com 2")
        fun test_servidorForaDoAr_deveSairComDois() {
            val server = "http://127.0.0.1:${FakeLocalApp.freePort()}"

            val cli = CliProcess("test", "--server", server, "--", "true").also(this@TestCycleTest.cli::add)

            assertThat(cli.awaitExit()).isEqualTo(2)
            assertThat(cli.stderr).containsExactly("Could not reach $server: connection refused")
        }
    }
}
