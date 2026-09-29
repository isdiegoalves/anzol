package anzol.rules

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.Socket
import java.net.SocketException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private const val READ_TIMEOUT_MS = 20_000
private const val CONCURRENT = 50

/** Um pedaço chunked e o instante (ms desde o fim dos cabeçalhos) em que chegou. */
private data class Arrival(
    val data: String,
    val atMs: Long,
)

@ApiTest
@DisplayName("Atrasos, dribble e falhas de rede nas respostas de regra, medidos no cliente")
class RuleTimingApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    /** URL nova com uma regra que responde com [response]. */
    private fun tokenWith(response: String): String {
        val tokenId = api.tokenId()
        val saved = api.send("PUT", "/token/$tokenId/rules", """[{"name":"lenta","response":$response}]""".toByteArray(), JSON_BODY)
        check(saved.statusCode() == 200) { saved.body() }
        return tokenId
    }

    private fun messages(tokenId: String): JsonNode = api.json(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT))["data"]

    private fun elapsedMs(block: () -> Unit): Long {
        val start = System.nanoTime()
        block()
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
    }

    /** Abre uma conexão crua e manda um POST para o webhook; o teste lê e fecha. */
    private fun rawPost(tokenId: String): Socket {
        val socket = Socket("localhost", port)
        socket.soTimeout = READ_TIMEOUT_MS
        val request = "POST /$tokenId/falha HTTP/1.1\r\nHost: localhost:$port\r\nContent-Length: 2\r\n\r\nok"
        socket.getOutputStream().apply {
            write(request.toByteArray(ISO_8859_1))
            flush()
        }
        return socket
    }

    @Nested
    @DisplayName("delay")
    inner class Delay {
        @Test
        @DisplayName(
            "Dado atraso fixo de 1,5 s, quando o webhook chega, então a resposta leva ao menos 1,5 s e a mensagem já está gravada antes",
        )
        fun capture_atrasoFixo_deveEsperarDepoisDeGravar() {
            val tokenId = tokenWith("""{"status":201,"body":"enfim","delay":{"fixed":1500}}""")
            val client = HttpClient.newHttpClient()
            val start = System.nanoTime()

            val pending: CompletableFuture<HttpResponse<String>> =
                client.sendAsync(
                    HttpRequest.newBuilder(URI.create("${api.base}/$tokenId")).GET().build(),
                    HttpResponse.BodyHandlers.ofString(),
                )
            await().atMost(Duration.ofSeconds(5)).until { messages(tokenId).size() == 1 }
            val recordedWhilePending = !pending.isDone
            val response = pending.get(10, TimeUnit.SECONDS)

            assertThat(recordedWhilePending).isTrue()
            assertThat(response.statusCode()).isEqualTo(201)
            assertThat(response.body()).isEqualTo("enfim")
            assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)).isGreaterThanOrEqualTo(1500)
            client.close()
        }

        @Test
        @DisplayName("Dado atraso uniforme entre 300 e 600 ms, quando o webhook chega 3 vezes, então cada resposta leva ao menos 300 ms")
        fun capture_atrasoUniforme_deveFicarNoIntervalo() {
            val tokenId = tokenWith("""{"delay":{"uniform":{"min":300,"max":600}}}""")

            val times = (1..3).map { elapsedMs { api.send("GET", "/$tokenId") } }

            assertThat(times).allSatisfy { assertThat(it).isBetween(300L, 3_000L) }
        }

        @Test
        @DisplayName(
            "Dado atraso de 1 s, quando chegam 50 requisições ao mesmo tempo, então todas respondem em cerca de 1 s (threads virtuais)",
        )
        fun capture_cinquentaSimultaneasComAtraso_deveResponderEmParalelo() {
            val tokenId = tokenWith("""{"status":202,"delay":{"fixed":1000}}""")
            val start = System.nanoTime()

            val statuses =
                Executors.newVirtualThreadPerTaskExecutor().use { executor ->
                    (1..CONCURRENT).map { executor.submit<Int> { api.send("GET", "/$tokenId").statusCode() } }.map { it.get() }
                }

            assertThat(statuses).hasSize(CONCURRENT).containsOnly(202)
            assertThat(Duration.ofNanos(System.nanoTime() - start)).isBetween(Duration.ofSeconds(1), Duration.ofSeconds(4))
        }
    }

    @Nested
    @DisplayName("dribble")
    inner class Dribble {
        @Test
        @DisplayName("Dado dribble de 4 pedaços em 1,2 s, quando o webhook chega, então o corpo vem em 4 chunks espaçados, com flush")
        fun capture_dribble_deveMandarChunksEspacados() {
            val tokenId = tokenWith("""{"status":200,"body":"AAAABBBBCCCCDDDD","dribble":{"chunks":4,"durationMs":1200}}""")

            val (head, arrivals) = rawPost(tokenId).use { socket -> readChunked(BufferedInputStream(socket.getInputStream())) }

            assertThat(head).startsWith("HTTP/1.1 200").containsIgnoringCase("transfer-encoding: chunked")
            assertThat(arrivals.map { it.data }).containsExactly("AAAA", "BBBB", "CCCC", "DDDD")
            assertThat(arrivals.zipWithNext { a, b -> b.atMs - a.atMs }).allSatisfy { assertThat(it).isGreaterThanOrEqualTo(200L) }
            assertThat(arrivals.last().atMs).isGreaterThanOrEqualTo(1_100L)
        }

        /** Lê status e cabeçalhos e depois cada chunk, marcando a chegada; para no chunk vazio. */
        private fun readChunked(input: InputStream): Pair<String, List<Arrival>> {
            val head = generateSequence { readLine(input) }.takeWhile { it.isNotEmpty() }.joinToString("\n")
            val start = System.nanoTime()
            val arrivals =
                generateSequence {
                    val size = readLine(input).substringBefore(';').trim().toInt(radix = 16)
                    val data = String(input.readNBytes(size), ISO_8859_1).also { readLine(input) }
                    Arrival(data, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)).takeIf { size > 0 }
                }.toList()
            return head to arrivals
        }
    }

    @Nested
    @DisplayName("fault")
    inner class Fault {
        @Test
        @DisplayName(
            "Dado connection_reset com delay, quando o webhook chega, então o cliente recebe RST na hora e a mensagem fica gravada",
        )
        fun capture_connectionReset_deveResetarAConexao() {
            val tokenId = tokenWith("""{"status":200,"body":"ignorado","delay":{"fixed":5000},"fault":"connection_reset"}""")

            val elapsed =
                elapsedMs {
                    rawPost(tokenId).use { socket ->
                        assertThatThrownBy { socket.getInputStream().readAllBytes() }
                            .isInstanceOf(SocketException::class.java)
                            .hasMessageContaining("reset")
                    }
                }

            assertThat(elapsed).isLessThan(3_000L)
            assertRecorded(tokenId)
        }

        @Test
        @DisplayName("Dado empty_response, quando o webhook chega, então a conexão fecha sem nenhum byte e a mensagem fica gravada")
        fun capture_emptyResponse_deveFecharSemEscrever() {
            val tokenId = tokenWith("""{"body":"ignorado","fault":"empty_response"}""")

            val received = rawPost(tokenId).use { it.getInputStream().readAllBytes() }

            assertThat(received).isEmpty()
            assertRecorded(tokenId)
        }

        @Test
        @DisplayName("Dado malformed_chunk, quando o webhook chega, então vêm status e cabeçalhos válidos, um chunk inválido e o fim")
        fun capture_malformedChunk_deveMandarChunkInvalido() {
            val tokenId = tokenWith("""{"fault":"malformed_chunk"}""")

            val received = rawPost(tokenId).use { String(it.getInputStream().readAllBytes(), ISO_8859_1) }

            val head = received.substringBefore("\r\n\r\n")
            val sizeLine = received.substringAfter("\r\n\r\n").substringBefore("\r\n")
            assertThat(head).startsWith("HTTP/1.1 200 OK").containsIgnoringCase("transfer-encoding: chunked")
            assertThat(sizeLine).isNotEmpty().doesNotMatch("[0-9a-fA-F]+(;.*)?")
            assertThatThrownBy { api.send("GET", "/$tokenId") }.isInstanceOf(IOException::class.java)
            assertRecorded(tokenId, count = 2)
        }

        @Test
        @DisplayName("Dado random_data_then_close, quando o webhook chega, então vêm bytes que não são HTTP e a conexão fecha")
        fun capture_randomData_deveMandarLixoEFechar() {
            val tokenId = tokenWith("""{"fault":"random_data_then_close"}""")

            val received = rawPost(tokenId).use { it.getInputStream().readAllBytes() }

            assertThat(received).isNotEmpty()
            assertThat(String(received, ISO_8859_1)).doesNotStartWith("HTTP/")
            assertRecorded(tokenId)
        }

        @Test
        @DisplayName("Dado uma falha na conexão anterior, quando outra requisição chega, então o servidor responde normalmente")
        fun capture_depoisDeFalha_deveContinuarRespondendo() {
            val tokenId = tokenWith("""{"fault":"connection_reset"}""")
            rawPost(tokenId).use { socket ->
                assertThatThrownBy { socket.getInputStream().readAllBytes() }.isInstanceOf(IOException::class.java)
            }

            val response = api.send("GET", "/token/$tokenId", headers = JSON_CLIENT)

            assertThat(response.statusCode()).isEqualTo(200)
        }

        private fun assertRecorded(
            tokenId: String,
            count: Int = 1,
        ) {
            val recorded = messages(tokenId)
            assertThat(recorded.size()).isEqualTo(count)
            assertThat(recorded.toList().map { it["rule"]["name"].asString() }.toSet()).containsExactly("lenta")
        }
    }
}

/** Uma linha terminada em CRLF, sem o CRLF; vazia no fim do stream. */
private fun readLine(input: InputStream): String {
    val line = ByteArrayOutputStream()
    var previous = -1
    while (true) {
        val next = input.read()
        val end = next < 0 || (previous == '\r'.code && next == '\n'.code)
        if (previous >= 0 && !(end && previous == '\r'.code)) line.write(previous)
        if (end) break
        previous = next
    }
    return String(line.toByteArray(), ISO_8859_1)
}
