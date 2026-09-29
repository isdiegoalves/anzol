package anzol.capture

import anzol.http.ClientConnection
import anzol.rules.Fault
import anzol.telemetry.CaptureStopwatch
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.time.Duration
import java.util.concurrent.ThreadLocalRandom

private const val RANDOM_DATA_SIZE = 1024

/** De quanto em quanto tempo a conexão presa confere se o cliente desistiu. */
private val PROBE_INTERVAL = Duration.ofSeconds(1)

/**
 * A falha da regra na conexão do cliente (a mensagem já está gravada): no lugar da resposta ou, nas que começam a
 * resposta ([Fault.startsResponse]), depois do status, dos cabeçalhos e do que o corpo já mandou.
 * `connection_reset` fecha com RST; `empty_response` e `truncated_body` fecham; `malformed_chunk` manda
 * status e cabeçalhos válidos de uma resposta chunked (com o [CAPTURE_SANDBOX] de toda captura), um
 * tamanho de chunk que não é hexadecimal e fecha; `random_data_then_close` manda 1 KiB de bytes
 * aleatórios e fecha (sem cabeçalho nenhum, não há onde pôr o CSP); `hang` e `stall_after_headers` prendem a conexão
 * até o cliente desistir ou [holdMax] e fecham sem escrever mais nada.
 */
fun ClientConnection.fail(
    fault: Fault,
    captured: CapturedRequest,
    holdMax: Duration,
    stopwatch: CaptureStopwatch,
) = when (fault) {
    Fault.CONNECTION_RESET -> reset()
    Fault.EMPTY_RESPONSE, Fault.TRUNCATED_BODY -> close()
    Fault.MALFORMED_CHUNK -> writeAndClose(malformedChunk(captured))
    Fault.RANDOM_DATA_THEN_CLOSE -> writeAndClose(ByteArray(RANDOM_DATA_SIZE).also { ThreadLocalRandom.current().nextBytes(it) })
    Fault.HANG, Fault.STALL_AFTER_HEADERS -> holdThenClose(holdMax, stopwatch)
}

/** Espera sem escrever até o cliente fechar (percebido em até [PROBE_INTERVAL]) ou [holdMax], e fecha (FIN). */
private fun ClientConnection.holdThenClose(
    holdMax: Duration,
    stopwatch: CaptureStopwatch,
) {
    val until = System.nanoTime() + holdMax.toNanos()
    while (!closedByClient()) {
        val left = until - System.nanoTime()
        if (left <= 0) break
        stopwatch.sleep(Duration.ofNanos(minOf(left, PROBE_INTERVAL.toNanos())))
    }
    close()
}

private fun malformedChunk(captured: CapturedRequest): ByteArray =
    (
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n" +
            "X-Request-Id: ${captured.uuid}\r\nX-Token-Id: ${captured.tokenId}\r\n$CSP_HEADER: $CAPTURE_SANDBOX\r\n\r\n" +
            "zz\r\nmalformed chunk\r\n"
    ).toByteArray(ISO_8859_1)
