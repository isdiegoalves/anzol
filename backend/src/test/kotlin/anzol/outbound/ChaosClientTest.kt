package anzol.outbound

import anzol.support.RawServer
import anzol.support.Receiver
import anzol.support.reply
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.Socket
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

private val PERMISSIVE = OutboundProperties(allowPrivate = true)
private val STRICT = OutboundProperties(allowPrivate = false)
private const val BODY = "{\"pedido\":42,\"ok\":true}"
private const val WAIT_SECONDS = 5L

private fun post(
    url: String,
    body: String = BODY,
    timeout: Duration = Duration.ofSeconds(WAIT_SECONDS),
) = OutboundRequest("POST", url, listOf("Content-Type" to "application/json"), body.toByteArray(UTF_8), timeout)

private fun elapsedSince(started: Long): Duration = Duration.ofNanos(System.nanoTime() - started)

private fun Shot.status(): Int? = ((answer as? Checked.Ok)?.value)?.status

/** Uma requisição lida à mão: a cabeça (até a linha em branco), o corpo pelo `Content-Length` e quando cada um terminou. */
private class RawRequest(
    val head: String,
    val body: ByteArray,
    val headAt: Long,
    val bodyAt: Long,
)

private fun InputStream.readHead(): String {
    val head = ByteArrayOutputStream()
    while (!head.toString(ISO_8859_1).endsWith("\r\n\r\n")) {
        val next = read()
        if (next < 0) break
        head.write(next)
    }
    return head.toString(ISO_8859_1)
}

private fun Socket.readRequest(): RawRequest {
    soTimeout = (WAIT_SECONDS * 1_000).toInt()
    val head = getInputStream().readHead()
    val headAt = System.nanoTime()
    val length =
        Regex("(?i)\r\ncontent-length: (\\d+)")
            .find(head)
            ?.groupValues
            ?.get(1)
            ?.toInt() ?: 0
    val body = getInputStream().readNBytes(length)
    return RawRequest(head, body, headAt, System.nanoTime())
}

private fun Socket.replyOk() {
    getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".toByteArray(ISO_8859_1))
    getOutputStream().flush()
}

@DisplayName("Motor de saída com caos")
class ChaosClientTest {
    private val closeables = mutableListOf<AutoCloseable>()

    private fun <T : AutoCloseable> T.closing(): T = also { closeables.add(it) }

    @AfterEach
    fun close() = closeables.asReversed().forEach { it.close() }

    @Test
    @DisplayName(
        "Dado abort_mid_body, quando dispara, então saem os cabeçalhos com o Content-Length inteiro e metade do corpo, e a " +
            "conexão fecha com FIN, sem esperar resposta",
    )
    fun corte_deveMandarMetadeEFecharSemReset() {
        val received = CompletableFuture<ByteArray>()
        val server =
            RawServer { socket ->
                socket.soTimeout = (WAIT_SECONDS * 1_000).toInt()
                try {
                    received.complete(socket.getInputStream().readAllBytes())
                } catch (e: IOException) {
                    received.completeExceptionally(e)
                }
            }.closing()
        val client = OutboundClient(PERMISSIVE).closing()
        val started = System.nanoTime()

        val delivery = client.exchange(post("http://127.0.0.1:${server.port}/"), Chaos(abortMidBody = true))

        assertThat(elapsedSince(started)).isLessThan(Duration.ofSeconds(2))
        val text = String(received.get(WAIT_SECONDS, TimeUnit.SECONDS), ISO_8859_1)
        val head = text.substringBefore("\r\n\r\n")
        assertThat(head).containsIgnoringCase("\r\nContent-Length: ${BODY.length}")
        assertThat(text.substringAfter("\r\n\r\n")).isEqualTo(BODY.take(BODY.length / 2))
        assertThat(delivery.first.answer).isNull()
        assertThat(delivery.injected()).containsExactly(Injection.ABORT_MID_BODY)
    }

