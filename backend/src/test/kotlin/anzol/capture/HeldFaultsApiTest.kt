package anzol.capture

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.time.Duration

/** Uma conexão crua com um POST ao webhook, aberta até o teste fechar. */
class RawConnection(
    port: Int,
    path: String,
) : AutoCloseable {
    private val socket = Socket("localhost", port)
    private val started = System.nanoTime()

    init {
        val body = """{"id":1}"""
        val request =
            "POST $path HTTP/1.1\r\nHost: localhost:$port\r\nContent-Type: application/json\r\n" +
                "Content-Length: ${body.length}\r\nConnection: close\r\n\r\n$body"
        socket.getOutputStream().apply {
            write(request.toByteArray(ISO_8859_1))
            flush()
        }
    }

    /** O que chegou até [wait] desde a abertura: tudo até o servidor fechar, ou o que veio até o prazo com a conexão aberta. */
    fun read(wait: Duration): Received {
        val deadline = started + wait.toNanos()
        val bytes = StringBuilder()
        var next = 0
        while (next >= 0 && System.nanoTime() < deadline) {
            socket.soTimeout = maxOf(1L, (deadline - System.nanoTime()) / NANOS_PER_MILLI).toInt()
            next =
                try {
                    socket.getInputStream().read().also { if (it >= 0) bytes.append(it.toChar()) }
                } catch (_: SocketTimeoutException) {
                    0
                }
        }
        return Received(bytes.toString(), closed = next < 0, atMs = elapsedMs())
    }

    /** Algo já chegou (sem esperar). */
    fun answered(): Boolean = socket.getInputStream().available() > 0

    private fun elapsedMs(): Long = (System.nanoTime() - started) / NANOS_PER_MILLI

    override fun close() = socket.close()

    private companion object {
        const val NANOS_PER_MILLI = 1_000_000L
    }
}

/** Bytes vindos do servidor; [closed]: ele fechou a conexão, visto em [atMs] desde a abertura. */
data class Received(
    val bytes: String,
    val closed: Boolean,
    val atMs: Long,
) {
    val head: String = bytes.substringBefore("\r\n\r\n")
    val body: String = bytes.substringAfter("\r\n\r\n", "")
    val status: Int? =
        head
            .takeIf { "\r\n\r\n" in bytes }
            ?.split(' ')
            ?.getOrNull(1)
            ?.toIntOrNull()

    fun header(name: String): String? =
        head
            .split("\r\n")
            .drop(1)
            .firstOrNull { it.substringBefore(':').trim().equals(name, ignoreCase = true) }
            ?.substringAfter(':')
            ?.trim()
}

