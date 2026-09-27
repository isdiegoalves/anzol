package site.webhook.cli

import com.github.ajalt.clikt.core.Context
import com.github.ajalt.clikt.core.CoreCliktCommand
import com.github.ajalt.clikt.core.ProgramResult
import com.github.ajalt.clikt.parameters.options.convert
import com.github.ajalt.clikt.parameters.options.default
import com.github.ajalt.clikt.parameters.options.flag
import com.github.ajalt.clikt.parameters.options.multiple
import com.github.ajalt.clikt.parameters.options.option
import com.github.ajalt.clikt.parameters.options.required
import com.github.ajalt.clikt.parameters.types.int
import com.github.ajalt.clikt.parameters.types.long
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.io.IOException
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.time.Duration
import kotlin.io.path.readText

/** Uso inválido, 422, token inexistente ou servidor fora; o 1 do `wait-for` é "o prazo acabou sem casar". */
const val WAIT_FOR_ERROR = 2
private const val DEFAULT_TIMEOUT_MS = 30_000L

/** O servidor é quem corta a espera; o cliente só desiste bem depois do prazo pedido. */
private val HTTP_SLACK: Duration = Duration.ofSeconds(10)
private val JSON_LITERALS = setOf("true", "false", "null")
private val JSON_NUMBER = Regex("""-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?""")

/**
 * Os atalhos do `wait-for`, cada um uma chave de topo do `match`. Aplicados sobre o `--match`, substituem a
 * chave de mesmo nome; `--body-contains` e `--json-path` formam juntos a lista do `body`.
 */
data class MatchShortcuts(
    val methods: List<String> = emptyList(),
    val pathPrefix: String? = null,
    val headers: Map<String, String> = emptyMap(),
    val bodyContains: String? = null,
    val jsonPaths: List<String> = emptyList(),
) {
    fun applyTo(base: JsonObject): JsonObject {
        val body = listOfNotNull(bodyContains?.let { buildJsonObject { put("contains", it) } }) + jsonPaths.map(::jsonPathCondition)
        val shortcuts =
            buildMap {
                if (methods.isNotEmpty()) put("method", JsonArray(methods.map(::JsonPrimitive)))
                if (pathPrefix != null) put("path", buildJsonObject { put("prefix", pathPrefix) })
                if (headers.isNotEmpty()) {
                    put(
                        "headers",
                        JsonObject(
                            headers.mapValues { (_, value) ->
                                buildJsonObject { put("equals", value) }
                            },
                        ),
                    )
                }
                if (body.isNotEmpty()) put("body", JsonArray(body))
            }
        return JsonObject(base + shortcuts)
    }
}

/** `$.a` → basta existir; `$.a=<json>` → igual ao valor, com o que vem depois do primeiro `=` lido como JSON, ou como texto. */
private fun jsonPathCondition(shortcut: String): JsonObject =
    buildJsonObject {
        putJsonObject("jsonPath") {
            put("path", shortcut.substringBefore('='))
            if ('=' in shortcut) put("equals", jsonOrText(shortcut.substringAfter('=')))
        }
    }

private fun jsonOrText(text: String): JsonElement = strictJson(text) ?: JsonPrimitive(text)

/** O texto como JSON; `null` se não for. */
private fun strictJson(text: String): JsonElement? =
    try {
        apiJson.parseToJsonElement(text).takeIf { it.isStrict() }
    } catch (_: SerializationException) {
        null
    }

/** O `parseToJsonElement` aceita literal sem aspas (`pago`); sem aspas, o JSON só tem número, `true`, `false` e `null`. */
private fun JsonElement.isStrict(): Boolean =
    when (this) {
        is JsonObject -> values.all { it.isStrict() }
        is JsonArray -> all { it.isStrict() }
        is JsonPrimitive -> isString || content in JSON_LITERALS || JSON_NUMBER.matches(content)
    }

