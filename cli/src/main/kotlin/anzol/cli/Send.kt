package anzol.cli

import com.github.ajalt.clikt.core.Context
import com.github.ajalt.clikt.core.CoreCliktCommand
import com.github.ajalt.clikt.core.ProgramResult
import com.github.ajalt.clikt.parameters.options.default
import com.github.ajalt.clikt.parameters.options.multiple
import com.github.ajalt.clikt.parameters.options.option
import com.github.ajalt.clikt.parameters.options.required
import com.github.ajalt.clikt.parameters.types.choice
import com.github.ajalt.clikt.parameters.types.int
import com.github.ajalt.clikt.parameters.types.long
import com.github.ajalt.clikt.parameters.types.restrictTo
import sun.misc.Signal
import java.io.IOException
import java.net.URI
import java.net.URISyntaxException
import java.net.http.HttpRequest
import java.net.http.HttpRequest.BodyPublishers
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.time.Clock
import java.time.Duration
import kotlin.io.path.readText
import kotlin.system.exitProcess

private const val MAX_RETRIES = 10
private const val INTERRUPTED = 130
private val SCHEMES = setOf("http", "https")
private const val GENERIC = "generic"
private const val MAX_ASCII = 0x7F

/** Os provedores de `--provider`, menos o genérico, que é montado com as opções dele. */
private val NAMED_PROVIDERS = listOf(Provider.Stripe, Provider.GitHub, Provider.Shopify, Provider.Slack).associateBy { it.id() }

class Send : CoreCliktCommand(name = "send") {
    private val to by option("--to", help = "URL of the app that receives the webhook, e.g. http://localhost:3000/webhooks").required()
    private val method by option("--method", "-X", help = "HTTP method (default POST)").default("POST")
    private val headers by option("--header", "-H", help = "Header \"Name: value\", repeatable; placeholders allowed").multiple()
    private val data by option("--data", "-d", help = "Body; placeholders allowed")
    private val dataFile by option("--data-file", help = "File with the body (UTF-8); placeholders allowed")
    private val provider by option("--provider", help = "Signs as stripe, github, shopify, slack or generic")
        .choice((NAMED_PROVIDERS.keys + GENERIC).associateWith { it })
    private val secret by option("--secret", help = "HMAC secret (never printed)")
    private val sigHeader by option("--sig-header", help = "Generic: header that carries the signature")
    private val algorithm by option("--algorithm", help = "Generic: sha1, sha256 or sha512 (default sha256)")
        .choice(HmacAlgorithm.entries.associateBy { it.id })
    private val encoding by option("--encoding", help = "Generic: hex or base64 (default hex)")
        .choice(SignatureEncoding.entries.associateBy { it.id })
    private val prefix by option("--prefix", help = "Generic: text before the signature, e.g. sha256=")
    private val retries by option("--retries", help = "Retries after the first attempt, 0 to $MAX_RETRIES (default 0)")
        .int()
        .restrictTo(0..MAX_RETRIES)
        .default(0)
    private val backoff by option("--backoff", help = "fixed or exponential (default exponential)")
        .choice(RetryBackoff.entries.associateBy { it.id })
        .default(RetryBackoff.EXPONENTIAL)
    private val initialDelay by option("--initial-delay", help = "First wait between attempts, ms (default 1000)")
        .long()
        .restrictTo(min = 0)
        .default(1000)
    private val maxDelay by option("--max-delay", help = "Longest wait between attempts, Retry-After included, ms (default 30000)")
        .long()
        .restrictTo(min = 0)
        .default(30_000)
    private val timeout by option(
        "--timeout",
        help = "Time limit of each attempt, ms (default 10000)",
    ).long().restrictTo(min = 1).default(10_000)
    private val repeat by option("--repeat", help = "How many events to send (default 1)").int().restrictTo(min = 1).default(1)
    private val interval by option("--interval", help = "Wait between events, ms (default 0)").long().restrictTo(min = 0).default(0)

    override fun help(context: Context) = "Sends webhooks to an app as a provider would: signed, with placeholders and retries."

