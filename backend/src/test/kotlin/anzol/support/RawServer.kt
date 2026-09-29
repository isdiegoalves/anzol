package anzol.support

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/** Servidor TCP cru: [handle] recebe o socket aceito (resposta à mão, handshake TLS lido como bytes). */
class RawServer(
    handle: (Socket) -> Unit,
) : AutoCloseable {
    private val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
    val port: Int = server.localPort

    init {
        thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                thread(isDaemon = true) { socket.use(handle) }
            }
        }
    }

    override fun close() = server.close()
}
