package site.webhook.cli

import com.github.ajalt.clikt.core.BaseCliktCommand
import com.github.ajalt.clikt.core.Context
import com.github.ajalt.clikt.core.CoreCliktCommand
import com.github.ajalt.clikt.core.CoreNoOpCliktCommand
import com.github.ajalt.clikt.core.ProgramResult
import com.github.ajalt.clikt.core.context
import com.github.ajalt.clikt.core.main
import com.github.ajalt.clikt.core.subcommands
import com.github.ajalt.clikt.parameters.arguments.argument
import com.github.ajalt.clikt.parameters.arguments.convert
import com.github.ajalt.clikt.parameters.options.convert
import com.github.ajalt.clikt.parameters.options.default
import com.github.ajalt.clikt.parameters.options.option
import com.github.ajalt.clikt.parameters.options.required
import sun.misc.Signal
import java.io.IOException
import java.net.http.HttpClient
import java.time.Duration
import kotlin.system.exitProcess

private const val DEFAULT_SERVER = "http://localhost:8084"
private val CONNECT_TIMEOUT: Duration = Duration.ofSeconds(10)

fun main(args: Array<String>) = Webhook().subcommands(Listen(), Replay()).main(args)

/**
 * O `clikt-core` (sem o Mordant, que no JDK 25 avisa sobre acesso nativo no stderr) não lê
 * variável de ambiente, não separa stderr e não encerra o processo: os três ficam ligados aqui.
 */
class Webhook : CoreNoOpCliktCommand(name = "webhook") {
    init {
        context {
            readEnvvar = System::getenv
            exitProcess = { status -> kotlin.system.exitProcess(status) }
            echoMessage = { _, message, trailingNewline, err ->
                val stream = if (err) System.err else System.out
                stream.print(if (trailingNewline) "$message\n" else message)
                stream.flush()
            }
        }
    }

    override fun help(context: Context) = "Delivers the webhooks captured by webhook.site to an app running locally."
}

/** HTTP/1.1 sempre: o padrão do `java.net.http` tentaria upgrade para h2c no app local. */
private fun httpClient(): HttpClient =
    HttpClient
        .newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(CONNECT_TIMEOUT)
        .build()

/** `--server`, senão `WEBHOOK_SERVER`, senão o app local da porta 8084. */
private fun BaseCliktCommand<*>.serverOption() =
    option("--server", envvar = "WEBHOOK_SERVER", help = "webhook.site server (default $DEFAULT_SERVER)").default(DEFAULT_SERVER)

/** Mensagem no stderr e saída 1. */
private fun BaseCliktCommand<*>.fail(message: String): Nothing {
    echo(message, err = true)
    throw ProgramResult(1)
}

/** Servidor fora do ar na partida vira mensagem curta, não stack trace. */
private fun <T> BaseCliktCommand<*>.reaching(
    site: WebhookServer,
    call: () -> T,
): T =
    try {
        call()
    } catch (e: IOException) {
        fail("Could not reach ${site.base}: ${e.reason()}")
    }

class Listen : CoreCliktCommand(name = "listen") {
    private val forward by option("--forward", help = "Local URL that receives each request, e.g. http://localhost:3000").required()
    private val token by option("--token", help = "Existing webhook.site token (uuid); without it a new URL is created")
        .convert { TokenId(it) }
    private val server by serverOption()

    override fun help(context: Context) = "Forwards every request that arrives at the URL to a local app."

    override fun run() {
        val http = httpClient()
        val site = WebhookServer(server, http)
        val listening = token ?: reaching(site) { site.createToken() }
        val newest = reaching(site) { site.newest(listening, page = 1) } ?: fail("Token not found")
        Signal.handle(Signal("INT")) { exitProcess(0) }
        Listener(site, listening, Forwarder(forward, http), cursor = newest.data.firstOrNull()) { echo(it) }.run {
            echo("Listening on ${site.base}/$listening (forwarding to $forward)")
        }
        fail("Token not found")
    }
}

class Replay : CoreCliktCommand(name = "replay") {
    private val token by argument("token", help = "webhook.site token (uuid)").convert { TokenId(it) }
    private val requestId by argument("requestId", help = "Stored request (uuid)").convert { RequestId(it) }
    private val to by option("--to", help = "Local URL that receives the request, e.g. http://localhost:3000").required()
    private val server by serverOption()

    override fun help(context: Context) = "Forwards one stored request to a local app."

    override fun run() {
        val http = httpClient()
        val site = WebhookServer(server, http)
        if (!reaching(site) { site.exists(token) }) fail("Token not found")
        val message = reaching(site) { site.find(token, requestId) } ?: fail("Request not found")
        val forwarding = Forwarder(to, http).forward(token, message)
        echo(forwarding.line)
        if (!forwarding.delivered) throw ProgramResult(1)
    }
}
