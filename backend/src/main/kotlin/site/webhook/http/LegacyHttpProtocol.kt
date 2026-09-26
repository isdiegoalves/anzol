package site.webhook.http

import jakarta.servlet.http.HttpServletRequest
import org.apache.coyote.Adapter
import org.apache.coyote.Processor
import org.apache.coyote.Request
import org.apache.coyote.Response
import org.apache.coyote.http11.AbstractHttp11Protocol
import org.apache.coyote.http11.Http11NioProtocol
import org.apache.coyote.http11.Http11Processor
import org.apache.tomcat.util.buf.MessageBytes
import org.apache.tomcat.util.http.parser.Host
import site.webhook.legacy.phpIntval
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.nio.charset.StandardCharsets.UTF_8

private const val RAW_PATH_ATTRIBUTE = "site.webhook.rawPath"
private const val HEX_DIGITS = "0123456789abcdefABCDEF"
private const val ESCAPE_LENGTH = 3

/** `Request::getHost()` do Symfony 3.4: o que sobra desta regex no host o torna inválido (400). */
private val SYMFONY_HOST_PART = Regex("(?:^\\[)?[a-zA-Z0-9-:\\]_]+\\.?")
private val SYMFONY_TRAILING_PORT = Regex(":\\d+$")

/**
 * HTTP/1.1 do Tomcat com duas tolerâncias do nginx + Symfony do app antigo, que o Tomcat
 * recusaria com 400 antes de o webhook gravar: `Host` fora da RFC que o Symfony aceita
 * (`my_host.com`, `example.com:abc`) e caminho com escape que o nginx deixa passar (`%` no fim,
 * `%FF`). Entra pelo nome da classe (`TomcatServletWebServerFactory.protocol`), o ponto de
 * extensão do próprio Tomcat.
 */
class LegacyHttpProtocol : Http11NioProtocol() {
    override fun createProcessor(): Processor = SymfonyHostProcessor(this, adapter)

    override fun setAdapter(adapter: Adapter) = super.setAdapter(NginxPathAdapter(adapter))
}

/**
 * O caminho como chegou, antes de o [NginxPathAdapter] escapá-lo para o Tomcat: é o que o app
 * antigo grava em `url` e de onde tira o status. Igual a `requestURI` quando nada foi escapado.
 */
fun HttpServletRequest.rawPath(): String = getAttribute(RAW_PATH_ATTRIBUTE) as? String ?: requestURI

/**
 * Host que o Tomcat recusa e o Symfony aceita vira `serverName` e porta como o Symfony os lê:
 * sem `:porta` numérica no fim, e porta = `(int)` do que vem depois do último `:` (`abc` → 0).
 */
private class SymfonyHostProcessor(
    protocol: AbstractHttp11Protocol<*>,
    adapter: Adapter,
) : Http11Processor(protocol, adapter) {
    override fun parseHost(valueMB: MessageBytes?) {
        val host =
            valueMB
                ?.takeUnless { it.isNull || it.length == 0 || it.isTomcatHost() }
                ?.toString()
                ?.takeIf { it.isSymfonyHost() }
                ?: return super.parseHost(valueMB)
        request.serverName().setString(host.trim().replace(SYMFONY_TRAILING_PORT, ""))
        host.symfonyPort()?.let { request.serverPort = it }
    }

    /** O que o `parseHost` do Tomcat aceitaria: nome válido e porta só com dígitos, cabendo em `int`. */
    private fun MessageBytes.isTomcatHost(): Boolean =
        try {
            val colon = Host.parse(this)
            colon < 0 || toString().substring(colon + 1).isTomcatPort()
        } catch (_: IllegalArgumentException) {
            false
        }

    private fun String.isTomcatPort(): Boolean = all { it in '0'..'9' } && (isEmpty() || toIntOrNull() != null)

    private fun String.isSymfonyHost(): Boolean = SYMFONY_HOST_PART.replace(trim(), "").isEmpty()

    /** `Request::getPort()` a partir do cabeçalho Host; `null` quando não há `:` (o Tomcat usa a do esquema). */
    private fun String.symfonyPort(): Int? {
        val host = trim()
        val colon = if (host.startsWith('[')) host.indexOf(':', host.lastIndexOf(']')) else host.lastIndexOf(':')
        return if (colon < 0) null else phpIntval(host.substring(colon + 1)).coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()
    }
}

/**
 * Caminho que o nginx aceita e o Tomcat não decodificaria (escape incompleto no fim, bytes que
 * não são UTF-8): todo `%` vira `%25` para o Tomcat, que roteia pelo caminho literal, e o cru
 * fica em [rawPath]. O que o nginx também recusa (`%zz`, `%00`) segue para o 400 do Tomcat.
 */
private class NginxPathAdapter(
    private val delegate: Adapter,
) : Adapter by delegate {
    override fun service(
        req: Request,
        res: Response,
    ) {
        req.escapeNginxOnlyPath()
        delegate.service(req, res)
    }

    override fun prepare(
        req: Request,
        res: Response,
    ): Boolean {
        req.escapeNginxOnlyPath()
        return delegate.prepare(req, res)
    }

    private fun Request.escapeNginxOnlyPath() {
        val uri = requestURI()
        if (uri.type != MessageBytes.T_BYTES) return
        val chunk = uri.byteChunk
        val raw = String(chunk.bytes, chunk.start, chunk.length, ISO_8859_1)
        if (!needsEscapeForTomcat(raw)) return
        setAttribute(RAW_PATH_ATTRIBUTE, raw)
        val escaped = raw.replace("%", "%25").toByteArray(ISO_8859_1)
        uri.setBytes(escaped, 0, escaped.size)
    }
}

/**
 * `true` quando o nginx aceita o caminho e o Tomcat responderia 400: `%` com menos de dois
 * caracteres até o fim, ou escapes que não formam UTF-8. `%` seguido de algo que não é hex e
 * `%00` o nginx também recusa, então ficam como estão.
 */
fun needsEscapeForTomcat(path: String): Boolean {
    val bytes = ByteArray(path.length)
    var size = 0
    var truncated = false
    var i = 0
    while (i < path.length) {
        val escape = path.substring(i + 1, minOf(i + ESCAPE_LENGTH, path.length))
        when {
            path[i] != '%' -> bytes[size++] = path[i].code.toByte()
            escape.any { it !in HEX_DIGITS } -> return false
            escape.length < 2 -> truncated = true
            else -> bytes[size++] = escape.toInt(radix = 16).toByte()
        }
        i += if (path[i] == '%') ESCAPE_LENGTH else 1
    }
    val decoded = bytes.copyOf(size)
    return when {
        decoded.contains(0.toByte()) -> false
        truncated -> true
        else -> !decoded.isUtf8()
    }
}

private fun ByteArray.isUtf8(): Boolean =
    try {
        UTF_8.newDecoder().decode(ByteBuffer.wrap(this))
        true
    } catch (_: CharacterCodingException) {
        false
    }
