package site.webhook.cli

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import java.time.Duration
import java.time.Instant
import java.util.SplittableRandom

@DisplayName("Caos das entregas")
class ChaosTest {
    @Nested
    @DisplayName("Leitura das opções")
    inner class Parsing {
        @ParameterizedTest(name = "{0} -> {1}")
        @CsvSource("0,0.0", "20,20.0", "12.5,12.5", "100,100.0", "35%,35.0")
        @DisplayName("Dado uma porcentagem de 0 a 100, com ou sem %, quando lê, então guarda o número")
        fun parsePercent_valida_deveLerONumero(
            text: String,
            expected: Double,
        ) {
            assertThat(parsePercent(text)).isEqualTo(Percent(expected))
        }

        @ParameterizedTest(name = "\"{0}\"")
        @ValueSource(strings = ["101", "-1", "abc", "", "NaN", "20%%"])
        @DisplayName("Dado uma porcentagem fora de 0 a 100 ou que não é número, quando lê, então recusa")
        fun parsePercent_invalida_deveRecusar(text: String) {
            assertThat(parsePercent(text)).isNull()
        }

        @ParameterizedTest(name = "{0} -> {1} ms")
        @CsvSource("0,0", "500,500", "500ms,500", "2s,2000", "1.5s,1500", "0.25s,250")
        @DisplayName("Dado um tempo em ms ou com s, quando lê, então dá os milissegundos")
        fun parseMillis_valido_deveDarMilissegundos(
            text: String,
            expected: Long,
        ) {
            assertThat(parseMillis(text)).isEqualTo(expected)
        }

        @ParameterizedTest(name = "\"{0}\"")
        @ValueSource(strings = ["1.5", "0.0005s", "-1", "5m", "", "s", "1 s", "99999999999999999999"])
        @DisplayName("Dado um tempo sem número inteiro de ms, negativo ou com outra unidade, quando lê, então recusa")
        fun parseMillis_invalido_deveRecusar(text: String) {
            assertThat(parseMillis(text)).isNull()
        }

        @ParameterizedTest(name = "{0} -> {1}..{2}")
        @CsvSource("100..500,100,500", "1s..2s,1000,2000", "300,300,300", "0..0,0,0", "250ms..1s,250,1000")
        @DisplayName("Dado MIN..MAX ou um valor só, quando lê o atraso, então dá a faixa em ms")
        fun parseDelay_valido_deveDarAFaixa(
            text: String,
            min: Long,
            max: Long,
        ) {
            assertThat(parseDelay(text)).isEqualTo(min..max)
        }

        @ParameterizedTest(name = "\"{0}\"")
        @ValueSource(strings = ["500..100", "..5", "5..", "1..2..3", "a..b", ""])
        @DisplayName("Dado MIN maior que MAX, um lado vazio ou três partes, quando lê o atraso, então recusa")
        fun parseDelay_invalido_deveRecusar(text: String) {
            assertThat(parseDelay(text)).isNull()
        }
    }

    @Nested
    @DisplayName("Sorteios")
    inner class Draws {
        private fun fates(
            chaos: Chaos,
            count: Int,
        ): List<Fate> {
            val dice = ChaosDice(chaos.seed)
            return List(count) { chaos.fate(dice.nextMessage()) }
        }

        @Test
        @DisplayName("Dado a mesma semente, quando sorteia a sorte de cada mensagem, então a sequência se repete")
        fun fate_mesmaSemente_deveRepetirASequencia() {
            val chaos = Chaos(drop = Percent(30.0), duplicate = Percent(50.0), seed = 7)

            assertThat(fates(chaos, 40)).isEqualTo(fates(chaos, 40))
        }

        @Test
        @DisplayName("Dado sementes diferentes, quando sorteia, então as sequências diferem")
        fun fate_sementesDiferentes_deveDarSequenciasDiferentes() {
            val chaos = Chaos(duplicate = Percent(50.0), seed = 7)

            assertThat(fates(chaos, 40)).isNotEqualTo(fates(chaos.copy(seed = 8), 40))
        }

        @Test
        @DisplayName("Dado sorteios a mais numa mensagem (retentativas), quando sorteia a seguinte, então ela sai igual")
        fun nextMessage_sorteiosAMaisNaAnterior_naoDeveMudarASeguinte() {
            val chaos = Chaos(drop = Percent(50.0), duplicate = Percent(50.0), seed = 42)
            val calm = ChaosDice(chaos.seed)
            val busy = ChaosDice(chaos.seed)

            calm.nextMessage()
            val retried = busy.nextMessage()
            repeat(25) { retried.nextLong() }

            assertThat(List(20) { chaos.fate(calm.nextMessage()) }).isEqualTo(List(20) { chaos.fate(busy.nextMessage()) })
        }

        @Test
        @DisplayName("Dado 30% de descarte e 60% de duplicata, quando sorteia 4000 mensagens, então cada fração fica a 2 p.p. do pedido")
        fun fate_muitasMensagens_deveAplicarAFracaoPedida() {
            val result = fates(Chaos(drop = Percent(30.0), duplicate = Percent(60.0), seed = 1), 4000)

            assertThat(result.count { it.dropped } / 4000.0).isBetween(0.28, 0.32)
            assertThat(result.count { it.duplicated } / 4000.0).isBetween(0.58, 0.62)
        }

        @Test
        @DisplayName("Dado 0% e 100%, quando sorteia, então nunca e sempre")
        fun drawn_extremos_deveSerNuncaESempre() {
            val dice = SplittableRandom(3)

            assertThat(List(500) { Percent(0.0).drawn(dice) }).containsOnly(false)
            assertThat(List(500) { Percent(100.0).drawn(dice) }).containsOnly(true)
        }
    }

