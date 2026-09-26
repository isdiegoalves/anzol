package site.webhook.outbound

import org.apache.hc.client5.http.io.DetachedSocketFactory
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import site.webhook.support.Receiver
import site.webhook.support.reply
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketAddress
import java.net.UnknownHostException
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

private val PERMISSIVE = OutboundProperties(allowPrivate = true)
private val STRICT = OutboundProperties(allowPrivate = false)
private val SHORT = Duration.ofSeconds(1)

private fun get(
    url: String,
    timeout: Duration = Duration.ofSeconds(5),
) = OutboundRequest("GET", url, emptyList(), ByteArray(0), timeout)

private fun Exchange.answered(): Answer = (answer as Checked.Ok).value

private fun Exchange.error(): OutboundError = (answer as Checked.Refused).error

/** Um nome só, que responde [first] na primeira resolução e [later] depois: o rebinding de DNS. */
private class RebindingResolver(
    private val name: String,
    private val first: String,
    private val later: String,
) : HostResolver {
    val calls = AtomicInteger()

    override fun resolve(host: String): List<InetAddress> {
        if (host != name) throw UnknownHostException(host)
        return listOf(InetAddress.ofLiteral(if (calls.getAndIncrement() == 0) first else later))
    }
}

/**
 * Socket que anota o endereço em que o motor conecta e, em vez de sair da máquina, conecta no receptor local:
 * o teste vê o destino que o motor escolheu sem mandar pacote para fora.
 */
private class RecordingSockets(
    private val local: Int,
) : DetachedSocketFactory {
    val connected = CopyOnWriteArrayList<SocketAddress>()

    override fun create(proxy: java.net.Proxy?): Socket =
        object : Socket() {
            override fun connect(
                endpoint: SocketAddress,
                timeout: Int,
            ) {
                connected.add(endpoint)
                super.connect(InetSocketAddress(InetAddress.getLoopbackAddress(), local), timeout)
            }
        }
}

