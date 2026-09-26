package site.webhook.capture

import site.webhook.http.ClientConnection
import site.webhook.rules.Fault
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.util.concurrent.ThreadLocalRandom

private const val RANDOM_DATA_SIZE = 1024

/**
 * A falha da regra na conexão do cliente, no lugar da resposta (a mensagem já está gravada):
 * `connection_reset` fecha com RST; `empty_response` fecha sem nenhum byte; `malformed_chunk` manda
 * status e cabeçalhos válidos de uma resposta chunked, um tamanho de chunk que não é hexadecimal e
 * fecha; `random_data_then_close` manda 1 KiB de bytes aleatórios e fecha.
 */
fun ClientConnection.fail(
    fault: Fault,
    captured: CapturedRequest,
) = when (fault) {
    Fault.CONNECTION_RESET -> reset()
    Fault.EMPTY_RESPONSE -> close()
    Fault.MALFORMED_CHUNK -> writeAndClose(malformedChunk(captured))
    Fault.RANDOM_DATA_THEN_CLOSE -> writeAndClose(ByteArray(RANDOM_DATA_SIZE).also { ThreadLocalRandom.current().nextBytes(it) })
}

private fun malformedChunk(captured: CapturedRequest): ByteArray =
    (
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n" +
            "X-Request-Id: ${captured.uuid}\r\nX-Token-Id: ${captured.tokenId}\r\n\r\n" +
            "zz\r\nmalformed chunk\r\n"
    ).toByteArray(ISO_8859_1)
