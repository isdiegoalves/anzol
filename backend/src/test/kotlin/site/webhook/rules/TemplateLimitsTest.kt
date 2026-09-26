package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Assertions.assertTimeoutPreemptively
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.function.ThrowingSupplier
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import java.lang.management.ManagementFactory
import java.time.Duration
import java.time.Instant
import com.sun.management.ThreadMXBean as AllocationMXBean

/** Como os tetos só precisam provar que a renderização para cedo, 2 s é folga larga sobre o teto de 1 s. */
private val FAST = Duration.ofSeconds(2)

/**
 * Alocação (lixo incluído) aceita para produzir 1 MiB de saída em pedaços de 1 KiB ou mais. Materializar
 * um bloco antes de escrever passa disso em várias vezes; o lixo que o Handlebars cria a cada iteração
 * (contexto, dados do `each`) não entra, porque com pedaços grandes a saída estoura em poucas iterações.
 */
private const val MAX_ALLOCATED_BYTES = 64L * 1024 * 1024

/**
 * Requisição com [count] parâmetros de query e [count] cabeçalhos, como um remetente pode mandar; com
 * [size], cada nome e cada valor completa [size] caracteres.
 */
private fun crowded(
    count: Int,
    size: Int = 0,
): TemplateRequest {
    fun padded(text: String) = text.padEnd(size, '.')
    return TemplateRequest(
        method = "POST",
        path = "/",
        url = "/",
        query = (1..count).associate { padded("q$it") to padded("v$it") },
        headers = (1..count).associate { padded("h$it") to padded("v$it") },
        body = "",
    )
}

private fun input(request: TemplateRequest = crowded(1)): TemplateInput = TemplateInput(request, seq = 1, now = Instant.EPOCH)

private fun assertRefused(
    reason: String,
    render: () -> Unit,
) {
    assertThatThrownBy { render() }
        .isInstanceOfSatisfying(ResponseStatusException::class.java) { error ->
            assertThat(error.statusCode).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR)
            assertThat(error.reason).isEqualTo(reason)
        }
}

/**
 * Roda [block] com o prazo [FAST] e devolve os bytes que ele alocou (inclui o que já virou lixo). A conta
 * é feita dentro do bloco: o `assertTimeoutPreemptively` o roda em outra thread, e medir a do teste daria
 * sempre perto de zero.
 */
private fun allocatedWithinFast(block: () -> Unit): Long =
    assertTimeoutPreemptively(
        FAST,
        ThrowingSupplier {
            val bean = ManagementFactory.getThreadMXBean() as AllocationMXBean
            val before = bean.currentThreadAllocatedBytes
            block()
            bean.currentThreadAllocatedBytes - before
        },
    )

