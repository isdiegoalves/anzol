package anzol.wait

import anzol.rules.Parsed
import anzol.rules.PathMatcher
import anzol.rules.RuleMatch
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import java.time.Duration

@DisplayName("Leitura e validação do corpo do requests/wait")
class WaitRequestTest {
    private fun valid(body: String): WaitRequest =
        when (val parsed = parseWait(body)) {
            is Parsed.Valid -> parsed.value
            is Parsed.Invalid -> error("esperava válido: ${parsed.errors}")
        }

    private fun errorsOf(body: String): Map<String, List<String>> =
        when (val parsed = parseWait(body)) {
            is Parsed.Valid -> emptyMap()
            is Parsed.Invalid -> parsed.errors
        }

    @ParameterizedTest(name = "[{0}]")
    @DisplayName("Dado um corpo vazio, {} ou campos nulos, quando lê, então vale o padrão: casa tudo, histórico inteiro, 1 mensagem, 30 s")
    @ValueSource(strings = ["", "  ", "{}", """{"match":null,"after":null,"count":null,"timeout":null}"""])
    fun parseWait_semCampos_deveUsarOPadrao(body: String) {
        assertThat(valid(body)).isEqualTo(WaitRequest(RuleMatch(), after = FROM_START, count = 1, timeout = Duration.ofSeconds(30)))
    }

    @Test
    @DisplayName("Dado todos os campos, quando lê, então o match vem do leitor das regras e os números nos limites valem")
    fun parseWait_todosOsCampos_deveLer() {
        val wait = valid("""{"match":{"method":["POST"],"path":{"prefix":"/pag"}},"after":0,"count":100,"timeout":300000}""")

        assertThat(wait.match).isEqualTo(RuleMatch(method = listOf("POST"), path = PathMatcher.Prefix("/pag")))
        assertThat(wait.after).isZero()
        assertThat(wait.count).isEqualTo(100)
        assertThat(wait.timeout).isEqualTo(Duration.ofMinutes(5))
        assertThat(valid("""{"count":1,"timeout":0,"after":9007199254740993}""").after).isEqualTo(9_007_199_254_740_993)
    }

    @Test
    @DisplayName("Dado um match inválido, quando lê, então o erro vem com a chave match.<campo>, como no rules/test")
    fun parseWait_matchInvalido_deveUsarChaveDoMatch() {
        assertThat(errorsOf("""{"match":{"path":{"regex":"("}}}""")).isEqualTo(mapOf("match.path.regex" to listOf("The regex is invalid.")))
        assertThat(errorsOf("""{"match":[]}""")).isEqualTo(mapOf("match" to listOf("The match must be an object.")))
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado um número fora dos limites ou que não é inteiro, quando lê, então recusa na chave do campo")
    @CsvSource(
        delimiter = '|',
        value = [
            """{"count":0}         | count   | The count must be between 1 and 100.""",
            """{"count":101}       | count   | The count must be between 1 and 100.""",
            """{"timeout":-1}      | timeout | The timeout must be between 0 and 300000.""",
            """{"timeout":300001}  | timeout | The timeout must be between 0 and 300000.""",
            """{"after":-1}        | after   | The after must be at least 0.""",
            """{"after":"5"}       | after   | The after must be an integer.""",
            """{"count":1.5}       | count   | The count must be an integer.""",
            """{"timeout":true}    | timeout | The timeout must be an integer.""",
        ],
    )
    fun parseWait_numeroInvalido_deveRecusar(
        body: String,
        key: String,
        message: String,
    ) {
        assertThat(errorsOf(body)).isEqualTo(mapOf(key to listOf(message)))
    }

    @Test
    @DisplayName("Dado vários campos inválidos, quando lê, então junta todos os erros")
    fun parseWait_variosErros_deveJuntar() {
        assertThat(errorsOf("""{"match":{"method":"GET"},"count":0,"timeout":-5}""").keys)
            .containsExactly("match.method", "count", "timeout")
    }

    @ParameterizedTest(name = "[{0}]")
    @DisplayName("Dado um corpo que não é objeto JSON, quando lê, então recusa na chave wait")
    @ValueSource(strings = ["[]", "1", "null", "\"x\"", "{", "não é json"])
    fun parseWait_naoObjeto_deveRecusar(body: String) {
        assertThat(errorsOf(body)).isEqualTo(mapOf("wait" to listOf("The wait must be an object.")))
    }
}
