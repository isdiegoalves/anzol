package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import java.time.Instant

private val NOW = Instant.parse("2026-09-26T13:45:07.123456Z")

private val PEDIDO =
    TemplateRequest(
        method = "POST",
        path = "/pedidos/42",
        url = "http://localhost:8084/0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41/pedidos/42?tipo=pix",
        query = mapOf("tipo" to "pix", "n" to "7"),
        headers = mapOf("content-type" to "application/json", "x-canal" to "app"),
        body = """{"id":"abc-1","valor":10.5,"itens":[{"sku":"A"},{"sku":"B"}],"cliente":{"nome":"Ana"},"nulo":null}""",
    )

private fun render(
    template: String,
    request: TemplateRequest = PEDIDO,
    seq: Long = 42,
): String = renderTemplate(template, TemplateInput(request, seq, NOW))

@DisplayName("Templating Handlebars das respostas de regra (Anexo B)")
class ResponseTemplateTest {
    @Nested
    @DisplayName("Contexto da requisição")
    inner class RequestContext {
        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado uma requisição, quando o template lê o contexto, então cada caminho do Anexo B traz o valor dela")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {{request.method}}                | POST
            {{request.path}}                  | /pedidos/42
            {{request.url}}                   | http://localhost:8084/0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41/pedidos/42?tipo=pix
            {{request.query.tipo}}            | pix
            {{request.headers.x-canal}}       | app
            {{request.headers.[content-type]}} | application/json
            {{seq}}                           | 42""",
        )
        fun render_caminhoDoContexto_deveTrazerOValor(
            template: String,
            expected: String,
        ) {
            assertThat(render(template)).isEqualTo(expected)
        }

        @Test
        @DisplayName("Dado o corpo cru no template, quando renderiza, então sai sem escape HTML")
        fun render_corpoCru_naoDeveEscaparHtml() {
            val request = PEDIDO.copy(body = """<a href="x">'&'</a>""")

            assertThat(render("{{request.body}}", request)).isEqualTo("""<a href="x">'&'</a>""")
        }

        @Test
        @DisplayName("Dado um nome que não existe no contexto, quando renderiza, então o trecho sai vazio e o resto fica")
        fun render_nomeInexistente_deveSairVazio() {
            assertThat(render("[{{nada}}][{{request.query.ausente}}][{{request.headers.x-nao}}]")).isEqualTo("[][][]")
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um caminho que só existiria por reflexão no objeto Java, quando renderiza, então sai vazio")
        @ValueSource(
            strings = [
                "{{request.method.class}}", "{{request.method.class.name}}", "{{request.method.bytes}}",
                "{{request.method.toLowerCase}}", "{{request.method.empty}}", "{{request.query.class}}", "{{seq.class}}",
                "{{#with request.method}}{{class}}{{/with}}",
            ],
        )
        fun render_reflexao_deveSairVazio(template: String) {
            assertThat(render(template)).isEmpty()
        }

        @Test
        @DisplayName("Dado os blocos de lógica do Handlebars, quando renderiza, então if, unless, each, with e lookup funcionam")
        fun render_blocosDeLogica_devemFuncionar() {
            val template =
                "{{#if request.query.tipo}}tem{{/if}}{{#unless request.query.x}}-sem{{/unless}}" +
                    "{{#each request.query}}|{{@key}}={{this}}{{/each}}{{#with request}}|{{method}}{{/with}}" +
                    "|{{lookup request.headers 'x-canal'}}"

            assertThat(render(template)).isEqualTo("tem-sem|tipo=pix|n=7|POST|app")
        }
    }

    @Nested
    @DisplayName("Helper jsonPath")
    inner class JsonPathHelper {
        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado um corpo JSON, quando o template usa jsonPath, então escalar sai como texto e objeto ou lista como JSON")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {{jsonPath request.body '$.id'}}           | abc-1
            {{jsonPath request.body '$.valor'}}        | 10.5
            {{jsonPath request.body '$.cliente'}}      | {"nome":"Ana"}
            {{jsonPath request.body '$.itens[*].sku'}} | ["A","B"]
            {{jsonPath request.body '$.itens[1].sku'}} | B""",
        )
        fun render_jsonPath_deveTrazerOValor(
            template: String,
            expected: String,
        ) {
            assertThat(render(template)).isEqualTo(expected)
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um caminho ausente, nulo ou inválido, quando renderiza, então só o trecho sai vazio")
        @ValueSource(strings = ["$.ausente", "$.nulo", "$[", "$.itens[9].sku"])
        fun render_jsonPathSemValor_deveSairVazio(path: String) {
            assertThat(render("[{{jsonPath request.body '$path'}}]{{request.method}}")).isEqualTo("[]POST")
        }

        @Test
        @DisplayName("Dado um corpo que não é JSON, quando renderiza jsonPath, então o trecho sai vazio e o resto fica")
        fun render_jsonPathCorpoNaoJson_deveSairVazio() {
            val request = PEDIDO.copy(body = "isto não é json")

            assertThat(render("id=[{{jsonPath request.body '$.id'}}] ok", request)).isEqualTo("id=[] ok")
        }
    }