@DisplayName("Tetos da renderização do template: tamanho da saída, tempo, math e randomValue")
class TemplateLimitsTest {
    @Nested
    @DisplayName("Teto do corpo renderizado (1 MiB)")
    inner class BodyLimit {
        @Test
        @DisplayName("Dado um template que rende exatamente 1 MiB, quando renderiza, então sai inteiro")
        fun render_exatamenteNoTeto_deveSairInteiro() {
            val template = "a".repeat(MAX_RENDERED_BODY)

            assertThat(renderTemplate(template, input())).hasSize(MAX_RENDERED_BODY)
        }

        @Test
        @DisplayName("Dado um template que rende 1 MiB e um caractere, quando renderiza, então recusa com 500 e a mensagem do teto")
        fun render_umAcimaDoTeto_deveRecusar() {
            val template = "a".repeat(MAX_RENDERED_BODY - 1) + "{{seq}}{{seq}}"

            assertRefused(TEMPLATE_TOO_LARGE) { renderTemplate(template, input()) }
        }

        @Test
        @DisplayName("Dado each sobre milhares de cabeçalhos com randomValue no teto, quando renderiza, então recusa rápido e sem acumular")
        fun render_eachComRandomValueNoTeto_deveRecusarCedo() {
            val template = "{{#each request.headers}}{{randomValue type='HEX' length=10000}}{{/each}}"

            val allocated = allocatedWithinFast { assertRefused(TEMPLATE_TOO_LARGE) { renderTemplate(template, input(crowded(2000))) } }

            assertThat(allocated).isLessThan(MAX_ALLOCATED_BYTES)
        }

        @ParameterizedTest(name = "{0} sobre {1}")
        @DisplayName("Dado blocos aninhados sobre dados do remetente, quando a saída estoura, então para no teto sem materializar")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {{#each request.query}}{{#each ../request.headers}}{{#each ../../request.query}}{{@key}}{{/each}}{{/each}}{{/each}}       | 150
            {{#if seq}}{{#each request.query}}{{#with request}}{{#each ../../request.headers}}{{this}}{{/each}}{{/with}}{{/each}}{{/if}} | 150
            {{#unless x}}{{#each request.query}}{{#each @root.request.query}}{{#each @root.request.query}}{{this}}{{/each}}{{/each}}{{/each}}{{/unless}} | 30
            {{#each request.query}}{{#each @root.request.headers}}{{#each @root.request.headers}}{{@key}}{{/each}}{{/each}}{{/each}} | 150
            {{#each request.query}}{{#each @root.request.query}}{{#each @root.request.query}}{{#each @root.request.query}}{{this}}{{/each}}{{/each}}{{/each}}{{/each}} | 40""",
        )
        fun render_blocosAninhados_devePararNoTeto(
            template: String,
            count: Int,
        ) {
            val request = crowded(count, size = 1024)

            val allocated = allocatedWithinFast { assertRefused(TEMPLATE_TOO_LARGE) { renderTemplate(template, input(request)) } }

            assertThat(allocated).isLessThan(MAX_ALLOCATED_BYTES)
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado blocos aninhados que imprimem pouco a cada volta, quando a saída estoura, então para no teto a tempo")
        @ValueSource(
            strings = [
                "{{#each request.query}}{{#each ../request.headers}}{{#each ../../request.query}}{{@key}}{{/each}}{{/each}}{{/each}}",
                "{{#unless x}}{{#each request.query}}{{#each @root.request.query}}{{#each @root.request.query}}x" +
                    "{{/each}}{{/each}}{{/each}}{{/unless}}",
                "{{#each request.query}}{{#each @root.request.headers}}{{#each @root.request.headers}}{{@index}}" +
                    "{{/each}}{{/each}}{{/each}}",
            ],
        )
        fun render_blocosAninhadosDeSaidaMiuda_devePararNoTeto(template: String) {
            assertTimeoutPreemptively(FAST) { assertRefused(TEMPLATE_TOO_LARGE) { renderTemplate(template, input(crowded(1000))) } }
        }
    }

    @Nested
    @DisplayName("Teto de tempo")
    inner class TimeLimit {
        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado blocos aninhados que giram sem produzir saída, quando renderiza, então para no teto de tempo")
        @ValueSource(
            strings = [
                "{{#each request.query}}{{#each @root.request.query}}{{#each @root.request.query}}{{/each}}{{/each}}{{/each}}",
                "{{#each request.query}}{{#each @root.request.query}}{{#each @root.request.query}}{{nada}}{{@first}}" +
                    "{{/each}}{{/each}}{{/each}}",
                "{{#each request.query}}{{#each @root.request.query}}{{#each @root.request.query}}{{math 'x' '+' 1}}" +
                    "{{/each}}{{/each}}{{/each}}",
            ],
        )
        fun render_semSaida_devePararNoTetoDeTempo(template: String) {
            assertTimeoutPreemptively(FAST) { assertRefused(TEMPLATE_TOO_SLOW) { renderTemplate(template, input(crowded(1000))) } }
        }
    }

    @Nested
    @DisplayName("Valores de cabeçalho renderizados")
    inner class HeaderValues {
        private fun headerRule(value: String) = RuleResponse(headers = mapOf("X-Eco" to value), template = true)

        @Test
        @DisplayName("Dado um valor de cabeçalho que rende exatamente 8 KiB, quando renderiza, então sai inteiro")
        fun rendered_cabecalhoNoTeto_deveSairInteiro() {
            val rendered = headerRule("{{randomValue type='HEX' length=$MAX_RENDERED_HEADER}}").rendered(input())

            assertThat(rendered.headers["X-Eco"]).hasSize(MAX_RENDERED_HEADER)
        }

        @Test
        @DisplayName("Dado um valor de cabeçalho que rende 8 KiB e um caractere, quando renderiza, então recusa com 500 e a mensagem")
        fun rendered_cabecalhoAcimaDoTeto_deveRecusar() {
            val rule = headerRule("{{randomValue type='HEX' length=$MAX_RENDERED_HEADER}}x")

            assertRefused(TEMPLATE_TOO_LARGE) { rule.rendered(input()) }
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um valor do remetente com CR, LF ou outro controle, quando vira cabeçalho, então cada controle vira espaço")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            a\r\nX-Injetado: sim  | a  X-Injetado: sim
            a\nX-Injetado: sim    | a X-Injetado: sim
            a\rX-Injetado: sim    | a X-Injetado: sim
            a\u0000b\u000bc\u007fd | a b c d
            a\u0085b\u009fc        | a b c
            a\tb                  | a\tb
            aéĊb             | aéĊb""",
        )
        fun rendered_controleNoCabecalho_deveVirarEspaco(
            sent: String,
            expected: String,
        ) {
            val request = crowded(1).copy(query = mapOf("x" to unescape(sent)))

            val rendered = headerRule("{{request.query.x}}").rendered(input(request))

            assertThat(rendered.headers["X-Eco"]).isEqualTo(unescape(expected))
        }

        @Test
        @DisplayName("Dado um valor do remetente com quebra de linha, quando vai para o corpo, então o corpo mantém a quebra")
        fun rendered_quebraNoCorpo_deveFicar() {
            val request = crowded(1).copy(query = mapOf("x" to "a\r\nb"))

            val rendered = RuleResponse(body = "{{request.query.x}}", template = true).rendered(input(request))

            assertThat(rendered.body).isEqualTo("a\r\nb")
        }
    }

    @Nested
    @DisplayName("Entradas de math e randomValue")
    inner class HelperInputs {
        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado math com número enorme, quando renderiza, então o trecho sai vazio e rápido")
        @ValueSource(
            strings = [
                "{{math '1e999999999' '+' 1}}", "{{math 1 '*' '1e-999999999'}}", "{{math '1e101' '+' 0}}",
                "{{math request.body '*' request.body}}", "{{math (math (math '1e60' '*' '1e60') '*' '1e60') '*' '1e60'}}",
                "{{math '9e99' '/' '1e-99'}}",
            ],
        )
        fun render_mathEnorme_deveSairVazio(template: String) {
            val request = crowded(1).copy(body = "9".repeat(MAX_RENDERED_BODY))

            assertTimeoutPreemptively(FAST) { assertThat(renderTemplate("[$template]", input(request))).isEqualTo("[]") }
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado math no limite de 100 dígitos, quando renderiza, então faz a conta")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {{math '1e99' '+' 0}}      | 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
            {{math '1e-100' '+' 0}}    | 0.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001
            {{math '12345678901234567890' '*' 10}} | 123456789012345678900""",
        )
        fun render_mathNoLimite_deveFazerAConta(
            template: String,
            expected: String,
        ) {
            assertThat(renderTemplate(template, input())).isEqualTo(expected)
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado randomValue com length fora de 1..10000, quando valida, então há erro (422 ao salvar)")
        @ValueSource(
            strings = [
                "{{randomValue type='HEX' length=0}}", "{{randomValue type='HEX' length=10001}}", "{{randomValue type='HEX' length=-1}}",
                "{{randomValue type='HEX' length='x'}}", "{{randomValue type='HEX' length=99999999999}}",
                "{{#if seq}}{{else}}{{randomValue type='NUMERIC' length=20000}}{{/if}}",
            ],
        )
        fun templateError_randomValueForaDaFaixa_deveHaverErro(template: String) {
            assertThat(templateError(template)).startsWith("randomValue length must be between 1 and 10000 (line 1, column ")
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado randomValue com length na faixa ou vindo da requisição, quando valida, então não há erro")
        @ValueSource(
            strings = [
                "{{randomValue type='HEX' length=1}}", "{{randomValue type='HEX' length=10000}}", "{{randomValue type='HEX' length='8'}}",
                "{{randomValue type='HEX' length=request.query.n}}", "{{randomValue type='HEX' length=seq}}",
            ],
        )
        fun templateError_randomValueNaFaixa_naoDeveHaverErro(template: String) {
            assertThat(templateError(template)).isNull()
        }
    }
}

private val ESCAPES = mapOf("r" to '\r', "n" to '\n', "t" to '\t')

/** `\r`, `\n`, `\t` e `\uXXXX` da tabela viram os caracteres. */
private fun unescape(text: String): String =
    Regex("""\\(r|n|t|u[0-9a-fA-F]{4})""").replace(text) { match ->
        val code = match.groupValues[1]
        (ESCAPES[code] ?: code.drop(1).toInt(radix = 16).toChar()).toString()
    }
