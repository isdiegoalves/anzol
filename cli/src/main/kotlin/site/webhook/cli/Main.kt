package site.webhook.cli

import com.github.ajalt.clikt.core.BaseCliktCommand
import com.github.ajalt.clikt.core.CliktError
import com.github.ajalt.clikt.core.Context
import com.github.ajalt.clikt.core.CoreCliktCommand
import com.github.ajalt.clikt.core.CoreNoOpCliktCommand
import com.github.ajalt.clikt.core.ProgramResult
import com.github.ajalt.clikt.core.UsageError
import com.github.ajalt.clikt.core.context
import com.github.ajalt.clikt.core.parse
import com.github.ajalt.clikt.core.subcommands
import com.github.ajalt.clikt.parameters.arguments.argument
import com.github.ajalt.clikt.parameters.arguments.convert
import com.github.ajalt.clikt.parameters.options.convert
import com.github.ajalt.clikt.parameters.options.default
import com.github.ajalt.clikt.parameters.options.option
import com.github.ajalt.clikt.parameters.options.required
import com.github.ajalt.clikt.parameters.options.validate
import sun.misc.Signal
import java.io.IOException
import java.net.http.HttpClient
import java.time.Duration
import kotlin.system.exitProcess

private const val DEFAULT_SERVER = "http://localhost:8084"
private val CONNECT_TIMEOUT: Duration = Duration.ofSeconds(10)

/** O `main` do Clikt, com uma troca: uso inválido do `wait-for` sai com 2, porque o 1 dele é "não casou". */
fun main(args: Array<String>) {
    val webhook = Webhook().subcommands(Listen(), Replay(), Rules().subcommands(RulesPull(), RulesPush()), Send(), WaitFor())
    try {
        webhook.parse(args)
    } catch (e: UsageError) {
        webhook.echoFormattedHelp(e)
        exitProcess(if (e.context?.command is WaitFor) WAIT_FOR_ERROR else e.statusCode)
    } catch (e: CliktError) {
        webhook.echoFormattedHelp(e)
        exitProcess(e.statusCode)
    }
}

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

    override fun help(context: Context) =
        "Delivers the webhooks captured by webhook.site to an app running locally, or sends webhooks to it as a provider would."
}

/** HTTP/1.1 sempre: o padrão do `java.net.http` tentaria upgrade para h2c no app local. */
fun httpClient(connectTimeout: Duration = CONNECT_TIMEOUT): HttpClient =
    HttpClient
        .newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(connectTimeout)
        .build()

/** `--server`, senão `WEBHOOK_SERVER`, senão o app local da porta 8084. */
fun BaseCliktCommand<*>.serverOption() =
    option("--server", envvar = "WEBHOOK_SERVER", help = "webhook.site server (default $DEFAULT_SERVER)").default(DEFAULT_SERVER)

/** Caracteres que o `HttpClient` do JDK manda num cabeçalho: os demais ele troca por `?` sem avisar. */
private val HEADER_TEXT = ' '..'~'

/**
 * `--read-secret`, senão `WEBHOOK_READ_SECRET`: o segredo de leitura de uma URL protegida. Nunca é impresso, nem no
 * erro de validação. Só ASCII imprimível: o cabeçalho do `HttpClient` não leva outro caractere.
 */
fun BaseCliktCommand<*>.readSecretOption() =
    option(
        "--read-secret",
        envvar = "WEBHOOK_READ_SECRET",
        help = "Read secret of a protected URL, sent as $SECRET_HEADER (or set WEBHOOK_READ_SECRET)",
    ).validate { secret ->
        require(secret.all { it in HEADER_TEXT }) { "the read secret must be printable ASCII to go in the $SECRET_HEADER header" }
    }

/** O que dizer quando a URL não dá acesso; nulo quando dá. */
fun TokenAccess.failure(): String? =
    when (this) {
        TokenAccess.OPEN -> null
        TokenAccess.PROTECTED -> "This URL is protected: pass --read-secret or set WEBHOOK_READ_SECRET"
        TokenAccess.LIMITED -> "Too many wrong read secrets for this URL; try again in a minute"
        TokenAccess.NOT_FOUND -> "Token not found"
    }

/** Confere o acesso à URL antes de começar: protegida sem o segredo certo ou inexistente sai com [status]. */
fun BaseCliktCommand<*>.requireAccess(
    site: WebhookServer,
    token: TokenId,
    status: Int = 1,
) {
    reaching(site, status) { site.access(token) }.failure()?.let { fail(it, status) }
}

/** Mensagem no stderr e saída [status]. */
fun BaseCliktCommand<*>.fail(
    message: String,
    status: Int = 1,
): Nothing {
    echo(message, err = true)
    throw ProgramResult(status)
}

/** Servidor fora do ar na partida vira mensagem curta, não stack trace, e saída [status]. */
fun <T> BaseCliktCommand<*>.reaching(
    site: WebhookServer,
    status: Int = 1,
    call: () -> T,
): T =
    try {
        call()
    } catch (e: IOException) {
        fail("Could not reach ${site.base}: ${e.reason()}", status)
    }

class Listen : CoreCliktCommand(name = "listen") {
    private val forward by option("--forward", help = "Local URL that receives each request, e.g. http://localhost:3000").required()
    private val token by option("--token", help = "Existing webhook.site token (uuid); without it a new URL is created")
        .convert { TokenId(it) }
    private val server by serverOption()
    private val readSecret by readSecretOption()

    override fun help(context: Context) = "Forwards every request that arrives at the URL to a local app."

    override fun run() {
        val http = httpClient()
        val site = WebhookServer(server, http, readSecret)
        val listening = token ?: reaching(site) { site.createToken() }
        requireAccess(site, listening)
        val newest = reaching(site) { site.newestSeq(listening) } ?: fail("Token not found")
        Signal.handle(Signal("INT")) { exitProcess(0) }
        Listener(site, listening, Forwarder(forward, http), cursor = newest) { echo(it) }.run {
            echo("Listening on ${site.base}/$listening (forwarding to $forward)")
        }
        fail(reaching(site) { site.access(listening) }.failure() ?: "Token not found")
    }
}

class Replay : CoreCliktCommand(name = "replay") {
    private val token by argument("token", help = "webhook.site token (uuid)").convert { TokenId(it) }
    private val requestId by argument("requestId", help = "Stored request (uuid)").convert { RequestId(it) }
    private val to by option("--to", help = "Local URL that receives the request, e.g. http://localhost:3000").required()
    private val server by serverOption()
    private val readSecret by readSecretOption()

    override fun help(context: Context) = "Forwards one stored request to a local app."

    override fun run() {
        val http = httpClient()
        val site = WebhookServer(server, http, readSecret)
        requireAccess(site, token)
        val message = reaching(site) { site.find(token, requestId) } ?: fail("Request not found")
        val forwarding = Forwarder(to, http).forward(token, message)
        echo(forwarding.line)
        if (!forwarding.delivered) throw ProgramResult(1)
    }
}
