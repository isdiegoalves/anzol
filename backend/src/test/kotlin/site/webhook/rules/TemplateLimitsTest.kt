package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatThrownBy
import org.junit.jupiter.api.Assertions.assertTimeoutPreemptively
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.api.function.ThrowingSupplier
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.MethodSource
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import java.lang.management.ManagementFactory
import java.time.Duration
import java.time.Instant
import java.util.UUID
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

/**
 * Blocos aninhados que imprimem 1 KiB por volta, com quantos nomes e valores cada um recebe: o bastante para
 * que materializar um bloco antes de escrever passe de [MAX_ALLOCATED_BYTES] sem passar do prazo.
 */
fun nestedBlocks(): List<Arguments> =
    listOf(
        Arguments.of(
            "{{#each request.query}}{{#each ../request.headers}}{{#each ../../request.query}}{{@key}}{{/each}}{{/each}}{{/each}}",
            150,
        ),
        Arguments.of(
            "{{#if seq}}{{#each request.query}}{{#with request}}{{#each ../../request.headers}}{{this}}" +
                "{{/each}}{{/with}}{{/each}}{{/if}}",
            150,
        ),
        Arguments.of(
            "{{#unless x}}{{#each request.query}}{{#each @root.request.query}}{{#each @root.request.query}}{{this}}" +
                "{{/each}}{{/each}}{{/each}}{{/unless}}",
            30,
        ),
        Arguments.of(
            "{{#each request.query}}{{#each @root.request.headers}}{{#each @root.request.headers}}{{@key}}" +
                "{{/each}}{{/each}}{{/each}}",
            150,
        ),
        Arguments.of(
            "{{#each request.query}}{{#each @root.request.query}}{{#each @root.request.query}}{{#each @root.request.query}}{{this}}" +
                "{{/each}}{{/each}}{{/each}}{{/each}}",
            40,
        ),
    )

/** Template curto (abaixo do teto de 64 KiB) que rende exatamente [length] caracteres, em blocos de `randomValue`. */
private fun exactly(length: Int): String {
    val chunk = 10_000
    return "{{randomValue type='HEX' length=$chunk}}".repeat(length / chunk) + "a".repeat(length % chunk)
}

/** Corpo JSON perto de 1 MiB: um campo curto (`a`) e um texto longo. */
private val BIG_BODY = """{"a":"x","pad":"${"p".repeat(MAX_RENDERED_BODY - 32)}"}"""

/** `[[[…[1]…]]]`, com [depth] listas uma dentro da outra. */
private fun nestedLists(depth: Int): String = "[".repeat(depth) + "1" + "]".repeat(depth)

