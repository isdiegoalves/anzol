package site.webhook.capture

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import site.webhook.TokenId
import java.util.UUID
import java.util.concurrent.Executors

@DisplayName("Vagas de conexões presas por URL e no servidor")
class HeldConnectionsTest {
    private val held = HeldConnections(FaultProperties())

    private fun url() = TokenId(UUID.randomUUID())

    @Test
    @DisplayName("Dado 16 vagas ocupadas numa URL, quando pede a 17ª, então é recusada pela URL e outra URL ainda tem vaga")
    fun reserve_17aNaMesmaUrl_deveRecusarPelaUrl() {
        val cheia = url()
        repeat(MAX_HELD_PER_URL) { assertThat(held.reserve(cheia).refused).isNull() }

        assertThat(held.reserve(cheia).refused).isEqualTo(HoldLimit.URL)
        assertThat(held.reserve(url()).refused).isNull()
        assertThat(held.held()).isEqualTo(MAX_HELD_PER_URL + 1)
    }

    @Test
    @DisplayName("Dado 128 vagas ocupadas no servidor, quando pede outra, então é recusada pelo servidor; com a URL também cheia, pela URL")
    fun reserve_servidorCheio_deveRecusarPeloServidor() {
        val cheia = url()
        repeat(MAX_HELD_PER_URL) { held.reserve(cheia) }
        repeat((MAX_HELD - MAX_HELD_PER_URL) / 8) {
            val outra = url()
            repeat(8) { held.reserve(outra) }
        }

        assertThat(held.held()).isEqualTo(MAX_HELD)
        assertThat(held.reserve(url()).refused).isEqualTo(HoldLimit.SERVER)
        assertThat(held.reserve(cheia).refused).isEqualTo(HoldLimit.URL)
        assertThat(held.held()).isEqualTo(MAX_HELD)
    }

    @Test
    @DisplayName("Dado uma vaga reservada, quando fecha, então ela volta; fechar a recusada não devolve nada")
    fun close_vaga_deveDevolverSoAReservada() {
        val cheia = url()
        val slots = List(MAX_HELD_PER_URL) { held.reserve(cheia) }
        val recusada = held.reserve(cheia)

        recusada.close()
        assertThat(held.held()).isEqualTo(MAX_HELD_PER_URL)
        slots.first().close()

        assertThat(held.held()).isEqualTo(MAX_HELD_PER_URL - 1)
        assertThat(held.reserve(cheia).refused).isNull()
    }

    @Test
    @DisplayName("Dado 1000 pedidos ao mesmo tempo em 50 URLs, quando reservam, então exatamente 128 conseguem, no máximo 16 por URL")
    fun reserve_concorrente_deveRespeitarOsDoisTetos() {
        val urls = List(50) { url() }

        val granted =
            Executors.newVirtualThreadPerTaskExecutor().use { executor ->
                (0 until 1000)
                    .map { index -> executor.submit<TokenId?> { urls[index % urls.size].takeIf { held.reserve(it).refused == null } } }
                    .mapNotNull { it.get() }
            }

        assertThat(granted).hasSize(MAX_HELD)
        assertThat(granted.groupingBy { it }.eachCount().values).allSatisfy { assertThat(it).isLessThanOrEqualTo(MAX_HELD_PER_URL) }
        assertThat(held.held()).isEqualTo(MAX_HELD)
    }
}
