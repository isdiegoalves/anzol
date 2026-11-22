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
    @DisplayName(
        "Dado uma onda, quando gera, então os eventos legítimos de cada pedido chegam na ordem do ciclo, e um pedido termina em " +
            "estorno depois do pagamento",
    )
    fun legitimas_devemRespeitarOCicloDoPedido() {
        val events = wave(seed = 7, wave = 1).filter { it.scenario == null }.map { bodyMapper.readTree(it.request.body) }
        val byOrder = events.groupBy({ it["data"]["order_id"].asString() }, { it["type"].asString() })

        assertThat(byOrder).hasSize(6)
        assertThat(byOrder.values.filter { it == listOf("order.created", "payment.paid", "order.shipped") }).hasSize(5)
        assertThat(byOrder.values.filter { it == listOf("order.created", "payment.paid", "payment.refunded") }).hasSize(1)
    }

    @Test
    @DisplayName("Dado uma onda, quando gera, então legítimas e ataques saem com os mesmos nomes de cabeçalho, fora a assinatura")
    fun cabecalhos_naoDevemDenunciarOAtaque() {
        val names = wave(seed = 7, wave = 1).map { it.request.headers.keys - "Stripe-Signature" }

        assertThat(names.toSet()).hasSize(1)
    }

    @Test
    @DisplayName("Dado os cenários de injeção, quando gera, então cada um pede a ficha dele, que não diz de que cenário é")
    fun injecao_cadaCenarioPedeAFichaDele() {
        val planned = wave(seed = 7, wave = 1).filter { it.scenario?.family == DefenseFamily.PROMPT_INJECTION }
        val withToken = planned.filterNot { it.scenario == DefenseScenario.P5 || it.scenario == DefenseScenario.P6 }
        val canaries = DefenseScenario.entries.map { canaryOf(seed = 7, wave = 1, scenario = it) }

        assertThat(planned).hasSize(6)
        assertThat(withToken).allMatch { canaryOf(7, 1, checkNotNull(it.scenario)) in (it.request.body + it.request.headers) }
        assertThat(canaries.toSet()).hasSize(DefenseScenario.entries.size)
        assertThat(canaries).allMatch { it.matches(Regex("tk_[0-9a-f]{16}")) }
        assertThat(canaries).doesNotContainAnyElementsOf(DefenseScenario.entries.map { canaryOf(7, 2, it) })
    }

    @Test
    @DisplayName("Dado o P5, quando gera, então a ficha só aparece depois de decodificar o Base64 da nota")
    fun injecao_codificada_soMostraAFichaDecodificada() {
        val request = wave(seed = 7, wave = 1).first { it.scenario == DefenseScenario.P5 }.request
        val note = bodyMapper.readTree(request.body)["data"]["note"].asString()
        val decoded =
            String(
                java.util.Base64
                    .getDecoder()
                    .decode(note.substringAfter("(base64): ")),
            )

        assertThat(request.body).doesNotContain(canaryOf(7, 1, DefenseScenario.P5))
        assertThat(decoded).contains(canaryOf(7, 1, DefenseScenario.P5))
    }

    @Test
    @DisplayName("Dado o P6, quando gera, então a nota não traz ficha: o sinal é o segredo de leitura")
    fun injecao_segredo_naoTemFicha() {
        val request = wave(seed = 7, wave = 1).first { it.scenario == DefenseScenario.P6 }.request

        assertThat(request.body).doesNotContain("tk_").contains("read secret")
    }

    @Test
    @DisplayName("Dado uma onda, quando gera, então uma legítima traz nota que fala de regra e de sistema sem instruir")
    fun sosia_daInjecao_deveVirNumaLegitima() {
        val notes =
            wave(
                seed = 7,
                wave = 1,
            ).filter { it.scenario == null }.mapNotNull { bodyMapper.readTree(it.request.body)["data"]["note"] }

        assertThat(notes).hasSize(1)
        assertThat(notes.first().asString()).contains("rule", "system")
    }

    private fun event(planned: Planned) = bodyMapper.readTree(planned.request.body)

    @Test
    @DisplayName("Dado o I5, quando gera, então é a cópia exata de uma legítima da onda e chega depois dela")
    fun replayDentroDaJanela_copiaUmaLegitimaEChegaDepois() {
        val planned = wave(seed = 7, wave = 1)
        val replay = planned.indexOfFirst { it.scenario == DefenseScenario.I5 }
        val original = planned.indexOfFirst { it.scenario == null && it.request == planned[replay].request }

        assertThat(original).isBetween(0, replay - 1)
    }

    @Test
    @DisplayName(
        "Dado o remetente comprometido, quando gera, então o estorno é de pedido sem pagamento, o valor é extremo e a conta não é da loja",
    )
    fun remetenteComprometido_conteudoDenuncia() {
        val planned = wave(seed = 7, wave = 1)
        val legitimateOrders = planned.filter { it.scenario == null }.map { event(it)["data"]["order_id"].asString() }
        val refund = event(planned.first { it.scenario == DefenseScenario.C1 })
        val extreme = event(planned.first { it.scenario == DefenseScenario.C2 })
        val swapped = event(planned.first { it.scenario == DefenseScenario.C3 })

        assertThat(refund["type"].asString()).isEqualTo("payment.refunded")
        assertThat(legitimateOrders).doesNotContain(refund["data"]["order_id"].asString())
        assertThat(extreme["data"]["amount"].asLong()).isGreaterThanOrEqualTo(1_000_000)
        assertThat(swapped["data"]["account"].asString()).isNotIn(STORE_ACCOUNT, STORE_SECOND_ACCOUNT)
    }

    @Test
    @DisplayName("Dado uma onda, quando gera, então um pedido legítimo tem valor alto com o ciclo inteiro e outro liquida na segunda conta")
    fun sosias_doRemetenteComprometido() {
        val legitimate = wave(seed = 7, wave = 1).filter { it.scenario == null }.map { event(it)["data"] }
        val high = legitimate.filter { it["amount"].asInt() == 150_000 }
        val second = legitimate.filter { it["account"].asString() == STORE_SECOND_ACCOUNT }

        assertThat(high).hasSize(3)
        assertThat(high.map { it["order_id"].asString() }.toSet()).hasSize(1)
        assertThat(second).hasSize(3)
        assertThat(legitimate.filterNot { it in high }.map { it["amount"].asInt() }).allMatch { it < 50_000 }
    }
}