    @Test
    @DisplayName("Dado slow_body_bps, quando dispara, então o corpo chega inteiro, com o Content-Length de sempre, na taxa pedida")
    fun corpoLento_deveChegarNaTaxa() {
        val request = CompletableFuture<RawRequest>()
        val server =
            RawServer { socket ->
                request.complete(socket.readRequest())
                socket.replyOk()
            }.closing()
        val client = OutboundClient(PERMISSIVE).closing()
        val body = "x".repeat(100)

        val delivery = client.exchange(post("http://127.0.0.1:${server.port}/", body), Chaos(slowBodyBps = 250))

        val arrived = request.get(WAIT_SECONDS, TimeUnit.SECONDS)
        assertThat(String(arrived.body, UTF_8)).isEqualTo(body)
        assertThat(arrived.head).containsIgnoringCase("\r\nContent-Length: 100\r\n")
        // Cem bytes a 250 B/s: 400 ms do fim da cabeça ao fim do corpo.
        assertThat(Duration.ofNanos(arrived.bodyAt - arrived.headAt)).isGreaterThanOrEqualTo(Duration.ofMillis(350))
        assertThat(delivery.first.status()).isEqualTo(200)
        assertThat(delivery.injected()).containsExactly(Injection.SLOW_BODY_BPS)
    }

    @Test
    @DisplayName("Dado slow_body_bps com abort_mid_body, quando dispara, então a metade sai na taxa e a conexão fecha")
    fun corpoLentoCortado_deveMandarAMetadeNaTaxa() {
        val received = CompletableFuture<ByteArray>()
        val server =
            RawServer { socket ->
                socket.soTimeout = (WAIT_SECONDS * 1_000).toInt()
                received.complete(socket.getInputStream().readAllBytes())
            }.closing()
        val client = OutboundClient(PERMISSIVE).closing()
        val started = System.nanoTime()

        val delivery =
            client.exchange(post("http://127.0.0.1:${server.port}/", "y".repeat(100)), Chaos(abortMidBody = true, slowBodyBps = 250))

        assertThat(elapsedSince(started)).isGreaterThanOrEqualTo(Duration.ofMillis(150))
        assertThat(String(received.get(WAIT_SECONDS, TimeUnit.SECONDS), ISO_8859_1).substringAfter("\r\n\r\n")).isEqualTo("y".repeat(50))
        assertThat(delivery.injected()).containsExactly(Injection.SLOW_BODY_BPS, Injection.ABORT_MID_BODY)
    }

    @Test
    @DisplayName("Dado timeout_ms, quando o alvo demora, então desiste no prazo e fecha a conexão, sem resposta nem erro")
    fun desistencia_deveFecharNoPrazo() {
        val closedAfter = CompletableFuture<Long>()
        val server =
            RawServer { socket ->
                socket.readRequest()
                val read = System.nanoTime()
                runCatching { socket.getInputStream().read() }
                closedAfter.complete(System.nanoTime() - read)
            }.closing()
        val client = OutboundClient(PERMISSIVE).closing()
        val started = System.nanoTime()

        val delivery = client.exchange(post("http://127.0.0.1:${server.port}/"), Chaos(timeoutMs = 300))

        assertThat(elapsedSince(started)).isLessThan(Duration.ofMillis(1_500))
        assertThat(delivery.first.answer).isNull()
        assertThat(delivery.injected()).containsExactly(Injection.TIMEOUT_MS)
        assertThat(Duration.ofNanos(closedAfter.get(WAIT_SECONDS, TimeUnit.SECONDS))).isLessThan(Duration.ofSeconds(1))
    }

    @Test
    @DisplayName("Dado timeout_ms, quando o alvo responde antes, então a resposta vale e nada é injetado")
    fun desistencia_naoDeveDispararComResposta() {
        val receiver = Receiver { it.reply(201) }.closing()
        val client = OutboundClient(PERMISSIVE).closing()

        val delivery = client.exchange(post(receiver.url("/")), Chaos(timeoutMs = 2_000))

        assertThat(delivery.first.status()).isEqualTo(201)
        assertThat(delivery.injected()).isEmpty()
    }

    @Test
    @DisplayName("Dado delay_ms, quando dispara, então espera antes de sair, e a duração da cópia não conta a espera")
    fun atraso_deveEsperarForaDaDuracao() {
        val arrived = CompletableFuture<Long>()
        val receiver =
            Receiver {
                arrived.complete(System.nanoTime())
                it.reply(200)
            }.closing()
        val client = OutboundClient(PERMISSIVE).closing()
        val started = System.nanoTime()

        val delivery = client.exchange(post(receiver.url("/")), Chaos(delayMs = 400))

        assertThat(Duration.ofNanos(arrived.get(WAIT_SECONDS, TimeUnit.SECONDS) - started)).isGreaterThanOrEqualTo(Duration.ofMillis(400))
        assertThat(delivery.first.duration).isLessThan(Duration.ofMillis(400))
        assertThat(delivery.first.status()).isEqualTo(200)
        assertThat(delivery.injected()).containsExactly(Injection.DELAY_MS)
    }