    @Nested
    @DisplayName("Espera antes da retentativa")
    inner class RetryWaits {
        private val now = Instant.parse("2026-09-29T12:00:00Z")

        @ParameterizedTest(name = "tentativa {0}: entre {1} e {2} ms")
        @CsvSource("1,500,1000", "2,1000,2000", "3,2000,4000", "5,8000,16000", "6,15000,30000", "10,15000,30000")
        @DisplayName(
            "Dado a tentativa n sem Retry-After, quando calcula a espera, então fica entre a metade e o teto de 1 s × 2^(n-1), até 30 s",
        )
        fun retryWait_semRetryAfter_deveFicarNaFaixaDoBackoff(
            attempt: Int,
            min: Long,
            max: Long,
        ) {
            val waits = List(300) { seed -> retryWait(attempt, retryAfter = null, now, SplittableRandom(seed.toLong())) }

            assertThat(waits.map { it.delay.toMillis() }).allSatisfy { assertThat(it).isBetween(min, max) }
            assertThat(waits.map { it.delay }.toSet()).hasSizeGreaterThan(50)
            assertThat(waits).allSatisfy { assertThat(it.fromRetryAfter).isFalse() }
        }

        @Test
        @DisplayName("Dado a mesma semente, quando calcula a espera, então o jitter se repete")
        fun retryWait_mesmaSemente_deveRepetirOJitter() {
            val first = List(5) { retryWait(it + 1, retryAfter = null, now, SplittableRandom(9)) }
            val second = List(5) { retryWait(it + 1, retryAfter = null, now, SplittableRandom(9)) }

            assertThat(first).isEqualTo(second)
        }

        @Test
        @DisplayName("Dado Retry-After em segundos, quando calcula a espera, então vale ele, sem jitter")
        fun retryWait_retryAfterEmSegundos_deveUsarOValor() {
            val wait = retryWait(1, RetryAfter.Seconds(3), now, SplittableRandom(1))

            assertThat(wait).isEqualTo(Wait(Duration.ofSeconds(3), fromRetryAfter = true))
        }

        @Test
        @DisplayName("Dado Retry-After acima de 30 s, quando calcula a espera, então fica em 30 s")
        fun retryWait_retryAfterLongo_deveFicarNoTeto() {
            val wait = retryWait(1, RetryAfter.Seconds(120), now, SplittableRandom(1))

            assertThat(wait).isEqualTo(Wait(Duration.ofSeconds(30), fromRetryAfter = true))
        }

        @Test
        @DisplayName("Dado Retry-After numa data já passada, quando calcula a espera, então é zero")
        fun retryWait_retryAfterNoPassado_deveSerZero() {
            val wait = retryWait(2, RetryAfter.HttpDate(now.minusSeconds(5)), now, SplittableRandom(1))

            assertThat(wait).isEqualTo(Wait(Duration.ZERO, fromRetryAfter = true))
        }
    }