/** Servidor TCP cru: [handle] recebe o socket aceito (resposta à mão, handshake TLS lido como bytes). */
private class RawServer(
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

@DisplayName("Motor de saída")
class OutboundClientTest {
    private val closeables = mutableListOf<AutoCloseable>()

    private fun <T : AutoCloseable> T.closing(): T = also { closeables.add(it) }

    @AfterEach
    fun close() = closeables.asReversed().forEach { it.close() }

    @Nested
    @DisplayName("DNS rebinding")
    inner class Rebinding {
        @Test
        @DisplayName(
            "Dado um nome que resolve público e depois loopback, quando dispara, então conecta no IP público validado, sem nova resolução",
        )
        fun rebinding_deveConectarNoIpValidado() {
            val receiver = Receiver().closing()
            val resolver = RebindingResolver("rebind.test", first = "93.184.216.34", later = "127.0.0.1")
            val sockets = RecordingSockets(receiver.port)
            val client = OutboundClient(STRICT, resolver, sockets).closing()

            val exchange = client.exchange(get("http://rebind.test:${receiver.port}/x"))

            assertThat(exchange.answered().status).isEqualTo(200)
            assertThat(sockets.connected).containsExactly(InetSocketAddress(InetAddress.ofLiteral("93.184.216.34"), receiver.port))
            assertThat(resolver.calls.get()).isEqualTo(1)
            assertThat(receiver.received.single().header("host")).isEqualTo("rebind.test:${receiver.port}")
        }

        @Test
        @DisplayName("Dado um nome que resolve loopback e depois um privado, quando dispara, então chega ao loopback validado")
        fun rebinding_permissivo_deveChegarAoIpValidado() {
            val receiver = Receiver().closing()
            val resolver = RebindingResolver("rebind.test", first = "127.0.0.1", later = "10.255.255.1")
            val client = OutboundClient(PERMISSIVE, resolver).closing()

            val exchange = client.exchange(get("http://rebind.test:${receiver.port}/"))

            assertThat(exchange.answered().status).isEqualTo(200)
            assertThat(receiver.received).hasSize(1)
            assertThat(resolver.calls.get()).isEqualTo(1)
        }

        @Test
        @DisplayName("Dado um nome que resolve para faixa bloqueada, quando dispara, então nenhuma conexão sai")
        fun faixaBloqueada_naoDeveConectar() {
            val sockets = RecordingSockets(1)
            val client = OutboundClient(STRICT, RebindingResolver("meta.test", "169.254.169.254", "169.254.169.254"), sockets).closing()

            val exchange = client.exchange(get("http://meta.test/latest/meta-data"))

            assertThat(exchange.error().kind).isEqualTo(ErrorKind.BLOCKED)
            assertThat(sockets.connected).isEmpty()
        }
    }

    @Test
    @DisplayName("Dado https para um nome, quando conecta no IP validado, então o SNI do handshake leva o nome original")
    fun https_deveMandarONomeNoSni() {
        val hello = ByteArrayOutputStream()
        val server =
            RawServer { socket ->
                socket.soTimeout = 5_000
                val buffer = ByteArray(4096)
                val read = socket.getInputStream().read(buffer)
                if (read > 0) synchronized(hello) { hello.write(buffer, 0, read) }
            }.closing()
        val resolver = RebindingResolver("sni.test", first = "127.0.0.1", later = "10.0.0.1")
        val client = OutboundClient(PERMISSIVE, resolver).closing()

        val exchange = client.exchange(get("https://sni.test:${server.port}/", timeout = SHORT))

        assertThat(exchange.error().kind).isIn(ErrorKind.TLS, ErrorKind.CONNECT)
        assertThat(String(synchronized(hello) { hello.toByteArray() }, ISO_8859_1)).contains("sni.test")
    }

    @Test
    @DisplayName("Dado um 302, quando dispara, então devolve o 302 com o Location e não segue")
    fun redirecionamento_naoDeveSerSeguido() {
        val receiver =
            Receiver { exchange ->
                if (exchange.requestURI.path == "/start") {
                    exchange.reply(302, headers = mapOf("Location" to "http://169.254.169.254/latest/meta-data"))
                } else {
                    exchange.reply(200)
                }
            }.closing()
        val client = OutboundClient(PERMISSIVE).closing()

        val answer = client.exchange(get(receiver.url("/start"))).answered()

        assertThat(answer.status).isEqualTo(302)
        assertThat(answer.headers["location"]).containsExactly("http://169.254.169.254/latest/meta-data")
        assertThat(receiver.received).hasSize(1)
    }

    @Nested
    @DisplayName("Limites")
    inner class Limits {
        @Test
        @DisplayName("Dado um alvo que demora mais que o timeout, quando dispara, então dá timeout no prazo")
        fun alvoLento_deveDarTimeout() {
            val receiver =
                Receiver { exchange ->
                    Thread.sleep(3_000)
                    exchange.reply(200)
                }.closing()
            val client = OutboundClient(PERMISSIVE).closing()
            val started = System.nanoTime()

            val exchange = client.exchange(get(receiver.url("/"), timeout = SHORT))

            assertThat(exchange.error().kind).isEqualTo(ErrorKind.TIMEOUT)
            assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(2_500))
        }

        @Test
        @DisplayName("Dado um alvo que pinga um byte por vez, quando passa do timeout, então o prazo total corta o disparo")
        fun alvoQuePinga_deveCortarNoPrazoTotal() {
            val server =
                RawServer { socket ->
                    val out = socket.getOutputStream()
                    out.write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n".toByteArray(ISO_8859_1))
                    repeat(100) {
                        out.write('a'.code)
                        out.flush()
                        Thread.sleep(200)
                    }
                }.closing()
            val client = OutboundClient(PERMISSIVE).closing()
            val started = System.nanoTime()

            val exchange = client.exchange(get("http://127.0.0.1:${server.port}/", timeout = SHORT))

            assertThat(exchange.error().kind).isEqualTo(ErrorKind.TIMEOUT)
            assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(2_500))
        }

        @Test
        @DisplayName("Dada uma resposta maior que 64 KB, quando lê, então guarda 64 KB e marca truncated")
        fun respostaGrande_deveTruncarEm64KB() {
            val receiver = Receiver { it.reply(200, ByteArray(MAX_RESPONSE_BODY + 10) { 'x'.code.toByte() }) }.closing()
            val client = OutboundClient(PERMISSIVE).closing()

            val answer = client.exchange(get(receiver.url("/"))).answered()

            assertThat(answer.truncated).isTrue()
            assertThat(answer.body.toByteArray(UTF_8)).hasSize(MAX_RESPONSE_BODY)
        }

        @Test
        @DisplayName("Dada uma resposta de exatamente 64 KB, quando lê, então guarda tudo sem truncated")
        fun respostaNoLimite_naoDeveTruncar() {
            val receiver = Receiver { it.reply(200, ByteArray(MAX_RESPONSE_BODY) { 'x'.code.toByte() }) }.closing()
            val client = OutboundClient(PERMISSIVE).closing()

            val answer = client.exchange(get(receiver.url("/"))).answered()

            assertThat(answer.truncated).isFalse()
            assertThat(answer.body).hasSize(MAX_RESPONSE_BODY)
        }

        @Test
        @DisplayName(
            "Dados cabeçalhos de resposta acima de 16 KiB, quando lê, então guarda os primeiros que cabem, inteiros, e marca truncated",
        )
        fun cabecalhosGrandes_devemSerCortadosEmOrdem() {
            val server =
                RawServer { socket ->
                    socket.soTimeout = 5_000
                    socket.getInputStream().read(ByteArray(4096))
                    val head = StringBuilder("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n")
                    repeat(5) { head.append("X-H$it: ").append("$it".repeat(5_000)).append("\r\n") }
                    socket.getOutputStream().write(head.append("\r\nok").toString().toByteArray(ISO_8859_1))
                    socket.getOutputStream().flush()
                }.closing()
            val client = OutboundClient(PERMISSIVE).closing()

            val answer = client.exchange(get("http://127.0.0.1:${server.port}/")).answered()

            // Content-Length: 2 (15) + 3 × (4 + 5000) cabem em 16 KiB; o quarto passaria.
            assertThat(answer.headers.keys).containsExactly("content-length", "x-h0", "x-h1", "x-h2")
            assertThat(answer.headers["x-h2"]).containsExactly("2".repeat(5_000))
            assertThat(answer.body).isEqualTo("ok")
            assertThat(answer.truncated).isTrue()
        }

        @Test
        @DisplayName("Dados cabeçalhos pequenos e corpo de exatamente 64 KB, quando lê, então guarda tudo sem truncated")
        fun cabecalhosPequenos_naoContamNoCorpo() {
            val receiver =
                Receiver { it.reply(200, ByteArray(MAX_RESPONSE_BODY) { 'x'.code.toByte() }, headers = mapOf("X-A" to "1")) }.closing()
            val client = OutboundClient(PERMISSIVE).closing()

            val answer = client.exchange(get(receiver.url("/"))).answered()

            assertThat(answer.truncated).isFalse()
            assertThat(answer.headers["x-a"]).containsExactly("1")
            assertThat(answer.body).hasSize(MAX_RESPONSE_BODY)
        }
    }

    @Test
    @DisplayName("Dado nada escutando na porta, quando dispara com allow-private=true, então dá connect com a mensagem detalhada")
    fun portaFechada_deveDarConnect() {
        val port = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { it.localPort }
        val client = OutboundClient(PERMISSIVE).closing()

        val error = client.exchange(get("http://127.0.0.1:$port/")).error()

        assertThat(error.kind).isEqualTo(ErrorKind.CONNECT)
        assertThat(error.message).contains("127.0.0.1").isNotEqualTo(CONNECT_FAILED)
    }

    @Test
    @DisplayName("Dado um IP público validado que recusa a conexão, quando dispara com allow-private=false, então connect sem o IP")
    fun portaFechada_estrito_naoDeveDizerOIp() {
        val closed = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { it.localPort }
        val sockets = RecordingSockets(closed)
        val client = OutboundClient(STRICT, RebindingResolver("app.test", "93.184.216.34", "93.184.216.34"), sockets).closing()

        val error = client.exchange(get("http://app.test/")).error()

        assertThat(sockets.connected).hasSize(1)
        assertThat(error).isEqualTo(OutboundError(ErrorKind.CONNECT, CONNECT_FAILED))
    }

    @Nested
    @DisplayName("DNS dentro do prazo")
    inner class SlowDns {
        private fun slow(
            name: String,
            delay: Long,
        ) = HostResolver { host ->
            if (host == name) Thread.sleep(delay)
            if (host == name || host == "app.test") listOf(InetAddress.getLoopbackAddress()) else throw UnknownHostException(host)
        }

        @Test
        @DisplayName("Dado um nome cujo DNS demora mais que o timeout, quando dispara com allow-private=false, então timeout no prazo")
        fun dnsLento_estrito_deveDarTimeout() {
            val client = OutboundClient(STRICT, slow("slow.test", 3_000)).closing()
            val started = System.nanoTime()

            val error = client.exchange(get("http://slow.test/", timeout = SHORT)).error()

            assertThat(error.kind).isEqualTo(ErrorKind.TIMEOUT)
            assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(2_500))
        }

        @Test
        @DisplayName("Dado um alias cujo DNS demora mais que o timeout, quando o alvo é localhost, então timeout no prazo")
        fun aliasLento_deveDarTimeout() {
            val properties = OutboundProperties(allowPrivate = true, localhostAlias = "slow.alias")
            val client = OutboundClient(properties, slow("slow.alias", 3_000)).closing()
            val started = System.nanoTime()

            val error = client.exchange(get("http://127.0.0.1:1/", timeout = SHORT)).error()

            assertThat(error.kind).isEqualTo(ErrorKind.TIMEOUT)
            assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(2_500))
        }

        @Test
        @DisplayName("Dado DNS e resposta que cabem no timeout cada um mas não somados, quando dispara, então timeout no prazo total")
        fun dnsEResposta_devemSomarNoPrazo() {
            val receiver =
                Receiver { exchange ->
                    Thread.sleep(700)
                    exchange.reply(200)
                }.closing()
            val client = OutboundClient(PERMISSIVE, slow("app.test", 700)).closing()
            val started = System.nanoTime()

            val error = client.exchange(get("http://app.test:${receiver.port}/", timeout = SHORT)).error()

            assertThat(error.kind).isEqualTo(ErrorKind.TIMEOUT)
            assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(1_500))
        }
    }

    @Test
    @DisplayName("Dado um corpo e cabeçalhos, quando dispara, então chegam como dados, com o Host do nome")
    fun corpoECabecalhos_devemChegarComoDados() {
        val receiver = Receiver().closing()
        val resolver = RebindingResolver("app.test", "127.0.0.1", "127.0.0.1")
        val client = OutboundClient(PERMISSIVE, resolver).closing()
        val body = "{\"a\":\"ção\"}".toByteArray(UTF_8)

        client.exchange(
            OutboundRequest(
                "PATCH",
                "http://app.test:${receiver.port}/p?q=1",
                listOf("X-Um" to "1", "Content-Type" to "application/json"),
                body,
                SHORT,
            ),
        )

        val received = receiver.received.single()
        assertThat(received.method).isEqualTo("PATCH")
        assertThat(received.target).isEqualTo("/p?q=1")
        assertThat(received.body).isEqualTo(body)
        assertThat(received.header("x-um")).isEqualTo("1")
        assertThat(received.header("content-type")).isEqualTo("application/json")
        assertThat(received.header("host")).isEqualTo("app.test:${receiver.port}")
    }
}
