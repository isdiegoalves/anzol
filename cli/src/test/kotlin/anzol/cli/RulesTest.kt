package anzol.cli

import anzol.cli.support.CliProcess
import anzol.cli.support.FakeAnzol
import anzol.cli.support.FakeLocalApp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.nio.file.Path
import java.util.UUID
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText

/** A nota do `push --dry-run` no stderr: o resumo não valida as regras. */
private const val DRY_RUN_NOTE = "Note: --dry-run does not validate the rules; the server validates them on push."

/** Regra no formato do Anexo A, já com `id`, como o servidor a devolve. */
private fun rule(
    name: String,
    body: String = "",
): JsonObject =
    buildJsonObject {
        put("id", UUID.randomUUID().toString())
        put("name", name)
        put("enabled", true)
        put("priority", 5)
        putJsonObject("match") {
            putJsonArray("method") { add(JsonPrimitive("POST")) }
            putJsonObject("path") { put("equals", "/pagamentos") }
        }
        putJsonObject("response") {
            put("status", 201)
            putJsonObject("headers") { put("Content-Type", "application/json") }
            put("body", body)
        }
    }

private fun JsonArray.names(): List<String> =
    map {
        it.jsonObject
            .getValue("name")
            .jsonPrimitive.content
    }

@DisplayName("anzol rules")
class RulesTest {
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
    ): CliProcess = CliProcess("rules", *args, env = env).also(cli::add)

    @Nested
    @DisplayName("pull")
    inner class Pull {
        @Test
        @DisplayName("Dado uma URL com regras, quando roda pull, então imprime a lista em JSON indentado no stdout e sai com 0")
        fun pull_urlComRegras_deveImprimirJsonIndentado() {
            val token = site.createToken()
            val rules = JsonArray(listOf(rule("pagamento aprovado", body = """{"ok":true}"""), rule("recusado")))
            site.storeRules(token, rules)

            val cli = run("pull", token, "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(0)
            assertThat(Json.parseToJsonElement(cli.stdout.joinToString("\n"))).isEqualTo(rules)
            assertThat(cli.stdout).contains("[", "  {", "    \"name\": \"pagamento aprovado\",", "]")
            assertThat(cli.stderr).isEmpty()
        }

        @Test
        @DisplayName(
            "Dado --file, quando roda pull, então grava o JSON indentado no arquivo, com quebra de linha final, e não imprime nada",
        )
        fun pull_comFile_deveGravarArquivo(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            val rules = JsonArray(listOf(rule("pagamento aprovado")))
            site.storeRules(token, rules)
            val file = dir.resolve("regras.json")

            val cli = run("pull", token, "--file", file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(0)
            assertThat(Json.parseToJsonElement(file.readText())).isEqualTo(rules)
            assertThat(file.readText()).startsWith("[\n  {\n").endsWith("]\n")
            assertThat(cli.stdout).isEmpty()
        }

        @Test
        @DisplayName("Dado --file numa pasta que não existe, quando roda pull, então escreve Could not write e sai com 1")
        fun pull_fileEmPastaInexistente_deveSairComErro(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            val file = dir.resolve("nao-existe").resolve("regras.json")

            val cli = run("pull", token, "--file", file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly("Could not write $file: no such directory")
            assertThat(cli.stdout).isEmpty()
        }

        @Test
        @DisplayName(
            "Dado uma regra com texto fora do ASCII e o locale C, quando roda pull, então o stdout sai em UTF-8 sem perder caracteres",
        )
        fun pull_textoForaDoAsciiComLocaleC_deveSairEmUtf8() {
            val token = site.createToken()
            val rules = JsonArray(listOf(rule("ação ✓", body = "café 😀")))
            site.storeRules(token, rules)

            val cli = run("pull", token, "--server", site.base, env = mapOf("LC_ALL" to "C", "LANG" to "C"))

            assertThat(cli.awaitExit()).isEqualTo(0)
            assertThat(Json.parseToJsonElement(cli.stdout.joinToString("\n"))).isEqualTo(rules)
        }

        @Test
        @DisplayName("Dado ANZOL_SERVER e nenhum --server, quando roda pull, então usa o servidor da variável")
        fun pull_semServerComVariavel_deveUsarVariavel() {
            val token = site.createToken()
            site.storeRules(token, JsonArray(emptyList()))

            val cli = run("pull", token, env = mapOf("ANZOL_SERVER" to site.base))

            assertThat(cli.awaitExit()).isEqualTo(0)
            assertThat(Json.parseToJsonElement(cli.stdout.joinToString("\n"))).isEqualTo(JsonArray(emptyList()))
        }

        @Test
        @DisplayName(
            "Dado um token que não existe, quando roda pull com --file, então escreve Token not found, não cria o arquivo e sai com 1",
        )
        fun pull_tokenInexistente_deveSairComErro(
            @TempDir dir: Path,
        ) {
            val file = dir.resolve("regras.json")

            val cli = run("pull", UUID.randomUUID().toString(), "--file", file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly("Token not found")
            assertThat(file.exists()).isFalse()
        }

        @Test
        @DisplayName("Dado o servidor fora do ar, quando roda pull, então escreve Could not reach e sai com 1")
        fun pull_servidorForaDoAr_deveSairComErro() {
            val server = "http://127.0.0.1:${FakeLocalApp.freePort()}"

            val cli = run("pull", UUID.randomUUID().toString(), "--server", server)

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly("Could not reach $server: connection refused")
        }
    }

    @Nested
    @DisplayName("push --dry-run")
    inner class DryRun {
        @Test
        @DisplayName(
            "Dado regras salvas e um arquivo com uma igual, uma alterada e uma nova, quando roda push --dry-run, então imprime " +
                "o resumo por id, não grava e sai com 0",
        )
        fun pushDryRun_arquivo_deveImprimirResumoSemGravar(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            val igual = rule("igual")
            val muda = rule("muda")
            val sai = rule("sai")
            site.storeRules(token, JsonArray(listOf(igual, muda, sai)))
            val alterada = JsonObject(muda + ("priority" to JsonPrimitive(1)))
            val semPadroes =
                buildJsonObject {
                    put("id", igual.getValue("id"))
                    put("name", "igual")
                    putJsonObject("match") {
                        putJsonArray("method") { add(JsonPrimitive("POST")) }
                        putJsonObject("path") { put("equals", "/pagamentos") }
                    }
                    putJsonObject("response") {
                        put("status", 201)
                        putJsonObject("headers") { put("Content-Type", "application/json") }
                    }
                }
            val file = dir.resolve("regras.json")
            file.writeText(
                buildJsonArray {
                    add(semPadroes)
                    add(alterada)
                    add(buildJsonObject { put("name", "nova") })
                }.toString(),
            )

            val cli = run("push", token, "--dry-run", file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(0)
            assertThat(Json.parseToJsonElement(cli.stdout.joinToString("\n"))).isEqualTo(
                Json.parseToJsonElement(
                    """{"equal":[${igual.getValue("id")}],""" +
                        """"changed":[{"id":${muda.getValue("id")},"name":"muda","fields":["priority"]}],""" +
                        """"removed":[{"id":${sai.getValue("id")},"name":"sai"}],"added":[{"name":"nova"}]}""",
                ),
            )
            assertThat(cli.stderr).containsExactly(DRY_RUN_NOTE)
            assertThat(site.rulePuts.get()).isZero()
            assertThat(site.rules(token)).isEqualTo(JsonArray(listOf(igual, muda, sai)))
        }

        @Test
        @DisplayName("Dado o id de uma regra salva em maiúsculas no arquivo, quando roda push --dry-run, então é a mesma regra (UUID)")
        fun pushDryRun_idEmMaiusculas_deveCompararComoUuid(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            val salva = rule("salva")
            site.storeRules(token, JsonArray(listOf(salva)))
            val maiusculas =
                JsonObject(
                    salva + (
                        "id" to
                            JsonPrimitive(
                                salva
                                    .getValue("id")
                                    .jsonPrimitive.content
                                    .uppercase(),
                            )
                    ),
                )
            val file = dir.resolve("regras.json")
            file.writeText(JsonArray(listOf(maiusculas)).toString())

            val cli = run("push", token, "--dry-run", file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(0)
            assertThat(Json.parseToJsonElement(cli.stdout.joinToString("\n"))).isEqualTo(
                Json.parseToJsonElement("""{"equal":[${salva.getValue("id")}],"changed":[],"removed":[],"added":[]}"""),
            )
        }

        @Test
        @DisplayName(
            "Dado um arquivo com o mesmo id duas vezes (caixas diferentes), quando roda push --dry-run, então diz o id repetido como " +
                "o push recusaria, sai com 1 e não grava",
        )
        fun pushDryRun_idRepetido_deveSairComErro(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            val id = UUID.randomUUID().toString()
            val file = dir.resolve("regras.json")
            file.writeText("""[{"id":"$id","name":"a"},{"id":"${id.uppercase()}","name":"b"}]""")

            val cli = run("push", token, "--dry-run", file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly("Invalid rules in $file: 1.id: The id field has a duplicate value.")
            assertThat(cli.stdout).isEmpty()
            assertThat(site.rulePuts.get()).isZero()
        }

        @Test
        @DisplayName("Dado um token que não existe, quando roda push --dry-run, então escreve Token not found e sai com 1")
        fun pushDryRun_tokenInexistente_deveSairComErro(
            @TempDir dir: Path,
        ) {
            val file = dir.resolve("regras.json")
            file.writeText("[]")

            val cli = run("push", UUID.randomUUID().toString(), "--dry-run", file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly("Token not found")
        }

        @Test
        @DisplayName("Dado um arquivo que não é lista, quando roda push --dry-run, então diz que espera uma lista e sai com 1")
        fun pushDryRun_naoLista_deveSairComErro(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            val file = dir.resolve("regras.json")
            file.writeText("{}")

            val cli = run("push", token, "--dry-run", file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly("Invalid rules in $file: expected a list of rules")
            assertThat(site.rulePuts.get()).isZero()
        }
    }

    @Nested
    @DisplayName("push")
    inner class Push {
        @Test
        @DisplayName("Dado um arquivo com duas regras, quando roda push, então troca a lista da URL, imprime Pushed 2 rule(s) e sai com 0")
        fun push_arquivoComRegras_deveTrocarALista(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            site.storeRules(token, JsonArray(listOf(rule("antiga"))))
            val file = dir.resolve("regras.json")
            file.writeText(
                buildJsonArray {
                    add(buildJsonObject { put("name", "pagamento aprovado") })
                    add(rule("recusado", body = "não ✓"))
                }.toString(),
            )

            val cli = run("push", token, file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(0)
            assertThat(cli.stdout).containsExactly("Pushed 2 rule(s)")
            assertThat(site.rules(token).names()).containsExactly("pagamento aprovado", "recusado")
            assertThat(
                site
                    .rules(token)[1]
                    .jsonObject["response"]
                    ?.jsonObject
                    ?.get("body")
                    ?.jsonPrimitive
                    ?.content,
            ).isEqualTo("não ✓")
        }

        @Test
        @DisplayName("Dado um arquivo com lista vazia, quando roda push, então apaga as regras da URL e imprime Pushed 0 rule(s)")
        fun push_listaVazia_deveApagarAsRegras(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            site.storeRules(token, JsonArray(listOf(rule("antiga"))))
            val file = dir.resolve("regras.json").apply { writeText("[]") }

            val cli = run("push", token, file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(0)
            assertThat(cli.stdout).containsExactly("Pushed 0 rule(s)")
            assertThat(site.rules(token)).isEmpty()
        }

        @Test
        @DisplayName(
            "Dado regras que o servidor recusa com 422, quando roda push, então escreve cada chave e mensagem no stderr e sai com 1",
        )
        fun push_regrasInvalidas_deveListarOsErros(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            val kept = JsonArray(listOf(rule("antiga")))
            site.storeRules(token, kept)
            val file = dir.resolve("regras.json").apply { writeText("""[{"enabled":true},{"name":"ok"},{"priority":1}]""") }

            val cli = run("push", token, file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly("0.name: The name field is required.", "2.name: The name field is required.")
            assertThat(cli.stdout).isEmpty()
            assertThat(site.rules(token)).isEqualTo(kept)
        }

        @Test
        @DisplayName("Dado um JSON válido que não é lista, quando roda push, então repassa o 422 do servidor e sai com 1")
        fun push_jsonQueNaoELista_deveRepassarO422(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            val file = dir.resolve("regras.json").apply { writeText("""{"name":"sozinha"}""") }

            val cli = run("push", token, file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly("rules: The rules must be an array.")
        }

        @Test
        @DisplayName("Dado um token que não existe, quando roda push, então escreve Token not found e sai com 1")
        fun push_tokenInexistente_deveSairComErro(
            @TempDir dir: Path,
        ) {
            val file = dir.resolve("regras.json").apply { writeText("[]") }

            val cli = run("push", UUID.randomUUID().toString(), file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly("Token not found")
            assertThat(cli.stdout).isEmpty()
        }

        @Test
        @DisplayName("Dado um arquivo que não existe, quando roda push, então escreve File not found, não chama o servidor e sai com 1")
        fun push_arquivoInexistente_deveSairSemChamarOServidor(
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            val file = dir.resolve("nao-existe.json")

            val cli = run("push", token, file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).containsExactly("File not found: $file")
            assertThat(site.rulePuts.get()).isZero()
        }

        @ParameterizedTest(name = "[{index}] conteúdo: {0}")
        @ValueSource(strings = ["", "   ", "[", "[{\"name\":}]", "[{\"name\":\"a\"},]", "{'name':'a'}", "[1] lixo"])
        @DisplayName(
            "Dado um arquivo que não é JSON válido, quando roda push, então escreve Invalid JSON, não chama o servidor e sai com 1",
        )
        fun push_jsonInvalido_deveSairSemChamarOServidor(
            content: String,
            @TempDir dir: Path,
        ) {
            val token = site.createToken()
            val file = dir.resolve("regras.json").apply { writeText(content) }

            val cli = run("push", token, file.toString(), "--server", site.base)

            assertThat(cli.awaitExit()).isEqualTo(1)
            assertThat(cli.stderr).singleElement().asString().startsWith("Invalid JSON in $file: ")
            assertThat(site.rulePuts.get()).isZero()
        }
    }

    @Test
    @DisplayName("Dado regras na URL, quando faz pull, push do mesmo arquivo e pull de novo, então os dois arquivos são idênticos")
    fun rules_idaEVolta_deveManterOArquivoIgual(
        @TempDir dir: Path,
    ) {
        val token = site.createToken()
        site.storeRules(token, JsonArray(listOf(rule("pagamento aprovado", body = "{\"ok\":true}\n"), rule("ação ✓"))))
        val first = dir.resolve("primeiro.json")
        val second = dir.resolve("segundo.json")

        assertThat(run("pull", token, "--file", first.toString(), "--server", site.base).awaitExit()).isEqualTo(0)
        assertThat(run("push", token, first.toString(), "--server", site.base).awaitExit()).isEqualTo(0)
        assertThat(run("pull", token, "--file", second.toString(), "--server", site.base).awaitExit()).isEqualTo(0)

        assertThat(second.readText()).isEqualTo(first.readText())
        assertThat(site.rulePuts.get()).isEqualTo(1)
    }
}
