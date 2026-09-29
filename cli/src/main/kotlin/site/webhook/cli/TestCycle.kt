package site.webhook.cli

import com.github.ajalt.clikt.core.BaseCliktCommand
import com.github.ajalt.clikt.core.Context
import com.github.ajalt.clikt.core.CoreCliktCommand
import com.github.ajalt.clikt.core.ProgramResult
import com.github.ajalt.clikt.parameters.arguments.argument
import com.github.ajalt.clikt.parameters.arguments.multiple
import com.github.ajalt.clikt.parameters.groups.provideDelegate
import com.github.ajalt.clikt.parameters.options.convert
import com.github.ajalt.clikt.parameters.options.option
import com.github.ajalt.clikt.parameters.types.int
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import java.lang.ProcessBuilder.Redirect
import java.time.Duration
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

const val TRIGGER_FAILED = 3

/** Um filho do gatilho em segundo plano pode segurar o stdout aberto: não esperar a saída dele para sempre. */
private val TRIGGER_OUTPUT_GRACE: Duration = Duration.ofSeconds(2)

/**
 * `anzol test`: o cursor é lido antes do gatilho, e a espera é a do `wait-for --after <cursor>`. Saídas: as do
 * `wait-for` (0 casou, 1 não casou, 2 erro) e [TRIGGER_FAILED].
 */
class TestCycle : CoreCliktCommand(name = "test") {
    private val token by option("--token", help = "Existing URL (uuid); without it a new URL is created and deleted at the end")
        .convert { TokenId(it) }
    private val rules by option("--rules", help = "JSON file with rules that replace the URL's rules before the trigger, as rules push")
    private val status by option("--status", help = "Every matching request must have been answered with this status").int()
    private val server by serverOption()
    private val readSecret by readSecretOption()
    private val wait by WaitOptions()
    private val trigger by argument(
        "trigger",
        help = "Command that makes your app send the webhook, after --; {url} in it becomes the URL (also in ANZOL_URL)",
    ).multiple()

    override fun help(context: Context) = "Runs a webhook test in one command: creates the URL, runs the trigger, waits and cleans up."

    override fun helpEpilog(context: Context) =
        """
        |Steps: create the URL (or use --token), push --rules, read the cursor, have the server check the match, run
        |the trigger, wait for the requests that arrived after the cursor, check --status, delete the URL it created
        |(also on failure and Ctrl+C).
        |Without a trigger, it waits for requests sent from elsewhere.
        |
        |Matching requests go to stdout as a JSON array; progress goes to stderr, with the trigger's own output.
        |
        |Exit status: 0 the requests arrived (and --status held); 1 they did not arrive before --timeout, or --status did
        |not hold; 2 usage error, match or rules refused by the server, Token not found, or server unreachable;
        |3 the trigger could not start or exited with a non-zero status.
        |
        |Example: anzol test --rules rules.json --method POST --path /orders --status 202 -- ./send-order.sh {url}
        """.trimMargin()

    override fun run() {
        val match = wait.match(::invalid)
        val ruleList = rules?.let { file -> rulesFile(file, ::invalid) }
        val site = WebhookServer(server, httpClient(), readSecret)
        val existing = token
        if (existing != null) {
            requireAccess(site, existing, WAIT_FOR_ERROR)
            echo("url: ${site.base}/$existing", err = true)
            return cycle(site, existing, ruleList, match)
        }
        val created = reaching(site, WAIT_FOR_ERROR) { site.createToken() }
        echo("url: ${site.base}/$created (created; deleted at the end)", err = true)
        deletingAtTheEnd(site, created) { cycle(site, created, ruleList, match) }
    }

    private fun cycle(
        site: WebhookServer,
        id: TokenId,
        ruleList: JsonElement?,
        match: JsonObject,
    ) {
        if (ruleList != null) push(site, id, ruleList)
        // URL recém-criada: cursor 0, para valer o que chegar logo depois do "url:".
        val cursor = if (token == null) 0 else reaching(site, WAIT_FOR_ERROR) { site.newestSeq(id) } ?: invalid("Token not found")
        echo("cursor: $cursor", err = true)
        // Com timeout 0 o servidor só confere o match: recusado sai com 2 antes de o gatilho mandar o webhook à toa.
        requestWait(site, id, wait.body(match, cursor, timeout = 0))
        val address = "${site.base}/$id"
        if (trigger.isEmpty()) {
            echo("waiting: send the requests to $address", err = true)
        } else {
            runTrigger(address, id)
        }
        val result = awaitMatching(site, id, match, cursor, wait)
        if (!result.matched) throw ProgramResult(1)
        status?.let { checkStatus(result.requests, it) }
    }

