package anzol.defense.lab

import anzol.rules.bodyMapper
import anzol.signature.Secret
import anzol.signature.SignatureConfig
import anzol.signature.SignatureProvider
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Instant

private val NOW: Instant = Instant.parse("2026-11-22T12:00:00Z")
private val SIGNATURE = SignatureConfig(SignatureProvider.Stripe(DEFENSE_TOLERANCE_SECONDS), Secret("segredo-do-laboratorio"))

@DisplayName("Vetores do laboratório de defesa")
class DefenseVectorsTest {
    private fun wave(
        seed: Long,
        wave: Int,
    ): List<Planned> = DefenseVectors(SIGNATURE, NOW, seed, wave).wave()

    @Test
    @DisplayName("Dado a mesma semente e a mesma onda, quando gera duas vezes, então saem os mesmos vetores, na mesma ordem")
    fun mesmaSemente_deveRepetirOsVetores() {
        assertThat(wave(seed = 7, wave = 1)).isEqualTo(wave(seed = 7, wave = 1))
    }

    @Test
    @DisplayName("Dado outra semente ou outra onda, quando gera, então os corpos mudam")
    fun outraSementeOuOnda_deveMudarOsVetores() {
        val bodies = wave(seed = 7, wave = 1).map { it.request.body }

        assertThat(wave(seed = 8, wave = 1).map { it.request.body }).doesNotContainAnyElementsOf(bodies)
        assertThat(wave(seed = 7, wave = 2).map { it.request.body }).doesNotContainAnyElementsOf(bodies)
    }

    @Test
    @DisplayName("Dado uma onda, quando gera, então traz 18 legítimas e um ataque por cenário do catálogo")
    fun onda_deveTrazerLegitimasEUmAtaquePorCenario() {
        val planned = wave(seed = 7, wave = 1)

        assertThat(planned.filter { it.scenario == null }).hasSize(18)
        assertThat(planned.mapNotNull { it.scenario }).containsExactlyInAnyOrderElementsOf(DefenseScenario.entries)
    }

    @Test
    @DisplayName("Dado uma onda, quando gera, então os eventos legítimos de cada pedido chegam na ordem do ciclo")
    fun legitimas_devemRespeitarOCicloDoPedido() {
        val events = wave(seed = 7, wave = 1).filter { it.scenario == null }.map { bodyMapper.readTree(it.request.body) }
        val byOrder = events.groupBy({ it["data"]["order_id"].asString() }, { it["type"].asString() })

        assertThat(byOrder).hasSize(6)
        assertThat(byOrder.values).allMatch { it == listOf("order.created", "payment.paid", "order.shipped") }
    }

    @Test
    @DisplayName("Dado uma onda, quando gera, então legítimas e ataques saem com os mesmos cabeçalhos, fora a assinatura")
    fun cabecalhos_naoDevemDenunciarOAtaque() {
        val headers = wave(seed = 7, wave = 1).map { it.request.headers - "Stripe-Signature" }

        assertThat(headers.toSet()).hasSize(1)
    }
}
