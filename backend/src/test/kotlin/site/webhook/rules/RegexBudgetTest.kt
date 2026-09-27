package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Assertions.assertTimeoutPreemptively
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.function.ThrowingSupplier
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import site.webhook.schema.SchemaConfig
import site.webhook.schema.SchemaError
import site.webhook.schema.SchemaResult
import site.webhook.schema.validate
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode
import java.time.Duration

private val mapper = JsonMapper.builder().build()

/** Exponencial no JDK 25: com 27 `a` e um `!`, alguns segundos sem teto (dobra a cada `a`). */
private const val EXPONENTIAL = "((a+)*)+$"
private val SLOW_EXPONENTIAL = "a".repeat(27) + "!"

/** Para a polinomial de grau 12 `(.*a){12}`: com 40 `a` e um `!`, minutos sem teto. */
private val SLOW_POLYNOMIAL = "a".repeat(40) + "!"

/** Uma avaliação para em torno de 100 ms; a folga cobre a máquina carregada. */
private val WITHIN: Duration = Duration.ofMillis(1_500)

/** Vinte avaliações repetidas de um padrão já estourado: sem memória levariam 2 s. */
private val REPEATED_WITHIN: Duration = Duration.ofMillis(500)

private fun matching(match: String): Rule =
    when (val parsed = parseRule(mapper.readTree("""{"name":"r","match":$match}"""))) {
        is Parsed.Valid -> parsed.value
        is Parsed.Invalid -> error("regra inválida no teste: ${parsed.errors}")
    }

private fun <T> fast(block: () -> T): T = assertTimeoutPreemptively(WITHIN, ThrowingSupplier { block() })

@DisplayName("Teto de custo das regex (ReDoS)")
class RegexBudgetTest {
    @Test
    @DisplayName(
        "Dado um padrão que já estourou o teto dentro da mesma requisição, quando avalia de novo, então é timed out na hora, " +
            "sem executar; fora dela, executa de novo",
    )
    fun evaluate_padraoQueJaEstourou_deveSerTimedOutNaHora() {
        val pattern = conditionRegex(EXPONENTIAL).toPattern()

        var repeatedTook = Duration.ZERO
        val (first, repeated) =
            withRegexMemo {
                val first = pattern.evaluate(SLOW_EXPONENTIAL)
                val from = System.nanoTime()
                val repeated = List(20) { pattern.evaluate(SLOW_EXPONENTIAL + it) }
                repeatedTook = Duration.ofNanos(System.nanoTime() - from)
                first to repeated
            }
        val started = System.nanoTime()
        val outside = pattern.evaluate(SLOW_EXPONENTIAL)

        assertThat(first).isEqualTo(RegexOutcome.TIMED_OUT)
        assertThat(repeated).containsOnly(RegexOutcome.TIMED_OUT)
        assertThat(repeatedTook).isLessThan(REPEATED_WITHIN)
        assertThat(outside).isEqualTo(RegexOutcome.TIMED_OUT)
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isGreaterThanOrEqualTo(MAX_REGEX_TIME)
        assertThat(withRegexMemo { pattern.evaluate("aaaa") }).isEqualTo(RegexOutcome.MATCHED)
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado uma regex catastrófica em cada alvo, quando avalia, então para no teto e a frase diz que estourou")
    @CsvSource(
        delimiter = '|',
        textBlock = """
        {"path":{"regex":"/((a+)*)+$"}}               | path: expected to match "/((a+)*)+$", regex timed out
        {"query":{"q":{"regex":"((a+)*)+$"}}}         | query q: expected to match "((a+)*)+$", regex timed out
        {"headers":{"X-A":{"regex":"((a+)*)+$"}}}     | header x-a: expected to match "((a+)*)+$", regex timed out
        {"body":[{"regex":"(.*a){12}"}]}              | body: expected to match "(.*a){12}", regex timed out""",
    )
    fun failures_regexCatastrofica_deveEstourarNoTeto(
        match: String,
        phrase: String,
    ) {
        val input =
            MatchInput(
                method = "GET",
                path = "/$SLOW_EXPONENTIAL",
                query = mapOf("q" to SLOW_EXPONENTIAL),
                headers = mapOf("x-a" to SLOW_EXPONENTIAL),
                body = SLOW_POLYNOMIAL,
            )

        val failures = fast { matching(match).failures(input) }

        assertThat(failures.map { it.phrase }).containsExactly(phrase)
    }

    @Test
    @DisplayName("Dado a mesma regex com um valor comum, quando avalia, então casa ou falha como sempre")
    fun failures_valorComum_deveSeguirComoSempre() {
        val rule = matching("""{"query":{"q":{"regex":"$EXPONENTIAL"}}}""")

        val casou = rule.failures(MatchInput("GET", "/", mapOf("q" to "aaaa"), emptyMap(), ""))
        val falhou = rule.failures(MatchInput("GET", "/", mapOf("q" to "b"), emptyMap(), ""))

        assertThat(casou).isEmpty()
        assertThat(falhou.map { it.phrase }).containsExactly("query q: expected to match \"$EXPONENTIAL\", got \"b\"")
    }

    @Test
    @DisplayName("Dado um pattern catastrófico no JSON Schema, quando valida, então para no teto com o erro no caminho da instância")
    fun schema_patternCatastrofico_deveEstourarNoCaminho() {
        val schema =
            SchemaConfig(
                mapper.readTree(
                    """{"type":"object","properties":{"nome":{"type":"string","pattern":"^$EXPONENTIAL"},"ok":{"type":"integer"}}}""",
                ) as ObjectNode,
            )

        val slow = fast { schema.validate("""{"nome":"$SLOW_EXPONENTIAL","ok":1}""") }
        val common = schema.validate("""{"nome":"aaaa","ok":1}""")

        assertThat(slow).isEqualTo(SchemaResult(valid = false, errors = listOf(SchemaError("/nome", "pattern evaluation timed out"))))
        assertThat(common).isEqualTo(SchemaResult(valid = true, errors = emptyList()))
    }
}
