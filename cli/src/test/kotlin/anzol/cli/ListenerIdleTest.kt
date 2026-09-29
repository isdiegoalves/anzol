package anzol.cli

import anzol.cli.support.FakeAnzol
import anzol.cli.support.FakeLocalApp
import anzol.cli.support.message
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.net.http.HttpClient
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch

@DisplayName("Listener: conexão muda")
class ListenerIdleTest {
    private val site = FakeAnzol()
    private val app = FakeLocalApp()
    private val threads = mutableListOf<Thread>()

    @AfterEach
    fun close() {
        threads.forEach(Thread::interrupt)
        app.close()
        site.close()
    }

    @Test
    @DisplayName("Dado uma conexão meia-aberta que para de entregar, quando passa o limite sem linha, então reconecta e reenvia o gravado")
    fun run_conexaoMuda_deveReconectarEReenviarOGravado() {
        val token = site.createToken()
        val http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build()
        val output = CopyOnWriteArrayList<String>()
        val listening = CountDownLatch(1)
        val listener =
            Listener(
                AnzolServer(site.base, http),
                TokenId(token),
                Deliveries(Forwarder(app.url, http), TokenId(token), Chaos()) { output += it },
                cursor = 0,
                idleLimit = Duration.ofSeconds(1),
            ) { output += it }
        threads += Thread.ofVirtual().start { listener.run { listening.countDown() } }
        await().atMost(Duration.ofSeconds(5)).until { listening.count == 0L }

        site.store(message(token, target = "/muda"))

        await().atMost(Duration.ofSeconds(10)).until { app.received.isNotEmpty() }
        assertThat(app.received.map { it.path }).containsExactly("/muda")
        assertThat(output).contains("Reconnected; forwarding 1 missed request(s)")
    }

    @Test
    @DisplayName("Dado uma entrega mais longa que o limite (atraso do caos), quando termina, então a conexão viva não é dada como muda")
    fun run_entregaLonga_naoDeveReconectar() {
        val token = site.createToken()
        val http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build()
        val output = CopyOnWriteArrayList<String>()
        val listening = CountDownLatch(1)
        val slow = Chaos(delay = 2500L..2500L)
        val listener =
            Listener(
                AnzolServer(site.base, http),
                TokenId(token),
                Deliveries(Forwarder(app.url, http), TokenId(token), slow) { output += it },
                cursor = 0,
                idleLimit = Duration.ofSeconds(1),
            ) { output += it }
        threads += Thread.ofVirtual().start { listener.run { listening.countDown() } }
        await().atMost(Duration.ofSeconds(5)).until { listening.count == 0L }

        site.publish(message(token, target = "/lenta"))
        await().atMost(Duration.ofSeconds(10)).until { app.received.isNotEmpty() }
        site.publish(message(token, target = "/seguinte"))

        await().atMost(Duration.ofSeconds(10)).until { app.received.size == 2 }
        assertThat(app.received.map { it.path }).containsExactly("/lenta", "/seguinte")
        assertThat(output).noneMatch { it.startsWith("Reconnected") }
    }
}