    @Nested
    @DisplayName("Embaralhamento das entregas seguras")
    inner class Reorder {
        @ParameterizedTest(name = "leva de {0}")
        @ValueSource(ints = [2, 3, 5, 10])
        @DisplayName("Dado uma leva de 2 ou mais, quando embaralha, então sai uma permutação diferente da ordem de chegada")
        fun shuffledOrder_levaDeDoisOuMais_deveTrocarAOrdem(size: Int) {
            val arrival = List(size) { it }

            repeat(200) { seed ->
                val order = shuffledOrder(size, SplittableRandom(seed.toLong()))
                assertThat(order).containsExactlyInAnyOrderElementsOf(arrival).isNotEqualTo(arrival)
            }
        }

        @Test
        @DisplayName("Dado a mesma semente, quando embaralha, então a ordem se repete")
        fun shuffledOrder_mesmaSemente_deveRepetirAOrdem() {
            assertThat(shuffledOrder(6, SplittableRandom(5))).isEqualTo(shuffledOrder(6, SplittableRandom(5)))
        }

        @Test
        @DisplayName("Dado leva de 3, quando embaralha com várias sementes, então aparecem as 5 ordens diferentes da de chegada")
        fun shuffledOrder_levaDeTres_deveAlcancarTodasAsOutrasOrdens() {
            val orders = List(300) { shuffledOrder(3, SplittableRandom(it.toLong())) }.toSet()

            assertThat(orders).hasSize(5)
        }

        @ParameterizedTest(name = "leva de {0}")
        @ValueSource(ints = [0, 1])
        @DisplayName("Dado leva de 0 ou 1, quando embaralha, então fica como está")
        fun shuffledOrder_levaPequena_deveFicarComoEsta(size: Int) {
            assertThat(shuffledOrder(size, SplittableRandom(1))).isEqualTo(List(size) { it })
        }
    }

    @Nested
    @DisplayName("Resumo")
    inner class Summary {
        @Test
        @DisplayName("Dado nenhuma opção de caos, quando resume, então não há linha")
        fun summary_semCaos_deveSerNulo() {
            assertThat(Chaos(seed = 3).summary()).isNull()
        }

        @Test
        @DisplayName("Dado todas as opções, quando resume, então cita cada uma e a semente")
        fun summary_todasAsOpcoes_deveCitarCadaUmaEASemente() {
            val chaos =
                Chaos(
                    drop = Percent(20.0),
                    duplicate = Percent(12.5),
                    delay = 100L..500L,
                    reorder = 3,
                    abort = Percent(10.0),
                    slow = 64,
                    timeout = Duration.ofMillis(2000),
                    retries = 3,
                    seed = 7,
                )

            assertThat(chaos.summary()).isEqualTo(
                "Chaos: drop 20%, duplicate 12.5%, delay 100..500 ms, reorder 3, abort 10%, slow 64 B/s, timeout 2000 ms, " +
                    "retries 3; seed 7",
            )
        }

        @Test
        @DisplayName("Dado só a duplicata, quando resume, então cita a duplicata e a semente")
        fun summary_soDuplicata_deveCitarADuplicataEASemente() {
            assertThat(Chaos(duplicate = Percent(50.0), seed = 7).summary()).isEqualTo("Chaos: duplicate 50%; seed 7")
        }
    }

    @Nested
    @DisplayName("Gotejamento")
    inner class Dripping {
        @Test
        @DisplayName("Dado 20 B/s, quando goteja, então manda pedaços de 2 bytes a cada 100 ms")
        fun drip_vinteBytesPorSegundo_devePingarDoisBytesACada100Ms() {
            val drip = Drip(20)

            assertThat(drip.chunk).isEqualTo(2)
            assertThat(drip.pause(2)).isEqualTo(Duration.ofMillis(100))
            assertThat(drip.pause(40)).isEqualTo(Duration.ofSeconds(2))
        }

        @Test
        @DisplayName("Dado menos de 10 B/s, quando goteja, então manda 1 byte por vez")
        fun drip_menosDeDezBytesPorSegundo_deveMandarUmBytePorVez() {
            val drip = Drip(4)

            assertThat(drip.chunk).isEqualTo(1)
            assertThat(drip.pause(1)).isEqualTo(Duration.ofMillis(250))
        }

        @Test
        @DisplayName("Dado uma taxa muito alta, quando goteja, então o pedaço tem no máximo 64 KiB")
        fun drip_taxaAlta_deveLimitarOPedaco() {
            assertThat(Drip(1_000_000_000).chunk).isEqualTo(65_536)
        }
    }
}
