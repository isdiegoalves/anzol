package anzol.cli

import com.github.ajalt.clikt.core.Context
import com.github.ajalt.clikt.core.CoreCliktCommand
import com.github.ajalt.clikt.parameters.arguments.argument
import com.github.ajalt.clikt.parameters.arguments.convert

/**
 * A posição da fila de uma URL: o `seq` da mensagem mais nova, `0` sem mensagens. O teste a lê antes de disparar e
 * espera com `wait-for --after <seq>`: o `--new` lê a posição quando o `wait-for` começa, e perde o disparo que chegou
 * antes. O stdout é só o número, para `$(anzol cursor …)`.
 */
class Cursor : CoreCliktCommand(name = "cursor") {
    private val token by argument("token", help = "Anzol token (uuid)").convert { TokenId(it) }
    private val server by serverOption()
    private val readSecret by readSecretOption()

    override fun help(context: Context) = "Prints the seq of the newest request of a URL (0 when empty), to use with wait-for --after."

    override fun run() {
        val site = AnzolServer(server, httpClient(), readSecret)
        requireAccess(site, token)
        echo(reaching(site) { site.newestSeq(token) } ?: fail("Token not found"))
    }
}
