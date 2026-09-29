package anzol.outbound

import anzol.rules.Parsed
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource

private const val URL = "http://127.0.0.1:9/"

private fun replay(
    extra: String,
    hasBody: Boolean = true,
): Parsed<ReplayInput> = parseReplay("""{"url":"$URL"$extra}""", hasBody)

private fun Parsed<ReplayInput>.chaos(): Chaos? = (this as Parsed.Valid).value.chaos

private fun Parsed<ReplayInput>.errors(): Map<String, List<String>> = (this as Parsed.Invalid).errors

@DisplayName("Leitura do chaos do replay")
class ChaosInputTest {
    @Test
    @DisplayName("Dado um replay sem chaos, ou com chaos null, quando lê, então não há caos")
    fun semChaos_naoDeveTerCaos() {
        assertThat(replay("").chaos()).isNull()
        assertThat(replay(""","chaos":null""").chaos()).isNull()
    }

    @Test
    @DisplayName("Dado chaos vazio, ou com as chaves em null, quando lê, então vale o caos com os padrões")
    fun chaosVazio_deveTerOsPadroes() {
        val nulls = ""","chaos":{"delay_ms":null,"duplicate":null,"abort_mid_body":null,"slow_body_bps":null,"timeout_ms":null}"""

        assertThat(replay(""","chaos":{}""").chaos()).isEqualTo(Chaos())
        assertThat(replay(nulls).chaos()).isEqualTo(Chaos())
        assertThat(Chaos()).isEqualTo(Chaos(delayMs = 0, duplicate = false, abortMidBody = false, slowBodyBps = null, timeoutMs = null))
    }

    @Test
    @DisplayName("Dado chaos com os cinco campos nos limites, quando lê, então guarda cada um")
    fun chaosCompleto_deveGuardarOsCampos() {
        val chaos =
            ""","timeout":30000,"chaos":{"delay_ms":30000,"duplicate":true,"abort_mid_body":true,""" +
                """"slow_body_bps":1048576,"timeout_ms":29999}"""

        assertThat(replay(chaos).chaos())
            .isEqualTo(Chaos(delayMs = 30_000, duplicate = true, abortMidBody = true, slowBodyBps = 1_048_576, timeoutMs = 29_999))
        assertThat(replay(""","chaos":{"slow_body_bps":1,"timeout_ms":1}""").chaos())
            .isEqualTo(Chaos(slowBodyBps = 1, timeoutMs = 1))
    }

    @ParameterizedTest(name = "{0} → {1}")
    @DisplayName("Dada uma entrada inválida no chaos, quando lê, então 422 só na chave dela, com a mensagem do contrato")
    @CsvSource(
        delimiter = '|',
        textBlock = """
        "chaos":"x"                           | chaos                | The chaos must be an object.
        "chaos":1                             | chaos                | The chaos must be an object.
        "chaos":[]                            | chaos                | The chaos must be an object.
        "chaos":true                          | chaos                | The chaos must be an object.
        "chaos":{"delay_ms":-1}               | chaos.delay_ms       | The delay ms must be between 0 and 30000.
        "chaos":{"delay_ms":30001}            | chaos.delay_ms       | The delay ms must be between 0 and 30000.
        "chaos":{"delay_ms":1.5}              | chaos.delay_ms       | The delay ms must be an integer.
        "chaos":{"delay_ms":"10"}             | chaos.delay_ms       | The delay ms must be an integer.
        "chaos":{"delay_ms":true}             | chaos.delay_ms       | The delay ms must be an integer.
        "chaos":{"duplicate":"sim"}           | chaos.duplicate      | The duplicate field must be true or false.
        "chaos":{"duplicate":1}               | chaos.duplicate      | The duplicate field must be true or false.
        "chaos":{"abort_mid_body":"sim"}      | chaos.abort_mid_body | The abort mid body field must be true or false.
        "chaos":{"slow_body_bps":0}           | chaos.slow_body_bps  | The slow body bps must be between 1 and 1048576.
        "chaos":{"slow_body_bps":1048577}     | chaos.slow_body_bps  | The slow body bps must be between 1 and 1048576.
        "chaos":{"slow_body_bps":"100"}       | chaos.slow_body_bps  | The slow body bps must be an integer.
        "chaos":{"slow_body_bps":1.5}         | chaos.slow_body_bps  | The slow body bps must be an integer.
        "chaos":{"timeout_ms":0}              | chaos.timeout_ms     | The timeout ms must be between 1 and 30000.
        "chaos":{"timeout_ms":30001}          | chaos.timeout_ms     | The timeout ms must be between 1 and 30000.
        "chaos":{"timeout_ms":"500"}          | chaos.timeout_ms     | The timeout ms must be an integer.
        "timeout":5000,"chaos":{"timeout_ms":5000} | chaos.timeout_ms | The timeout ms must be less than the timeout.
        "chaos":{"timeout_ms":10000}          | chaos.timeout_ms     | The timeout ms must be less than the timeout.
        "chaos":{"drop":10}                   | chaos.drop           | The drop option is not supported.
        "chaos":{"reorder":null}              | chaos.reorder        | The reorder option is not supported.""",
    )
    fun chaosInvalido_deveResponder422(
        extra: String,
        key: String,
        message: String,
    ) {
        assertThat(replay(",$extra").errors()).isEqualTo(mapOf(key to listOf(message)))
    }

    @Test
    @DisplayName("Dada uma mensagem sem corpo, quando pede abort_mid_body, então 422; sem o corte, o chaos vale")
    fun corteSemCorpo_deveResponder422() {
        assertThat(replay(""","chaos":{"abort_mid_body":true}""", hasBody = false).errors())
            .isEqualTo(mapOf("chaos.abort_mid_body" to listOf("The abort mid body field requires a request body.")))
        assertThat(replay(""","chaos":{"abort_mid_body":false,"duplicate":true}""", hasBody = false).chaos())
            .isEqualTo(Chaos(duplicate = true))
    }

    @Test
    @DisplayName("Dado um timeout inválido, quando o chaos traz timeout_ms, então só o timeout reclama")
    fun timeoutInvalido_naoDeveCompararComOTimeoutMs() {
        assertThat(replay(""","timeout":999,"chaos":{"timeout_ms":5000}""").errors().keys).containsExactly("timeout")
    }
}
