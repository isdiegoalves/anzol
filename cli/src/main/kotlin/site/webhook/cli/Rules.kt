package site.webhook.cli

import com.github.ajalt.clikt.core.Context
import com.github.ajalt.clikt.core.CoreCliktCommand
import com.github.ajalt.clikt.core.CoreNoOpCliktCommand
import com.github.ajalt.clikt.core.ProgramResult
import com.github.ajalt.clikt.parameters.arguments.argument
import com.github.ajalt.clikt.parameters.arguments.convert
import com.github.ajalt.clikt.parameters.options.flag
import com.github.ajalt.clikt.parameters.options.option
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.io.IOException
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import kotlin.io.path.writeText

/** Indentação de 2 espaços e quebra de linha final, como o export da tela (`JSON.stringify(regras, null, 2)`). */
@OptIn(ExperimentalSerializationApi::class)
private val prettyJson =
    Json {
        prettyPrint = true
        prettyPrintIndent = "  "
    }

/** Vai ao stderr depois do resumo do `push --dry-run`: quem valida as regras é o servidor, no push de verdade. */
private const val DRY_RUN_NOTE = "Note: --dry-run does not validate the rules; the server validates them on push."

class Rules : CoreNoOpCliktCommand(name = "rules") {
    override fun help(context: Context) = "Downloads or replaces the response rules of a URL."
}

class RulesPull : CoreCliktCommand(name = "pull") {
    private val token by argument("token", help = "Anzol token (uuid)").convert { TokenId(it) }
    private val file by option("--file", help = "Writes the rules to this file instead of stdout")
    private val server by serverOption()
    private val readSecret by readSecretOption()

    override fun help(context: Context) = "Prints the rules of a URL as indented JSON."

    override fun run() {
        val site = WebhookServer(server, httpClient(), readSecret)
        requireAccess(site, token)
        val rules = reaching(site) { site.rules(token) } ?: fail("Token not found")
        val json = prettyJson.encodeToString(JsonElement.serializer(), rules) + "\n"
        val target = file
        if (target == null) {
            // JSON é UTF-8 (RFC 8259), qualquer que seja o locale do terminal: o arquivo redirecionado volta no push.
            System.out.write(json.toByteArray(Charsets.UTF_8))
            System.out.flush()
            return
        }
        try {
            Path.of(target).writeText(json)
        } catch (_: NoSuchFileException) {
            fail("Could not write $target: no such directory")
        } catch (e: IOException) {
            fail("Could not write $target: ${e.reason()}")
        }
    }
}

class RulesPush : CoreCliktCommand(name = "push") {
    private val token by argument("token", help = "Anzol token (uuid)").convert { TokenId(it) }
    private val file by argument("file", help = "JSON file with the list of rules, as pull writes it")
    private val dryRun by option("--dry-run", help = "Prints what the push would change (equal, changed, removed, added) and saves nothing")
        .flag()
    private val server by serverOption()
    private val readSecret by readSecretOption()

    override fun help(context: Context) = "Replaces all the rules of a URL with the list in a JSON file."

    override fun run() {
        val rules = rulesFile(file) { fail(it) }
        val site = WebhookServer(server, httpClient(), readSecret)
        requireAccess(site, token)
        if (dryRun) {
            printDiff(site, rules)
            return
        }
        when (val replaced = reaching(site) { site.replaceRules(token, rules) }) {
            is RulesReplaced.Saved -> {
                echo("Pushed ${replaced.count} rule(s)")
            }

            RulesReplaced.TokenNotFound -> {
                fail("Token not found")
            }

            is RulesReplaced.Invalid -> {
                echoErrors(replaced.errors)
                throw ProgramResult(1)
            }
        }
    }

    /**
     * O resumo do `diff_rules` (JSON indentado no stdout): o arquivo contra as regras salvas, por `id`. Nada é gravado; a
     * validação das regras fica com o push de verdade (a nota no stderr diz isso), menos o `id` repetido, que o CLI
     * recusa como o push recusaria.
     */
    private fun printDiff(
        site: WebhookServer,
        rules: JsonElement,
    ) {
        val proposed = (rules as? JsonArray)?.map { it as? JsonObject ?: fail("Invalid rules in $file: every rule must be an object") }
        if (proposed == null) fail("Invalid rules in $file: expected a list of rules")
        duplicateIdIndex(proposed)?.let { fail("Invalid rules in $file: $it.id: The id field has a duplicate value.") }
        val saved = reaching(site) { site.rules(token) } ?: fail("Token not found")
        val diff = diffRules(saved.map { it.jsonObject }, proposed)
        System.out.write((prettyJson.encodeToString(JsonElement.serializer(), diff) + "\n").toByteArray(Charsets.UTF_8))
        System.out.flush()
        echo(DRY_RUN_NOTE, err = true)
    }
}

/** O JSON de um arquivo de regras, só a sintaxe: se é lista de regras válidas, quem diz é o 422 do servidor. */
fun rulesFile(
    file: String,
    invalid: (String) -> Nothing,
): JsonElement =
    try {
        apiJson.parseToJsonElement(readFile(file, invalid))
    } catch (e: SerializationException) {
        invalid("Invalid JSON in $file: ${e.message.orEmpty().lineSequence().first()}")
    }
