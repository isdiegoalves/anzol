package site.webhook.legacy

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.MethodSource
import java.math.BigInteger

@DisplayName("Valores do PHP")
class PhpValuesTest {
    @Nested
    @DisplayName("phpIntval")
    inner class Intval {
        @ParameterizedTest(name = "(int) {0} = {1}")
        @DisplayName("Dado um valor, quando é convertido com (int), então segue o PHP 7")
        @MethodSource("site.webhook.legacy.PhpValuesTest#intvalCases")
        fun phpIntval_valorQualquer_deveSeguirOPhp(
            value: Any?,
            expected: Long,
        ) {
            assertThat(phpIntval(value)).isEqualTo(expected)
        }
    }

    @Nested
    @DisplayName("isPhpInteger")
    inner class FilterValidateInt {
        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado um valor, quando passa pela regra integer, então aceita como o filter_var")
        @MethodSource("site.webhook.legacy.PhpValuesTest#integerCases")
        fun isPhpInteger_valorQualquer_deveSeguirOFilterVar(
            value: Any?,
            expected: Boolean,
        ) {
            assertThat(isPhpInteger(value)).isEqualTo(expected)
        }
    }

    @Nested
    @DisplayName("phpPagePositions")
    inner class ForPage {
        @ParameterizedTest(name = "page={0} per_page={1} → {2}")
        @DisplayName("Dado 13 itens, quando pagina como o Collection::forPage, então pega as posições do array_slice do PHP")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            1   | 3  | 0,1,2
            2   | 3  | 3,4,5
            5   | 3  | 12
            6   | 3  | ''
            100 | 2  | ''
            0   | 50 | 0,1,2,3,4,5,6,7,8,9,10,11,12
            -1  | 2  | 9,10
            1   | 0  | ''
            1   | -2 | 0,1,2,3,4,5,6,7,8,9,10""",
        )
        fun phpPagePositions_bordasMedidasNoLegado_deveRepetirArraySlice(
            page: Long,
            perPage: Long,
            expected: String,
        ) {
            assertThat(phpPagePositions(count = 13, page = page, perPage = perPage).joinToString(",")).isEqualTo(expected)
        }
    }

    companion object {
        @JvmStatic
        fun intvalCases(): List<Arguments> =
            listOf(
                Arguments.of(null, 0L),
                Arguments.of("", 0L),
                Arguments.of("abc", 0L),
                Arguments.of(" 12abc", 12L),
                Arguments.of("201abc", 201L),
                Arguments.of("+201", 201L),
                Arguments.of("1e3", 1000L),
                Arguments.of("5.9", 5L),
                Arguments.of(true, 1L),
                Arguments.of(false, 0L),
                Arguments.of(7.9, 7L),
                Arguments.of(listOf("x"), 1L),
                Arguments.of(emptyMap<String, String>(), 0L),
            )

        @JvmStatic
        fun integerCases(): List<Arguments> =
            listOf(
                Arguments.of(5, true),
                Arguments.of("10", true),
                Arguments.of(" 5 ", true),
                Arguments.of("-0", true),
                Arguments.of("010", false),
                Arguments.of("5.5", false),
                Arguments.of(5.5, false),
                Arguments.of(10.0, true),
                Arguments.of(true, true),
                Arguments.of(false, false),
                Arguments.of(null, false),
                Arguments.of("abc", false),
                Arguments.of(listOf(1), false),
                Arguments.of(Long.MAX_VALUE, true),
                Arguments.of(BigInteger("9223372036854775808"), false),
                Arguments.of(BigInteger("-99999999999999999999"), false),
            )
    }
}
