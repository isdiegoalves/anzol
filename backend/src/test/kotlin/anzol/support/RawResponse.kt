package anzol.support

import java.io.ByteArrayOutputStream
import java.net.Socket
import java.nio.charset.StandardCharsets.ISO_8859_1

/** Resposta de [rawHttp]: status, cabeçalhos com nome em minúsculas e corpo já sem chunked. */
data class RawResponse(
    val status: Int,
    val headers: Map<String, String>,
    val body: String,
)

private const val READ_TIMEOUT_MS = 20_000

/**
 * HTTP/1.1 escrito à mão, para o que o `HttpClient` do JDK não deixa mandar: caractere cru no
 * alvo (`"`, `\`, `%` solto), outro `Host`, corpo chunked, dezenas de cabeçalhos. Fecha a
 * conexão ao fim (`Connection: close`) e lê a resposta inteira.
 */
fun rawHttp(
    port: Int,
    requestLine: String,
    headers: List<String> = emptyList(),
    body: ByteArray = ByteArray(0),
    host: String = "localhost:$port",
): RawResponse =
    Socket("localhost", port).use { socket ->
        socket.soTimeout = READ_TIMEOUT_MS
        val head = (listOf(requestLine, "Host: $host") + headers + "Connection: close").joinToString("\r\n") + "\r\n\r\n"
        socket.getOutputStream().apply {
            write(head.toByteArray(ISO_8859_1))
            write(body)
            flush()
        }
        parse(String(socket.getInputStream().readAllBytes(), ISO_8859_1))
    }

private fun parse(raw: String): RawResponse {
    val head = raw.substringBefore("\r\n\r\n")
    val lines = head.split("\r\n")
    val headers = lines.drop(1).associate { it.substringBefore(':').trim().lowercase() to it.substringAfter(':').trim() }
    val body = raw.substringAfter("\r\n\r\n", "")
    return RawResponse(
        status = lines.first().split(' ')[1].toInt(),
        headers = headers,
        body = if (headers["transfer-encoding"] == "chunked") dechunk(body) else body,
    )
}

private fun dechunk(body: String): String {
    val out = StringBuilder()
    var rest = body
    while (rest.isNotEmpty()) {
        val size =
            rest
                .substringBefore("\r\n")
                .substringBefore(';')
                .trim()
                .toInt(radix = 16)
        if (size == 0) break
        rest = rest.substringAfter("\r\n")
        out.append(rest, 0, size)
        rest = rest.substring(size + 2)
    }
    return out.toString()
}

/** Corpo em chunks do tamanho dado, terminado pelo chunk vazio. */
fun chunked(
    body: ByteArray,
    size: Int,
): ByteArray {
    val out = ByteArrayOutputStream()
    for (start in body.indices step size) {
        val end = minOf(start + size, body.size)
        out.write("${Integer.toHexString(end - start)}\r\n".toByteArray(ISO_8859_1))
        out.write(body, start, end - start)
        out.write("\r\n".toByteArray(ISO_8859_1))
    }
    out.write("0\r\n\r\n".toByteArray(ISO_8859_1))
    return out.toByteArray()
}

/** Multipart só com campos de texto. */
fun multipart(
    fields: List<Pair<String, String>>,
    boundary: String = "XyZ",
): ByteArray =
    fields
        .joinToString("") { (name, value) -> "--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n" }
        .plus("--$boundary--\r\n")
        .toByteArray()