    private fun push(
        site: WebhookServer,
        id: TokenId,
        ruleList: JsonElement,
    ) {
        when (val replaced = reaching(site, WAIT_FOR_ERROR) { site.replaceRules(id, ruleList) }) {
            is RulesReplaced.Saved -> {
                echo("rules: pushed ${replaced.count} rule(s) from $rules", err = true)
            }

            is RulesReplaced.Invalid -> {
                echoErrors(replaced.errors)
                throw ProgramResult(WAIT_FOR_ERROR)
            }

            RulesReplaced.TokenNotFound -> {
                invalid("Token not found")
            }
        }
    }

    /**
     * O stdout do gatilho vai para o stderr: o stdout do `test` é só o JSON. Só o nome do programa é impresso, os
     * argumentos podem ter segredo.
     */
    private fun runTrigger(
        address: String,
        id: TokenId,
    ) {
        val command = trigger.map { it.replace("{url}", address) }
        val program = command.first()
        val start = System.nanoTime()
        val process =
            try {
                ProcessBuilder(command)
                    .redirectInput(Redirect.INHERIT)
                    .redirectError(Redirect.INHERIT)
                    .apply { environment() += mapOf("ANZOL_URL" to address, "ANZOL_TOKEN" to id.toString()) }
                    .start()
            } catch (e: IOException) {
                fail("trigger: could not start $program: ${e.reason()}", TRIGGER_FAILED)
            }
        val output = thread(isDaemon = true) { process.inputStream.transferTo(System.err) }
        val exit = process.waitFor()
        output.join(TRIGGER_OUTPUT_GRACE)
        val elapsed = Duration.ofNanos(System.nanoTime() - start).toMillis()
        val line = "trigger: $program exited with $exit after $elapsed ms"
        if (exit != 0) fail(line, TRIGGER_FAILED)
        echo(line, err = true)
    }

    private fun checkStatus(
        requests: JsonArray,
        expected: Int,
    ) {
        val answered = requests.map { it.jsonObject }.associateWith(::respondedStatus)
        val wrong = answered.filterValues { it != expected }
        if (wrong.isEmpty()) return echo("status: ${requests.size}/${requests.size} answered $expected", err = true)
        wrong.forEach { (message, got) ->
            val uuid = message["uuid"]?.jsonPrimitive?.content
            echo("status: expected $expected, $uuid was answered ${got ?: "without a recorded status"}", err = true)
        }
        throw ProgramResult(1)
    }

    private fun respondedStatus(message: JsonObject): Int? =
        (message["response"] as? JsonObject)
            ?.get("status")
            ?.jsonPrimitive
            ?.intOrNull

    private fun invalid(message: String): Nothing = fail(message, WAIT_FOR_ERROR)
}

private fun BaseCliktCommand<*>.deletingAtTheEnd(
    site: WebhookServer,
    id: TokenId,
    block: () -> Unit,
) {
    val deleted = AtomicBoolean()
    val delete = { if (deleted.compareAndSet(false, true)) deleteUrl(site, id) }
    val onSignal = thread(start = false) { delete() }
    Runtime.getRuntime().addShutdownHook(onSignal)
    try {
        block()
    } finally {
        try {
            Runtime.getRuntime().removeShutdownHook(onSignal)
        } catch (_: IllegalStateException) {
            // o desligamento já começou: o gancho apaga
        }
        delete()
    }
}

/** Não apagar não muda o resultado do teste: a URL expira como qualquer outra. */
private fun BaseCliktCommand<*>.deleteUrl(
    site: WebhookServer,
    id: TokenId,
) {
    try {
        site.deleteToken(id)
        echo("url: deleted", err = true)
    } catch (e: IOException) {
        echo("url: could not delete ${site.base}/$id: ${e.reason()}", err = true)
    }
}
