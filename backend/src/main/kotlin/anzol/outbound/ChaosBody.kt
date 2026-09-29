package anzol.outbound

import org.apache.hc.core5.http.ContentType
import org.apache.hc.core5.http.io.entity.AbstractHttpEntity
import org.apache.hc.core5.http.protocol.HttpContext
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.Socket
import java.time.Duration

/** Atributo do contexto do Apache com o socket da conexão aberta, que o corte do corpo fecha ([ChaosBody]). */
const val CONNECTION_SOCKET = "anzol.outbound.socket"

private const val PIECES_PER_SECOND = 10
private const val NANOS_PER_SECOND = 1_000_000_000L

/** O corte pedido pelo caos: a cópia termina sem resposta lida, e não é falha de saída. */
class BodyCut : IOException("request body cut by chaos")

/**
 * O corpo com o caos de corpo, sempre com o `Content-Length` inteiro: a [bytesPerSecond] (em até dez pedaços por
 * segundo, depois de os cabeçalhos saírem) e, com [cutAt], só até ali, e a conexão fecha. [started] diz se o envio do
 * corpo começou (a conexão abriu e os cabeçalhos saíram).
 */
class ChaosBody(
    private val body: ByteArray,
    private val bytesPerSecond: Long?,
    private val cutAt: Int?,
    private val context: HttpContext,
) : AbstractHttpEntity(null as ContentType?, null) {
    var started = false
        private set

    override fun getContentLength(): Long = body.size.toLong()

    override fun getContent(): InputStream = ByteArrayInputStream(body)

    override fun isRepeatable(): Boolean = true

    override fun isStreaming(): Boolean = false

    override fun close() = Unit

    override fun writeTo(outStream: OutputStream) {
        started = true
        val end = cutAt ?: body.size
        if (bytesPerSecond == null) outStream.write(body, 0, end) else paced(outStream, end, bytesPerSecond)
        if (cutAt != null) cut(outStream)
    }

    private fun paced(
        out: OutputStream,
        end: Int,
        bytesPerSecond: Long,
    ) {
        val piece = maxOf(1L, bytesPerSecond / PIECES_PER_SECOND).toInt()
        out.flush()
        val start = System.nanoTime()
        for (offset in 0 until end step piece) {
            val size = minOf(piece, end - offset)
            val due = start + (offset + size) * NANOS_PER_SECOND / bytesPerSecond
            Thread.sleep(Duration.ofNanos(maxOf(0L, due - System.nanoTime())))
            out.write(body, offset, size)
            out.flush()
        }
    }

    /** O socket fecha aqui porque, na falha, o Apache fecharia com RST, e o alvo poderia perder a metade que já chegou. */
    private fun cut(out: OutputStream): Nothing {
        out.flush()
        (context.getAttribute(CONNECTION_SOCKET) as? Socket)?.close()
        throw BodyCut()
    }
}

/** O corpo com o caos de corpo pedido, ou nulo quando não há corpo ou nada muda nele. */
fun Chaos.body(
    bytes: ByteArray,
    context: HttpContext,
): ChaosBody? =
    if (bytes.isNotEmpty() && (slowBodyBps != null || abortMidBody)) {
        ChaosBody(bytes, slowBodyBps, if (abortMidBody) bytes.size / 2 else null, context)
    } else {
        null
    }