    override fun run() {
        val signer = signer()
        val outgoing = Outgoing(target(), probedMethod(), parsedHeaders(), body(), signer, Duration.ofMillis(timeout))
        val policy = RetryPolicy(retries, backoff, Duration.ofMillis(initialDelay), Duration.ofMillis(maxDelay))
        val sender =
            Sender(httpClient(Duration.ofMillis(timeout)), outgoing, policy, Clock.systemDefaultZone(), { Thread.sleep(it) }) { echo(it) }
        Signal.handle(Signal("INT")) { exitProcess(INTERRUPTED) }
        val delivered =
            (1..repeat).map { seq ->
                sender.send(seq).also { if (seq < repeat) Thread.sleep(Duration.ofMillis(interval)) }
            }
        if (false in delivered) throw ProgramResult(1)
    }

    private fun signer(): Signer? {
        val chosen = provider
        val key = secret
        val genericOptions = listOfNotNull(sigHeader, algorithm, encoding, prefix)
        return when {
            chosen == null && key != null -> {
                fail("--secret requires --provider")
            }

            chosen != GENERIC && genericOptions.isNotEmpty() -> {
                fail(
                    "--sig-header, --algorithm, --encoding and --prefix apply only to --provider generic",
                )
            }

            chosen == null -> {
                null
            }

            key.isNullOrEmpty() -> {
                fail("--provider requires --secret")
            }

            else -> {
                Signer(NAMED_PROVIDERS[chosen] ?: generic(), key)
            }
        }
    }

    private fun generic(): Provider.Generic {
        val header = sigHeader ?: fail("--provider generic requires --sig-header")
        if (!probe { it.header(header, "x") }) fail("Header not allowed: $header")
        return Provider.Generic(header, algorithm ?: HmacAlgorithm.SHA256, encoding ?: SignatureEncoding.HEX, prefix)
    }

    private fun target(): URI {
        val uri =
            try {
                URI(to)
            } catch (_: URISyntaxException) {
                null
            }
        if (uri == null || uri.scheme?.lowercase() !in SCHEMES || uri.host == null) fail("Invalid URL (expected http:// or https://): $to")
        return uri
    }

    private fun probedMethod(): String =
        method.also {
            if (!probe { builder -> builder.method(it, BodyPublishers.noBody()) }) fail("Invalid method: $it")
        }

    /**
     * `Nome: valor` → par com o valor como template. Sai aqui, antes de enviar, o que o `java.net.http`
     * recusaria (Host, Content-Length…) ou trocaria em silêncio (valor fora do ASCII vira `?`).
     */
    private fun parsedHeaders(): List<Pair<String, Template>> =
        headers.map { raw ->
            val name = raw.substringBefore(':', missingDelimiterValue = "").trim()
            val value = raw.substringAfter(':').trim()
            if (name.isEmpty()) fail("Invalid header (expected \"Name: value\"): $raw")
            if (!probe { it.header(name, "x") }) fail("Header not allowed: $name")
            if (value.any { it.code > MAX_ASCII }) fail("Header value must be ASCII (the HTTP client would send ? instead): $name")
            name to template("--header", value)
        }

    private fun body(): Template? {
        val file = dataFile
        if (data != null && file != null) fail("--data and --data-file cannot be used together")
        val text = if (file == null) data else read(file)
        return text?.let { template(if (file == null) "--data" else "--data-file", it) }
    }

    private fun read(file: String): String =
        try {
            Path.of(file).readText()
        } catch (_: NoSuchFileException) {
            fail("File not found: $file")
        } catch (e: IOException) {
            fail("Could not read $file: ${e.reason()}")
        }

    private fun template(
        option: String,
        text: String,
    ): Template =
        try {
            Template.parse(text)
        } catch (e: IllegalArgumentException) {
            fail("Invalid template in $option: ${e.message}")
        }

    /** O `java.net.http` recusa com [IllegalArgumentException] o que não sabe mandar; aqui, antes do primeiro envio. */
    private fun probe(configure: (HttpRequest.Builder) -> Unit): Boolean =
        try {
            configure(HttpRequest.newBuilder(URI.create("http://localhost")))
            true
        } catch (_: IllegalArgumentException) {
            false
        }
}
