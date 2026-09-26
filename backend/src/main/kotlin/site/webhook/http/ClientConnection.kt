package site.webhook.http

import jakarta.servlet.http.HttpServletRequest
import org.apache.coyote.ActionCode
import org.apache.coyote.Adapter
import org.apache.coyote.Request
import org.apache.coyote.Response
import org.apache.tomcat.util.net.NioChannel
import org.apache.tomcat.util.net.SocketWrapperBase
import java.net.StandardSocketOptions

private const val CONNECTION_ATTRIBUTE = "site.webhook.clientConnection"

/**
 * A conexão TCP do cliente, abaixo do Servlet, para as falhas de rede das regras. Cada operação
 * encerra a conexão sem que o Tomcat escreva nada depois: o processador recebe `CLOSE_NOW` (a mesma
 * ação com que o Tomcat aborta uma conexão), que descarta a resposta HTTP e fecha o socket ao voltar
 * do Servlet, sem keep-alive.
 */
class ClientConnection(
    private val socket: SocketWrapperBase<*>,
    private val response: Response,
) {
    /** RST: `SO_LINGER` 0 faz o `close` do Tomcat descartar o socket com reset em vez de FIN. */
    fun reset() {
        val channel = checkNotNull(socket.socket as? NioChannel) { "conector sem NIO: ${socket.socket}" }
        channel.ioChannel.setOption(StandardSocketOptions.SO_LINGER, 0)
        abort()
    }

    /** Fecha (FIN) sem escrever nenhum byte. */
    fun close() = abort()

    /** Escreve [bytes] crus no socket, fora do HTTP do Tomcat, e fecha. */
    fun writeAndClose(bytes: ByteArray) {
        socket.write(true, bytes, 0, bytes.size)
        socket.flush(true)
        abort()
    }

    private fun abort() {
        response.action(ActionCode.CLOSE_NOW, null)
    }
}

/** A conexão do cliente desta requisição; só existe atrás do [LegacyHttpProtocol]. */
fun HttpServletRequest.clientConnection(): ClientConnection =
    checkNotNull(getAttribute(CONNECTION_ATTRIBUTE) as? ClientConnection) { "requisição sem o conector LegacyHttpProtocol" }

/**
 * Adapter por processador: antes de cada requisição, deixa nela a [ClientConnection] do socket que o
 * processador está atendendo (o Servlet roda na mesma thread, dentro de `service`).
 */
class ClientConnectionAdapter(
    private val delegate: Adapter,
    private val socket: () -> SocketWrapperBase<*>,
) : Adapter by delegate {
    override fun service(
        req: Request,
        res: Response,
    ) {
        req.setAttribute(CONNECTION_ATTRIBUTE, ClientConnection(socket(), res))
        delegate.service(req, res)
    }
}