@ApiTest
@DisplayName("Falhas hang, stall_after_headers e truncated_body e o teto de conexões presas")
class HeldFaultsApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
    private val heldConnections: HeldConnections,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun tokenWith(rules: String): String {
        val tokenId = api.tokenId()
        val saved = api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY)
        check(saved.statusCode() == 200) { saved.body() }
        return tokenId
    }

    private val opened = mutableListOf<RawConnection>()

    private fun open(path: String) = RawConnection(port, path).also(opened::add)

    private fun messages(tokenId: String): JsonNode = api.json(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT))["data"]

    private fun message(
        tokenId: String,
        requestId: String,
    ): JsonNode = api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT))

    /** Fecha as conexões e espera o servidor perceber e devolver todas as vagas (em até 5 s). */
    private fun closeAndAwaitRelease(connections: List<RawConnection>) {
        connections.forEach(RawConnection::close)
        await().atMost(Duration.ofSeconds(5)).until { heldConnections.held() == 0 }
    }

    @AfterEach
    fun closeOpened() = closeAndAwaitRelease(opened)

    @Nested
    @DisplayName("hang")
    inner class Hang {
        @Test
        @DisplayName(
            "Dado hang, quando o webhook chega, então a mensagem é gravada com a falha e nenhum byte sai enquanto o cliente espera",
        )
        fun capture_hang_deveGravarENaoMandarNada() {
            val tokenId = tokenWith("""[{"name":"presa","response":{"status":201,"body":"x","delay":{"fixed":5000},"fault":"hang"}}]""")

            val connection = open("/$tokenId")
            await().atMost(Duration.ofSeconds(3)).until { messages(tokenId).size() == 1 }
            val received = connection.read(Duration.ofSeconds(4))

            assertThat(received.bytes).isEmpty()
            assertThat(received.closed).isFalse()
            assertThat(heldConnections.held()).isEqualTo(1)
            assertThat(messages(tokenId)[0]["response"]).isEqualTo(api.tree("""{"fault":"hang"}"""))
            assertThat(messages(tokenId)[0]["rule"]["name"].asString()).isEqualTo("presa")
        }
    }

    @Nested
    @DisplayName("stall_after_headers e truncated_body")
    inner class Started {
        @Test
        @DisplayName(
            "Dado stall_after_headers, quando o webhook chega, então vêm status e cabeçalhos com o Content-Length do corpo e mais nada",
        )
        fun capture_stall_deveMandarSoOsCabecalhos() {
            val tokenId =
                tokenWith(
                    """[{"name":"parada","response":{"status":202,"headers":{"X-Mock":"sim"},"body":"abcdefghij",""" +
                        """"delay":{"fixed":5000},"fault":"stall_after_headers"}}]""",
                )

            val connection = open("/$tokenId")
            val received = connection.read(Duration.ofSeconds(3))

            assertThat(received.status).`as`(received.bytes).isEqualTo(202)
            assertThat(received.header("Content-Length")).isEqualTo("10")
            assertThat(received.header("Transfer-Encoding")).isNull()
            assertThat(received.header("X-Mock")).isEqualTo("sim")
            assertThat(received.header("X-Request-Id")).isNotNull()
            assertThat(received.header("Content-Security-Policy")).isEqualTo(CAPTURE_SANDBOX)
            assertThat(received.body).isEmpty()
            assertThat(received.closed).isFalse()
            assertThat(messages(tokenId)[0]["response"]).isEqualTo(api.tree("""{"fault":"stall_after_headers"}"""))
        }

        @Test
        @DisplayName(
            "Dado truncated_body com template, quando o webhook chega, então vêm o Content-Length inteiro, metade do corpo e o fim",
        )
        fun capture_truncated_deveMandarMetadeEFechar() {
            val tokenId =
                tokenWith(
                    """[{"name":"corta","response":{"status":201,"body":"{{request.method}}-0123456789","template":true,""" +
                        """"delay":{"fixed":5000},"fault":"truncated_body"}}]""",
                )

            val received = open("/$tokenId").use { it.read(Duration.ofSeconds(4)) }

            assertThat(received.closed).`as`(received.bytes).isTrue()
            assertThat(received.atMs).isLessThan(3000)
            assertThat(received.status).isEqualTo(201)
            assertThat(received.header("Content-Length")).isEqualTo("15")
            assertThat(received.body).isEqualTo("POST-01")
            assertThat(messages(tokenId)[0]["response"]).isEqualTo(api.tree("""{"fault":"truncated_body"}"""))
            assertThat(heldConnections.held()).isZero()
        }
    }

    @Nested
    @DisplayName("Teto de conexões presas")
    inner class Limits {
        @Test
        @DisplayName(
            "Dado 16 conexões presas numa URL, quando chega a 17ª, então ela recebe 503 com X-Fault-Limit e é gravada com a regra; " +
                "outra URL continua prendendo e as vagas voltam quando os clientes fecham",
        )
        fun capture_tetoPorUrl_deveRecusarA17a() {
            val tokenId =
                tokenWith(
                    """[{"name":"presa","match":{"path":{"equals":"/h"}},"response":{"fault":"hang"}},""" +
                        """{"name":"parada","match":{"path":{"equals":"/s"}},"response":{"body":"abc","fault":"stall_after_headers"}}]""",
                )
            val other = tokenWith("""[{"name":"presa","response":{"fault":"hang"}}]""")
            val held = List(8) { open("/$tokenId/h") } + List(8) { open("/$tokenId/s") }
            await().atMost(Duration.ofSeconds(10)).until { messages(tokenId).size() == 16 }

            val refused = open("/$tokenId/h").use { it.read(Duration.ofSeconds(5)) }
            val elsewhere = open("/$other")
            val elsewhereReceived = elsewhere.read(Duration.ofSeconds(2))

            assertThat(refused.status).`as`(refused.bytes).isEqualTo(503)
            assertThat(refused.header("X-Fault-Limit")).isEqualTo("16 held connections on this URL")
            assertThat(refused.body).isEqualTo("The hang fault was not applied: 16 held connections on this URL.")
            val recorded = message(tokenId, checkNotNull(refused.header("X-Request-Id")))
            assertThat(recorded["rule"]["name"].asString()).isEqualTo("presa")
            assertThat(recorded["response"]).isEqualTo(api.tree("""{"status":503}"""))
            assertThat(elsewhereReceived.bytes).isEmpty()
            assertThat(elsewhereReceived.closed).isFalse()
            assertThat(heldConnections.held()).isEqualTo(17)
            closeAndAwaitRelease(held + elsewhere)
            val again = open("/$tokenId/h")
            assertThat(again.read(Duration.ofSeconds(2)).bytes).isEmpty()
        }

        @Test
        @DisplayName(
            "Dado 200 hang ao mesmo tempo em 20 URLs, quando chegam, então 128 ficam presas, as outras recebem 503 com o teto do " +
                "servidor, e uma URL sem regra e a API respondem em menos de 2 s",
        )
        fun capture_tetoDoServidor_naoDeveDerrubarAsOutrasUrls() {
            val urls = List(20) { tokenWith("""[{"name":"presa","response":{"fault":"hang"}}]""") }
            val free = api.tokenId()
            val connections = urls.flatMap { tokenId -> List(10) { open("/$tokenId/carga") } }
            await().atMost(Duration.ofSeconds(20)).until { urls.sumOf { messages(it).size() } == 200 }
            await().atMost(Duration.ofSeconds(5)).until { connections.count(RawConnection::answered) == 200 - MAX_HELD }

            val refused = connections.filter(RawConnection::answered).map { it.read(Duration.ofSeconds(1)) }
            val times =
                List(10) {
                    val start = System.nanoTime()
                    assertThat(api.send("POST", "/$free/vivo", "ok".toByteArray()).statusCode()).isEqualTo(200)
                    Duration.ofNanos(System.nanoTime() - start)
                }
            val start = System.nanoTime()
            val token = api.send("GET", "/token/$free", headers = JSON_CLIENT)
            val tokenTime = Duration.ofNanos(System.nanoTime() - start)

            assertThat(heldConnections.held()).isEqualTo(MAX_HELD)
            assertThat(refused.map { it.status }.toSet()).containsExactly(503)
            assertThat(refused.map { it.header("X-Fault-Limit") }.toSet()).containsExactly("128 held connections on this server")
            assertThat(times).allSatisfy { assertThat(it).isLessThan(Duration.ofSeconds(2)) }
            assertThat(token.statusCode()).isEqualTo(200)
            assertThat(tokenTime).isLessThan(Duration.ofSeconds(2))
        }
    }
}