class WaitFor : CoreCliktCommand(name = "wait-for") {
    private val token by option("--token", help = "Anzol token (uuid)").convert { TokenId(it) }.required()
    private val server by serverOption()
    private val readSecret by readSecretOption()
    private val match by option("--match", help = "JSON object in the format of a response rule's match")
    private val matchFile by option("--match-file", help = "File with the match JSON object")
    private val methods by option("--method", help = "Accepted method, repeatable").multiple()
    private val path by option("--path", help = "Path after the token starts with this prefix")
    private val headers by option("--header", help = "Header \"Name: value\" with exactly this value, repeatable").multiple()
    private val bodyContains by option("--body-contains", help = "Body contains this text")
    private val jsonPaths by option("--json-path", help = "'<path>' exists or '<path>=<json>' equals in the JSON body, repeatable")
        .multiple()
    private val count by option("--count", help = "How many matching requests are needed, 1 to 100 (default 1)").int().default(1)
    private val timeout by option("--timeout", help = "How long to wait for new requests, ms (default 30000)")
        .long()
        .default(DEFAULT_TIMEOUT_MS)
    private val after by option("--after", help = "Only requests with seq greater than this").long()
    private val new by option("--new", help = "Only requests that arrive after the command starts").flag()

    override fun help(context: Context) =
        "Waits until the URL receives requests that match, then prints them as a JSON array (exit 0; 1 on timeout)."

    override fun run() {
        if (after != null && new) invalid("--after and --new cannot be used together")
        val matchJson = shortcuts().applyTo(baseMatch())
        val site = WebhookServer(server, httpClient(), readSecret)
        requireAccess(site, token, WAIT_FOR_ERROR)
        val wait =
            buildJsonObject {
                put("match", matchJson)
                cursor(site)?.let { put("after", it) }
                put("count", count)
                put("timeout", timeout)
            }
        val start = System.nanoTime()
        val answer = reaching(site, WAIT_FOR_ERROR) { site.waitFor(token, wait, Duration.ofMillis(timeout).plus(HTTP_SLACK)) }
        val elapsed = Duration.ofNanos(System.nanoTime() - start).toMillis()
        when (answer) {
            is WaitAnswer.Answered -> {
                report(answer.result, elapsed)
            }

            is WaitAnswer.Invalid -> {
                answer.errors.forEach { (key, messages) -> messages.forEach { echo("$key: $it", err = true) } }
                throw ProgramResult(WAIT_FOR_ERROR)
            }

            WaitAnswer.TokenNotFound -> {
                invalid("Token not found")
            }
        }
    }

    /** stdout só com o array das que casaram (pronto para o `jq`); o resumo vai para o stderr. */
    private fun report(
        result: WaitResult,
        elapsed: Long,
    ) {
        System.out.write((result.requests.toString() + "\n").toByteArray(Charsets.UTF_8))
        System.out.flush()
        if (result.matched) return echo("matched ${result.count}/$count in $elapsed ms", err = true)
        echo("timed out after $elapsed ms: ${result.count}/$count matched", err = true)
        val closest = result.nearMiss
        if (closest != null) {
            echo("closest: #${closest.seq} ${closest.uuid}", err = true)
            closest.failed.forEach { echo("  - $it", err = true) }
        }
        throw ProgramResult(1)
    }

    /** `--after`, ou com `--new` o `seq` da mensagem mais nova agora; sem os dois, o histórico inteiro. */
    private fun cursor(site: WebhookServer): Long? =
        if (new) {
            reaching(site, WAIT_FOR_ERROR) { site.newestSeq(token) } ?: invalid("Token not found")
        } else {
            after
        }

    private fun shortcuts(): MatchShortcuts =
        MatchShortcuts(
            methods = methods,
            pathPrefix = path,
            headers = headers.associate(::header),
            bodyContains = bodyContains,
            jsonPaths = jsonPaths,
        )

    private fun header(raw: String): Pair<String, String> {
        val name = raw.substringBefore(':', missingDelimiterValue = "").trim()
        if (name.isEmpty()) invalid("Invalid header (expected \"Name: value\"): $raw")
        return name to raw.substringAfter(':').trim()
    }

    /** O objeto de `--match` ou `--match-file`; sem os dois, `{}`. Se é um `match` válido, quem diz é o 422 do servidor. */
    private fun baseMatch(): JsonObject {
        val file = matchFile
        if (match != null && file != null) invalid("--match and --match-file cannot be used together")
        val source = if (file == null) "--match" else file
        val text = if (file == null) match else read(file)
        if (text == null) return JsonObject(emptyMap())
        val parsed = strictJson(text) ?: invalid("Invalid JSON in $source")
        return parsed as? JsonObject ?: invalid("Invalid match in $source: expected a JSON object")
    }

    private fun read(file: String): String =
        try {
            Path.of(file).readText()
        } catch (_: NoSuchFileException) {
            invalid("File not found: $file")
        } catch (e: IOException) {
            invalid("Could not read $file: ${e.reason()}")
        }

    private fun invalid(message: String): Nothing = fail(message, WAIT_FOR_ERROR)
}
