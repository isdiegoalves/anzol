package anzol.outbound

import anzol.support.Receiver
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.time.Duration
import kotlin.concurrent.thread

/**
 * Refutação independente (fatia 04): cada teste aqui fica vermelho no código de `fb0b363` e mostra uma garantia
 * da §1 que não vale. Sem rede de verdade: resolvedores controlados e servidores em 127.0.0.1.
 */
@DisplayName("Refutação SSRF do motor de saída")
class RefutacaoSsrfTest {
    private val closeables = mutableListOf<AutoCloseable>()

    private fun <T : AutoCloseable> T.closing(): T = also { closeables.add(it) }

    @AfterEach
    fun close() = closeables.asReversed().forEach { it.close() }

    /**
     * 192.0.0.0/24 (IETF Protocol Assignments, "não globalmente alcançável" no registro de uso especial da IANA)
     * contém 192.0.0.192, o metadado legado da Oracle Cloud; o motor o trata como público.
     */
    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = ["http://192.0.0.192/latest/meta-data/", "http://3221225664/latest/", "http://[::ffff:192.0.0.192]/"])
    @DisplayName("Dado um alvo em 192.0.0.0/24 com allow-private=false, quando valida, então é bloqueado")
    fun faixaIetf_deveSerBloqueadaNoModoPublico(url: String) {
        val parsed = parseTarget(url) as Checked.Ok
        val verdict = DestinationPolicy(OutboundProperties(allowPrivate = false), SYSTEM_RESOLVER).resolve(parsed.value)

        assertThat(verdict).isInstanceOf(Checked.Refused::class.java)
        assertThat((verdict as Checked.Refused).error.kind).isEqualTo(ErrorKind.BLOCKED)
    }

    /**
     * §1: "Resposta: status, headers e corpo lidos até 64 KB". Hoje só o corpo tem teto; os cabeçalhos vão até
     * 100 linhas de 8 KiB (~800 KB por resultado, ~40 MB nos 50 do histórico de uma URL).
     */
    @Test
    @DisplayName("Dado um alvo que responde ~780 KB de cabeçalhos, quando lê, então o que fica da resposta cabe em 64 KB")
    fun cabecalhosDeResposta_devemCaberNoTeto() {
        val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress()).closing()
        thread(isDaemon = true) {
            server.accept().use { socket ->
                socket.soTimeout = 5_000
                socket.getInputStream().read(ByteArray(64 * 1024))
                val head = StringBuilder("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n")
                repeat(98) { head.append("X-H$it: ").append("a".repeat(8_000)).append("\r\n") }
                socket.getOutputStream().write(head.append("\r\n").toString().toByteArray(ISO_8859_1))
                socket.getOutputStream().flush()
                Thread.sleep(500)
            }
        }
        val client = OutboundClient(OutboundProperties(allowPrivate = true)).closing()

        val url = "http://127.0.0.1:${server.localPort}/"

        val exchange = client.exchange(OutboundRequest("GET", url, emptyList(), ByteArray(0), Duration.ofSeconds(3)))

        val answer = (exchange.answer as? Checked.Ok)?.value
        val kept = answer?.let { it.headers.values.sumOf { values -> values.sumOf(String::length) } + it.body.length }
        assertThat(kept ?: 0).isLessThanOrEqualTo(MAX_RESPONSE_BODY)
    }

    /**
     * O prazo do disparo começa depois da resolução: um nome cujo DNS demora segura a thread além do `timeout`
     * (declarado como residual; o teste fixa a garantia de "prazo total por disparo").
     */
    @Test
    @DisplayName("Dado um nome cujo DNS demora 3 s, quando dispara com timeout de 1 s, então termina no prazo")
    fun dnsLento_deveRespeitarOPrazoTotal() {
        val receiver = Receiver().closing()
        val slow =
            HostResolver {
                Thread.sleep(3_000)
                listOf(InetAddress.getLoopbackAddress())
            }
        val client = OutboundClient(OutboundProperties(allowPrivate = true), slow).closing()
        val started = System.nanoTime()

        client.exchange(OutboundRequest("GET", "http://slow.test:${receiver.port}/", emptyList(), ByteArray(0), Duration.ofSeconds(1)))

        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(2_500))
    }

    /**
     * Com `allow-private=true` o motor alcança o loopback do Mac (via alias), a rede do Docker (o Redis) e a LAN;
     * publicada em todas as interfaces (`"8084:8080"`), a porta dá esse alcance a qualquer um na mesma rede, sem
     * credencial (o `POST /token` é aberto).
     */
    @Test
    @DisplayName("Dado o compose com ANZOL_OUTBOUND_ALLOW_PRIVATE=true, quando publica a porta, então só em 127.0.0.1")
    fun composePermissivo_devePublicarSoNoLoopback() {
        val compose = File("../docker-compose.yml").readText()
        val ports = Regex("""^\s*-\s*"([^"]*:\d+)"\s*$""", RegexOption.MULTILINE).findAll(compose).map { it.groupValues[1] }.toList()

        assertThat(compose).contains("ANZOL_OUTBOUND_ALLOW_PRIVATE=true")
        assertThat(ports).isNotEmpty().allSatisfy { assertThat(it).startsWith("127.0.0.1:") }
    }
}
