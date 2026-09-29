package anzol.token

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import java.math.BigInteger

@DisplayName("RetryAfter")
class RetryAfterTest {
    @Nested
    @DisplayName("parse")
    inner class Parse {
        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado segundos em string de dígitos, quando lê, então vira Seconds com o inteiro")
        @CsvSource("0, 0", "120, 120", "007, 7", "9223372036854775807, 9223372036854775807")
        fun parse_stringDeDigitos_deveVirarSeconds(
            input: String,
            expected: Long,
        ) {
            assertThat(RetryAfter.parse(input)).isEqualTo(RetryAfter.Seconds(expected))
        }

        @Test
        @DisplayName("Dado segundos como número JSON (Int, Long, BigInteger em 64 bits), quando lê, então vira Seconds")
        fun parse_numeroInteiro_deveVirarSeconds() {
            assertThat(RetryAfter.parse(120)).isEqualTo(RetryAfter.Seconds(120))
            assertThat(RetryAfter.parse(5_000_000_000L)).isEqualTo(RetryAfter.Seconds(5_000_000_000L))
            assertThat(RetryAfter.parse(BigInteger.valueOf(3))).isEqualTo(RetryAfter.Seconds(3))
        }

        @Test
        @DisplayName("Dado uma IMF-fixdate válida, quando lê, então vira HttpDate com a string como veio")
        fun parse_imfFixdate_deveVirarHttpDate() {
            assertThat(RetryAfter.parse("Sun, 06 Nov 1994 08:49:37 GMT")).isEqualTo(RetryAfter.HttpDate("Sun, 06 Nov 1994 08:49:37 GMT"))
            assertThat(RetryAfter.parse("Thu, 29 Feb 2024 23:59:59 GMT")).isEqualTo(RetryAfter.HttpDate("Thu, 29 Feb 2024 23:59:59 GMT"))
        }

        @ParameterizedTest(name = "[{0}]")
        @DisplayName("Dado um valor que não é segundos nem IMF-fixdate, quando lê, então recusa")
        @ValueSource(
            strings = [
                "abc", "-1", "+1", "1.5", " 120", "120 ", "1e3", "99999999999999999999",
                "Mon, 06 Nov 1994 08:49:37 GMT", "Tue, 31 Feb 1994 08:49:37 GMT", "Sun, 6 Nov 1994 08:49:37 GMT",
                "Sunday, 06-Nov-94 08:49:37 GMT", "Sun Nov  6 08:49:37 1994", "Sun, 06 Nov 1994 08:49:37 UTC",
                "sun, 06 nov 1994 08:49:37 GMT", "Sun, 06 Nov 1994 24:00:00 GMT", "Sun, 06 Nov 1994 08:49:37 GMT ",
            ],
        )
        fun parse_textoInvalido_deveRecusar(input: String) {
            assertThat(RetryAfter.parse(input)).isNull()
        }

        @Test
        @DisplayName("Dado número negativo, fracionário, fora de 64 bits, booleano ou coleção, quando lê, então recusa")
        fun parse_tipoInvalido_deveRecusar() {
            val invalid = listOf(-1, 1.5, 2.0, BigInteger("9223372036854775808"), true, listOf(1), mapOf("a" to 1), null)

            assertThat(invalid.map { RetryAfter.parse(it) }).containsOnlyNulls()
        }
    }

    @Nested
    @DisplayName("headerValue")
    inner class HeaderValue {
        @Test
        @DisplayName("Dado segundos ou data, quando monta o cabeçalho, então usa o inteiro ou a data como veio")
        fun headerValue_segundosOuData_deveUsarOValor() {
            assertThat(RetryAfter.Seconds(120).headerValue()).isEqualTo("120")
            assertThat(RetryAfter.HttpDate("Sun, 06 Nov 1994 08:49:37 GMT").headerValue()).isEqualTo("Sun, 06 Nov 1994 08:49:37 GMT")
        }
    }
}