/** União que repete o índice 0 [times] vezes: `[0,0,…]`. */
private fun repeatedIndex(times: Int): String = List(times) { "0" }.joinToString(",", "[", "]")

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
            val template = exactly(MAX_RENDERED_BODY)

            assertThat(renderTemplate(template, input())).hasSize(MAX_RENDERED_BODY)
        }

        @Test
        @DisplayName("Dado um template que rende 1 MiB e um caractere, quando renderiza, então recusa com 500 e a mensagem do teto")
        fun render_umAcimaDoTeto_deveRecusar() {
            val template = exactly(MAX_RENDERED_BODY - 1) + "{{seq}}{{seq}}"

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
        @MethodSource("site.webhook.rules.TemplateLimitsTestKt#nestedBlocks")
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
    @DisplayName("Custo do jsonPath sobre o corpo do remetente")
    inner class JsonPathCost {
        @Test
        @DisplayName("Dado each sobre mil parâmetros com jsonPath no corpo de ~1 MiB, quando renderiza, então lê o corpo uma vez só")
        fun render_eachComJsonPathNoCorpoGrande_deveLerOCorpoUmaVez() {
            val request = crowded(1000).copy(body = BIG_BODY)

            val allocated =
                allocatedWithinFast {
                    assertThat(renderTemplate("{{#each request.query}}{{jsonPath request.body '$.a'}}{{/each}}", input(request)))
                        .isEqualTo("x".repeat(1000))
                }

            assertThat(allocated).isLessThan(MAX_ALLOCATED_BYTES)
        }

        @Test
        @DisplayName("Dado uma união repetida que multiplica os resultados, quando renderiza, então para no teto dos caminhos com 500")
        fun render_uniaoQueMultiplicaResultados_deveRecusarPorTamanho() {
            val template = "{{#each request.query}}{{jsonPath request.body '$${repeatedIndex(10).repeat(20)}'}}{{/each}}"
            val request = crowded(1000).copy(body = nestedLists(20))

            val allocated = allocatedWithinFast { assertRefused(TEMPLATE_TOO_LARGE) { renderTemplate(template, input(request)) } }

            assertThat(allocated).isLessThan(MAX_ALLOCATED_BYTES)
        }

        @Test
        @DisplayName("Dado um caminho que visita bilhões de nós sem achar nada, quando renderiza, então para no prazo durante a avaliação")
        fun render_caminhoQueGiraSemResultado_devePararNoPrazo() {
            val template = "{{jsonPath request.body '$${repeatedIndex(10).repeat(20)}.nada'}}"
            val request = crowded(1).copy(body = nestedLists(20))

            assertTimeoutPreemptively(FAST) { assertRefused(TEMPLATE_TOO_SLOW) { renderTemplate(template, input(request)) } }
        }

        @Test
        @DisplayName("Dado um resultado cujo JSON passaria de 500 MB, quando renderiza, então para de escrever no teto, sem montar o texto")
        fun render_resultadoEnormeEmJson_deveRecusarSemMaterializar() {
            val template = "{{jsonPath request.body '$${repeatedIndex(1000)}'}}"
            val request = crowded(1).copy(body = """[{"pad":"${"p".repeat(500_000)}"}]""")

            val allocated = allocatedWithinFast { assertRefused(TEMPLATE_TOO_LARGE) { renderTemplate(template, input(request)) } }

            assertThat(allocated).isLessThan(MAX_ALLOCATED_BYTES)
        }

        @Test
        @DisplayName("Dado um objeto maior que o teto do cabeçalho, quando vira valor de cabeçalho, então recusa com 500")
        fun rendered_objetoMaiorQueOCabecalho_deveRecusar() {
            val rule = RuleResponse(headers = mapOf("X-Eco" to "{{jsonPath request.body '$.o'}}"), template = true)
            val request = crowded(1).copy(body = """{"o":{"pad":"${"p".repeat(MAX_RENDERED_HEADER)}"}}""")

            assertRefused(TEMPLATE_TOO_LARGE) { rule.rendered(input(request)) }
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado jsonPath com busca profunda, filtro ou função, quando valida, então há erro (422 ao salvar)")
        @ValueSource(
            strings = [
                "{{jsonPath request.body '$..a'}}", "{{jsonPath request.body '$.a..b'}}", "{{jsonPath request.body '$[?(@.a)]'}}",
                "{{jsonPath request.body \"$[?(@.a =~ /(a+)+b/)]\"}}", "{{jsonPath request.body '$.a.length()'}}",
                "{{jsonPath request.body '$.concat($.a, $.a)'}}", "{{#if seq}}{{else}}{{jsonPath request.body '$..*'}}{{/if}}",
            ],
        )
        fun templateError_caminhoNaoSuportado_deveHaverErro(template: String) {
            assertThat(templateError(template))
                .startsWith("jsonPath supports only simple paths, without deep scan (..), filters (?) or functions (()) (line 1, column ")
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado o caminho vindo da requisição, quando renderiza, então só o caminho simples é avaliado")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            $.a          | x
            $..a         | ''
            $[?(@.a)]    | ''
            $.a.length() | ''""",
        )
        fun render_caminhoDaRequisicao_deveAvaliarSoOSimples(
            path: String,
            expected: String,
        ) {
            val request = crowded(1).copy(query = mapOf("p" to path), body = """{"a":"x"}""")

            assertThat(renderTemplate("{{jsonPath request.body request.query.p}}", input(request))).isEqualTo(expected)
        }
    }

    @Nested
    @DisplayName("Tetos de compilação: tamanho, aninhamento e cache")
    inner class CompileLimits {
        @Test
        @DisplayName("Dado um template de exatamente 64 KiB, quando valida e responde várias vezes, então compila uma vez só")
        fun templateError_templateNoTeto_deveCompilarUmaVez() {
            val prefix = "{{seq}}-${UUID.randomUUID()}-"
            val template = prefix + "a".repeat(MAX_TEMPLATE_LENGTH - prefix.length)
            val rule = RuleResponse(body = template, template = true)
            val before = templateCompilations()

            assertThat(templateError(template)).isNull()
            repeat(3) { assertThat(rule.rendered(input()).body).startsWith("1-") }

            assertThat(templateCompilations() - before).isEqualTo(1)
        }

        @Test
        @DisplayName("Dado uma regra que muda de texto, quando responde, então compila o texto novo")
        fun rendered_textoNovo_deveCompilarDeNovo() {
            val marker = UUID.randomUUID()
            val before = templateCompilations()

            val first = RuleResponse(body = "{{seq}} $marker a", template = true).rendered(input())
            val second = RuleResponse(body = "{{seq}} $marker b", template = true).rendered(input())

            assertThat(first.body to second.body).isEqualTo("1 $marker a" to "1 $marker b")
            assertThat(templateCompilations() - before).isEqualTo(2)
        }

        @Test
        @DisplayName("Dado milhares de templates curtos e distintos, quando valida cada um, então o cache guarda no máximo 4096")
        fun templateError_milharesDeTemplatesCurtos_deveGuardarAteOTetoDeEntradas() {
            val marker = UUID.randomUUID()

            repeat(MAX_CACHED_TEMPLATES.toInt() + 1000) { assertThat(templateError("{{seq}} $marker $it")).isNull() }

            assertThat(cachedTemplates()).isLessThanOrEqualTo(MAX_CACHED_TEMPLATES)
        }

        @Test
        @DisplayName("Dado um template de 64 KiB e um caractere, quando valida, então há erro de tamanho")
        fun templateError_umAcimaDoTeto_deveHaverErro() {
            assertThat(templateError("a".repeat(MAX_TEMPLATE_LENGTH + 1))).isEqualTo("longer than 65536 characters")
        }

        @ParameterizedTest(name = "{0} níveis")
        @DisplayName("Dado blocos aninhados até 32 níveis, quando valida, então não há erro")
        @ValueSource(ints = [1, MAX_TEMPLATE_NESTING])
        fun templateError_aninhamentoNoTeto_naoDeveHaverErro(depth: Int) {
            val template = "{{#if seq}}".repeat(depth) + "x" + "{{/if}}".repeat(depth)

            assertThat(templateError(template)).isNull()
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado blocos, else if ou subexpressões com 33 níveis, quando valida, então há erro de aninhamento")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            blocos        | blocks nested more than 32 levels deep (line 1, column 353)
            with e each   | blocks nested more than 32 levels deep (line 1, column 513)
            else if       | blocks nested more than 32 levels deep (line 1, column 477)
            subexpressões | subexpressions nested more than 32 levels deep (line 1, column 1)""",
        )
        fun templateError_aninhamentoAcimaDoTeto_deveHaverErro(
            shape: String,
            expected: String,
        ) {
            val depth = MAX_TEMPLATE_NESTING + 1
            val template =
                when (shape) {
                    "blocos" -> "{{#if seq}}".repeat(depth) + "{{/if}}".repeat(depth)
                    "with e each" -> "{{#with request}}{{#each query}}".repeat(depth) + "{{/each}}{{/with}}".repeat(depth)
                    "else if" -> "{{#if seq}}" + "{{else if seq}}".repeat(depth - 1) + "{{/if}}"
                    else -> "{{" + "math (".repeat(depth) + "math 1 '+' 1" + ") '+' 1".repeat(depth) + "}}"
                }

            assertThat(templateError(template)).isEqualTo(expected)
        }

        @ParameterizedTest(name = "{0} blocos")
        @DisplayName("Dado milhares de blocos aninhados, quando valida, então há erro e não estouro de pilha")
        @ValueSource(ints = [5_000, 40_000])
        fun templateError_milharesDeBlocos_deveHaverErroSemEstourarPilha(depth: Int) {
            val template = "{{#if seq}}".repeat(depth) + "{{/if}}".repeat(depth)

            assertThat(templateError(template)).isNotBlank()
        }

        @Test
        @DisplayName("Dado um texto acima do teto guardado antes da regra nova, quando renderiza, então recusa com 500 e o motivo")
        fun renderTemplate_acimaDoTeto_deveRecusarComOMotivo() {
            val template = "{{#if seq}}".repeat(5_000) + "x" + "{{/if}}".repeat(5_000)

            assertRefused("The template is invalid: longer than 65536 characters.") { renderTemplate(template, input()) }
        }

        @Test
        @DisplayName("Dado um cabeçalho com 33 blocos guardado antes do teto, quando a regra responde, então 500 com o motivo e log")
        @ExtendWith(OutputCaptureExtension::class)
        fun rendered_cabecalhoAcimaDoAninhamento_deveRecusarComOMotivo(log: CapturedOutput) {
            val depth = MAX_TEMPLATE_NESTING + 1
            val rule = RuleResponse(headers = mapOf("X-Eco" to "{{#if seq}}".repeat(depth) + "{{/if}}".repeat(depth)), template = true)
            val request = crowded(1).copy(url = "http://localhost/0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41/x?q=1")

            assertRefused("The template is invalid: blocks nested more than 32 levels deep (line 1, column 353).") {
                rule.rendered(input(request))
            }
            assertThat(log.out).contains(
                "Regra com template inválido em http://localhost/0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41/x, resposta 500: " +
                    "blocks nested more than 32 levels deep (line 1, column 353)",
            )
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

        @Test
        @DisplayName("Dado quatro cabeçalhos de 8 KiB (32 KiB somados), quando renderiza, então saem inteiros")
        fun rendered_somaDosCabecalhosNoTeto_deveSairInteira() {
            val headers = (1..4).associate { "X-$it" to "{{randomValue type='HEX' length=$MAX_RENDERED_HEADER}}" }

            val rendered = RuleResponse(headers = headers, template = true).rendered(input())

            assertThat(rendered.headers.values.sumOf { it.length }).isEqualTo(MAX_RENDERED_HEADERS)
        }

        @Test
        @DisplayName("Dado cabeçalhos que somam 32 KiB e um caractere, quando renderiza, então recusa com 500 e a mensagem do teto")
        fun rendered_somaDosCabecalhosAcimaDoTeto_deveRecusar() {
            val headers = (1..4).associate { "X-$it" to "{{randomValue type='HEX' length=$MAX_RENDERED_HEADER}}" } + ("X-5" to "x")

            assertRefused(TEMPLATE_TOO_LARGE) { RuleResponse(headers = headers, template = true).rendered(input()) }
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado um caractere fora do ISO-8859-1 num cabeçalho templado, quando renderiza, então vira ?")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            a\u2028b    | a?b
            a\u2029b    | a?b
            a\u0100b    | a?b
            a\uD83D\uDE00b | a?b
            a\uD83Db    | a?b
            aé\u00FFb   | aé\u00FFb""",
        )
        fun rendered_foraDoLatin1NoCabecalhoTemplado_deveVirarInterrogacao(
            sent: String,
            expected: String,
        ) {
            val request = crowded(1).copy(query = mapOf("x" to unescape(sent)))

            val rendered = headerRule("{{request.query.x}}").rendered(input(request))

            assertThat(rendered.headers["X-Eco"]).isEqualTo(unescape(expected))
        }

        @Test
        @DisplayName("Dado um cabeçalho fixo com caractere fora do ISO-8859-1, quando a regra responde sem template, então vira ?")
        fun rendered_foraDoLatin1NoCabecalhoFixo_deveVirarInterrogacao() {
            val rule = RuleResponse(headers = mapOf("X-Fixo" to "ĉ\u2028é {{seq}}"), template = false)

            assertThat(rule.rendered(input()).headers).isEqualTo(mapOf("X-Fixo" to "??é {{seq}}"))
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um cabeçalho fixo com controle C0, DEL ou C1, quando a regra responde sem template, então vira espaço")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            a\u000bb\u000cc      | a b c
            a\u001fb\u007fc      | a b c
            a\u0085b\u009fc      | a b c
            a\tb                  | a\tb
            a\u0085ĉ              | a ?""",
        )
        fun rendered_controleNoCabecalhoFixo_deveVirarEspaco(
            fixed: String,
            expected: String,
        ) {
            val rule = RuleResponse(headers = mapOf("X-Fixo" to unescape(fixed)), template = false)

            assertThat(rule.rendered(input()).headers["X-Fixo"]).isEqualTo(unescape(expected))
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
            aéĊb             | aé?b""",
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
