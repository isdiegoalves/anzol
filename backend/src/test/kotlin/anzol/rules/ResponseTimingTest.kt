package anzol.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import java.math.BigDecimal

private const val SAMPLES = 2_000

@DisplayName("Atraso e dribble das respostas de regra")
class ResponseTimingTest {
    @Nested
    @DisplayName("Delay.millis")
    inner class Millis {
        @Test
        @DisplayName("Dado um atraso fixo, quando sorteia, então é sempre o valor")
        fun millis_fixo_deveSerOValor() {
            assertThat((1..SAMPLES).map { Delay.Fixed(250).millis() }.toSet()).containsExactly(250L)
        }

        @Test
        @DisplayName("Dado um atraso uniforme, quando sorteia muitas vezes, então fica no intervalo e alcança as duas pontas")
        fun millis_uniforme_deveFicarNoIntervaloFechado() {
            val samples = (1..SAMPLES).map { Delay.Uniform(10, 13).millis() }.toSet()

            assertThat(samples).containsExactlyInAnyOrder(10L, 11L, 12L, 13L)
        }

        @Test
        @DisplayName("Dado log-normal com sigma 0, quando sorteia, então é a mediana")
        fun millis_logNormalSemDispersao_deveSerAMediana() {
            assertThat(Delay.LogNormal(BigDecimal("400"), BigDecimal.ZERO).millis()).isEqualTo(400L)
        }

        @Test
        @DisplayName("Dado log-normal, quando sorteia muitas vezes, então metade fica abaixo da mediana, aproximadamente")
        fun millis_logNormal_deveTerAMedianaPedida() {
            val below = (1..SAMPLES).count { Delay.LogNormal(BigDecimal("1000"), BigDecimal("0.5")).millis() < 1000 }

            assertThat(below).isBetween(SAMPLES * 4 / 10, SAMPLES * 6 / 10)
        }

        @Test
        @DisplayName("Dado log-normal com cauda longa, quando sorteia, então nunca passa de 60 s")
        fun millis_logNormalCaudaLonga_deveCortarEm60s() {
            val samples = (1..SAMPLES).map { Delay.LogNormal(BigDecimal("50000"), BigDecimal("10")).millis() }

            assertThat(samples.max()).isEqualTo(60_000L)
            assertThat(samples).allSatisfy { assertThat(it).isBetween(0L, 60_000L) }
        }
    }

    @Nested
    @DisplayName("dribblePieces")
    inner class Pieces {
        @ParameterizedTest(name = "\"{0}\" em {1} → {2}")
        @DisplayName("Dado um corpo e o número de pedaços, quando divide, então os pedaços (_ = vazio) quase iguais remontam o corpo")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            AAAABBBBCCCC | 3 | AAAA,BBBB,CCCC
            abcdefg      | 3 | abc,de,fg
            ab           | 4 | a,b,_,_
            ''           | 2 | _,_
            tudo         | 1 | tudo""",
        )
        fun dribblePieces_corpo_deveDividirEmPartesQuaseIguais(
            body: String,
            chunks: Int,
            expected: String,
        ) {
            val pieces = dribblePieces(body.toByteArray(), chunks).map { String(it) }

            assertThat(pieces).isEqualTo(expected.split(',').map { if (it == "_") "" else it })
        }
    }
}