    @Nested
    @DisplayName("Helpers now, randomValue e math")
    inner class OtherHelpers {
        @Test
        @DisplayName("Dado now sem formato, quando renderiza, então sai o instante em ISO-8601 UTC, em segundos")
        fun render_nowSemFormato_deveSairIsoUtc() {
            assertThat(render("{{now}}")).isEqualTo("2026-09-26T13:45:07Z")
        }

        @Test
        @DisplayName("Dado now com format, quando renderiza, então usa o padrão do DateTimeFormatter em UTC")
        fun render_nowComFormato_deveUsarOPadrao() {
            assertThat(render("{{now format='yyyy-MM-dd HH:mm'}}")).isEqualTo("2026-09-26 13:45")
        }

        @Test
        @DisplayName("Dado now com formato inválido, quando renderiza, então o trecho sai vazio")
        fun render_nowFormatoInvalido_deveSairVazio() {
            assertThat(render("[{{now format='yyyy-MM-dd bbb {'}}]")).isEqualTo("[]")
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado randomValue, quando renderiza, então sai um valor do tipo e do tamanho pedidos")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {{randomValue type='UUID'}}                   | [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
            {{randomValue type='ALPHANUMERIC' length=8}}  | [0-9A-Za-z]{8}
            {{randomValue type='NUMERIC' length=5}}       | [0-9]{5}
            {{randomValue type='HEX'}}                    | [0-9a-f]{16}
            {{randomValue type='ALPHANUMERIC'}}           | [0-9A-Za-z]{16}""",
        )
        fun render_randomValue_deveSeguirTipoETamanho(
            template: String,
            pattern: String,
        ) {
            assertThat(render(template)).matches(pattern)
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado randomValue com tipo desconhecido ou tamanho fora de 1..10000, quando renderiza, então o trecho sai vazio")
        @ValueSource(
            strings = [
                "{{randomValue type='LETRAS'}}", "{{randomValue}}", "{{randomValue type='HEX' length=0}}",
                "{{randomValue type='HEX' length=10001}}", "{{randomValue type='HEX' length='x'}}",
            ],
        )
        fun render_randomValueInvalido_deveSairVazio(template: String) {
            assertThat(render("[$template]")).isEqualTo("[]")
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado math, quando renderiza, então faz a conta com números e textos numéricos do contexto")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {{math 1 '+' 2}}                  | 3
            {{math seq '-' 50}}               | -8
            {{math request.query.n '*' 1.5}}  | 10.5
            {{math 10 '/' 4}}                 | 2.5
            {{math 10 '/' 5}}                 | 2
            {{math 1 '/' 3}}                  | 0.3333333333333333
            {{math (jsonPath request.body '$.valor') '*' 2}} | 21""",
        )
        fun render_math_deveFazerAConta(
            template: String,
            expected: String,
        ) {
            assertThat(render(template)).isEqualTo(expected)
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado math com divisão por zero, operador ou número inválido, quando renderiza, então o trecho sai vazio")
        @ValueSource(strings = ["{{math 1 '/' 0}}", "{{math 1 '%' 2}}", "{{math request.method '+' 1}}", "{{math request.query.x '+' 1}}"])
        fun render_mathInvalido_deveSairVazio(template: String) {
            assertThat(render("[$template]")).isEqualTo("[]")
        }
    }

    @Nested
    @DisplayName("Chaves de JSON depois de uma tag")
    inner class ClosingBraces {
        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado }}} fechando uma tag {{ }}, quando renderiza, então a tag fecha e sobra uma chave literal")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {"seq":{{seq}}}                                          | {"seq":42}
            {"c":{{jsonPath request.body '$.cliente'}}}              | {"c":{"nome":"Ana"}}
            {"a":{"b":{{seq}}}}                                      | {"a":{"b":42}}
            {{#if seq}}{"s":{{seq}}}{{/if}}                          | {"s":42}
            {"h":"{{jsonPath request.body '$.x}}}'}}"}               | {"h":""}
            {"t":"{{now format="yyyy'}}}'"}}"}                       | {"t":"2026}}}"}
            {{{request.method}}}}                                    | POST}
            {{!-- }} --}}}                                           | }""",
        )
        fun render_chaveDepoisDaTag_deveFecharATag(
            template: String,
            expected: String,
        ) {
            assertThat(templateError(template)).isNull()
            assertThat(render(template)).isEqualTo(expected)
        }
    }

    @Nested
    @DisplayName("Parâmetros dos helpers")
    inner class HelperParams {
        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado helper sem os parâmetros que exige num ramo não validado, quando renderiza, então só o trecho sai vazio")
        @ValueSource(
            strings = ["{{#if}}x{{/if}}", "{{#each}}x{{/each}}", "{{jsonPath request.body}}", "{{math 1 '+'}}", "{{lookup request}}"],
        )
        fun render_semParametros_deveSairVazio(template: String) {
            assertThat(render("[$template]{{request.method}}")).isEqualTo("[]POST")
        }

        @Test
        @DisplayName("Dado helper sem parâmetro, quando valida, então o motivo diz qual helper e quantos parâmetros")
        fun templateError_semParametro_deveDizerOHelper() {
            assertThat(templateError("{{#each}}x{{/each}}")).isEqualTo("each requires 1 parameter(s) (line 1, column 3)")
        }
    }

    @Nested
    @DisplayName("Validação ao salvar")
    inner class Validation {
        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um template válido, quando valida, então não há erro")
        @ValueSource(
            strings = [
                "texto puro", "{{request.method}}", "{{jsonPath request.body '$.id'}}", "{{now}}", "{{now format='yyyy'}}",
                "{{randomValue type='UUID'}}", "{{math 1 '+' seq}}", "{{#if seq}}a{{else}}b{{/if}}",
                "{{#each request.query}}{{this}}{{/each}}", "{{nome_que_nao_existe}}", "{{{request.body}}}",
            ],
        )
        fun templateError_valido_deveSerNulo(template: String) {
            assertThat(templateError(template)).isNull()
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado erro de sintaxe, helper desconhecido ou helper embutido desligado, quando valida, então há erro")
        @ValueSource(
            strings = [
                "{{request.method", "{{#if seq}}sem fim", "{{foo 'x'}}", "{{naoExiste request.body}}", "{{#foo seq}}x{{/foo}}",
                "{{> cabecalho}}", "{{#> layout}}x{{/layout}}", "{{embedded 'x'}}", "{{i18n 'hello'}}", "{{i18nJs 'pt'}}",
                "{{precompile 'x'}}", "{{log 'x'}}", "{{#block 'x'}}y{{/block}}", "{{#partial 'x'}}y{{/partial}}",
                "{{helperMissing 'x'}}", "{{#*inline \"x\"}}y{{/inline}}", "{{*inline}}",
                "{{#each}}x{{/each}}", "{{#if}}x{{/if}}", "{{#unless}}x{{/unless}}", "{{#with}}x{{/with}}", "{{lookup request}}",
                "{{jsonPath request.body}}", "{{math 1 '+'}}", "{{#if request.query.nada}}{{#each}}x{{/each}}{{/if}}",
                "{{#if seq}}a{{else}}{{math 1}}{{/if}}", "{{#unless seq}}{{jsonPath}}{{/unless}}",
            ],
        )
        fun templateError_invalido_deveTrazerOMotivo(template: String) {
            assertThat(templateError(template)).isNotBlank()
        }

        @Test
        @DisplayName("Dado helper desconhecido, quando valida, então o motivo diz qual helper e onde")
        fun templateError_helperDesconhecido_deveDizerQualEOnde() {
            assertThat(templateError("ok {{foo 'x'}}")).isEqualTo("could not find helper: 'foo' (line 1, column 5)")
        }
    }
}
