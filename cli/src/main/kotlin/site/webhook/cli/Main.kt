package site.webhook.cli

import com.github.ajalt.clikt.core.Context
import com.github.ajalt.clikt.core.CoreCliktCommand
import com.github.ajalt.clikt.core.CoreNoOpCliktCommand
import com.github.ajalt.clikt.core.main
import com.github.ajalt.clikt.core.subcommands
import com.github.ajalt.clikt.parameters.options.convert
import com.github.ajalt.clikt.parameters.options.default
import com.github.ajalt.clikt.parameters.options.option
import com.github.ajalt.clikt.parameters.options.required
import java.net.http.HttpClient
import java.time.Duration

private const val DEFAULT_SERVER = "http://localhost:8084"
private val CONNECT_TIMEOUT: Duration = Duration.ofSeconds(10)

fun main(args: Array<String>) = Webhook().subcommands(Listen()).main(args)

class Webhook : CoreNoOpCliktCommand(name = "webhook") {
    override fun help(context: Context) = "Delivers the webhooks captured by webhook.site to an app running locally."
}

/** HTTP/1.1 sempre: o padrão do `java.net.http` tentaria upgrade para h2c no app local. */
private fun httpClient(): HttpClient =
    HttpClient
        .newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .connectTimeout(CONNECT_TIMEOUT)
        .build()

class Listen : CoreCliktCommand(name = "listen") {
    private val forward by option("--forward", help = "Local URL that receives each request, e.g. http://localhost:3000").required()
    private val token by option("--token", help = "Existing webhook.site token (uuid)").convert { TokenId(it) }.required()
    private val server by option("--server", envvar = "WEBHOOK_SERVER", help = "webhook.site server").default(DEFAULT_SERVER)

    override fun help(context: Context) = "Forwards every request that arrives at the URL to a local app."

    override fun run() {
        val http = httpClient()
        val site = WebhookServer(server, http)
        Listener(site, token, Forwarder(forward, http)) { echo(it) }.run {
            echo("Listening on ${site.base}/$token (forwarding to $forward)")
        }
    }
}