    @Test
    @DisplayName(
        "Dado duplicate, quando dispara, então a mesma requisição sai de novo depois da resposta da primeira, e as duas " +
            "respostas voltam",
    )
    fun duplicata_deveMandarDeNovoDepoisDaPrimeira() {
        val events = CopyOnWriteArrayList<String>()
        val count = AtomicInteger()
        val receiver =
            Receiver { exchange ->
                val index = count.getAndIncrement()
                events.add("chegou $index")
                if (index == 0) Thread.sleep(200)
                exchange.reply(if (index == 0) 201 else 409)
                events.add("respondeu $index")
            }.closing()
        val client = OutboundClient(PERMISSIVE).closing()

        val delivery = client.exchange(post(receiver.url("/p?q=1")), Chaos(duplicate = true, delayMs = 50))

        assertThat(events).containsExactly("chegou 0", "respondeu 0", "chegou 1", "respondeu 1")
        val (first, second) = receiver.received
        assertThat(second.method).isEqualTo(first.method)
        assertThat(second.target).isEqualTo("/p?q=1").isEqualTo(first.target)
        assertThat(second.body).isEqualTo(first.body).isEqualTo(BODY.toByteArray(UTF_8))
        assertThat(second.headers).isEqualTo(first.headers)
        assertThat(delivery.first.status()).isEqualTo(201)
        assertThat(delivery.second?.status()).isEqualTo(409)
        assertThat(delivery.injected()).containsExactly(Injection.DELAY_MS, Injection.DUPLICATE)
    }

    @Test
    @DisplayName("Dado duplicate com abort_mid_body, quando dispara, então as duas cópias saem cortadas")
    fun duplicataCortada_deveCortarAsDuas() {
        val connections = CopyOnWriteArrayList<ByteArray>()
        val server =
            RawServer { socket ->
                socket.soTimeout = (WAIT_SECONDS * 1_000).toInt()
                connections.add(socket.getInputStream().readAllBytes())
            }.closing()
        val client = OutboundClient(PERMISSIVE).closing()

        val delivery = client.exchange(post("http://127.0.0.1:${server.port}/"), Chaos(abortMidBody = true, duplicate = true))

        assertThat(delivery.first.answer).isNull()
        assertThat(delivery.second?.answer).isNull()
        assertThat(delivery.injected()).containsExactly(Injection.ABORT_MID_BODY, Injection.DUPLICATE)
        Thread.sleep(200)
        assertThat(connections.map { String(it, ISO_8859_1).substringAfter("\r\n\r\n") })
            .containsExactly(BODY.take(BODY.length / 2), BODY.take(BODY.length / 2))
    }

    @Test
    @DisplayName("Dado um destino recusado, quando dispara com caos, então nada é injetado, nem o atraso, e nada sai")
    fun destinoRecusado_naoDeveInjetarNada() {
        val receiver = Receiver().closing()
        val client = OutboundClient(STRICT).closing()
        val started = System.nanoTime()

        val delivery = client.exchange(post(receiver.url("/")), Chaos(delayMs = 3_000, duplicate = true, timeoutMs = 100))

        assertThat(elapsedSince(started)).isLessThan(Duration.ofSeconds(1))
        assertThat((delivery.first.answer as Checked.Refused).error.kind).isEqualTo(ErrorKind.BLOCKED)
        assertThat(delivery.second).isNull()
        assertThat(delivery.injected()).isEmpty()
        assertThat(receiver.received).isEmpty()
    }

    @Test
    @DisplayName("Dado chaos sem nada ligado, quando dispara, então sai como sem caos")
    fun caosVazio_deveSairComoSemCaos() {
        val receiver = Receiver { it.reply(202, "feito".toByteArray()) }.closing()
        val client = OutboundClient(PERMISSIVE).closing()

        val delivery = client.exchange(post(receiver.url("/")), Chaos())

        assertThat((delivery.first.answer as Checked.Ok).value.body).isEqualTo("feito")
        assertThat(delivery.second).isNull()
        assertThat(delivery.injected()).isEmpty()
        assertThat(receiver.received.single().body).isEqualTo(BODY.toByteArray(UTF_8))
    }
}
