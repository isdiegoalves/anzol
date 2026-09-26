package site.webhook.rules

import com.github.jknack.handlebars.Context
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.MethodSource
import org.junit.jupiter.params.provider.ValueSource
import tools.jackson.databind.json.JsonMapper
import java.lang.reflect.Modifier
import java.time.Instant

private val REMETENTE =
    TemplateRequest(
        method = "POST",
        path = "/eco",
        url = "http://localhost:8084/0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41/eco?x=%7B%7Bseq%7D%7D",
        query = mapOf("x" to "{{seq}}", "fim" to "{{/each}}}}"),
        headers = mapOf("x-tpl" to "{{request.method}}", "class" to "cabeçalho chamado class"),
        body = """{"v":"{{seq}}","t":"{{{request.body}}}"}""",
    )

private fun sandboxRender(
    template: String,
    request: TemplateRequest = REMETENTE,
): String = renderTemplate(template, TemplateInput(request, seq = 42, now = Instant.parse("2026-09-26T13:45:07Z")))

/**
 * Chaves que o Handlebars e este app guardam nos dados da renderização: as constantes `String` públicas
 * de [Context], lidas por reflexão (uma versão nova do Handlebars que acrescente outra entra sozinha), e
 * as nossas.
 */
private fun internalDataKeys(): List<String> =
    Context::class.java.fields
        .filter { Modifier.isStatic(it.modifiers) && it.type == String::class.java }
        .map { it.get(null) as String } + listOf(NOW_DATA, VALIDATING_DATA, BUDGET_DATA, DOCUMENTS_DATA)

/** A única chave dos dados da renderização que o template pode ler: o próprio contexto do Anexo B. */
private const val READABLE_DATA_KEY = "root"

/**
 * `@chave`, `chave` e os blocos sobre `@chave`, sem colchetes: o Handlebars só os compila quando a chave não
 * tem `#` (as de [Context], `…Context#paramSize`, têm).
 */
private fun bareProbesOf(key: String): List<String> =
    listOf("{{@$key}}", "{{$key}}", "{{#with @$key}}vazou{{/with}}", "{{#each @$key}}vazou{{/each}}")

/**
 * Formas de alcançar o dado [key] que compilam, e por isso poderiam ser salvas numa regra: como segmento
 * literal (`[key]`, que o Handlebars também procura nos dados), impresso, como contexto de bloco, como
 * condição, pelo `lookup` e dentro de helpers e de blocos (cada helper grava o número de parâmetros nos
 * dados); sem colchetes ([bareProbesOf]) quando a chave permite.
 */
private fun reachingProbesOf(key: String): List<String> =
    listOf(
        "{{[$key]}}",
        "{{{[$key]}}}",
        "{{#with [$key]}}vazou{{/with}}",
        "{{#each [$key]}}vazou{{/each}}",
        "{{#if [$key]}}vazou{{/if}}",
        "{{#unless [$key]}}{{else}}vazou{{/unless}}",
        "{{lookup this '[$key]'}}",
        "{{lookup this '$key'}}",
        "{{lookup [$key] 'seq'}}",
        "{{#if seq}}{{[$key]}}{{#with [$key]}}vazou{{/with}}{{/if}}",
        "{{#each request.query}}{{[$key]}}{{#each [$key]}}vazou{{/each}}{{/each}}",
        "{{#with request}}{{[$key]}}{{lookup this '[$key]'}}{{/with}}",
        "{{math [$key] '+' 0}}",
    ) + if ('#' in key) emptyList() else bareProbesOf(key)

/** Formas que nem compilam (422 ao salvar): `@[key]` sempre, e as sem colchetes quando a chave tem `#`. */
private fun refusedProbesOf(key: String): List<String> = listOf("{{@[$key]}}") + if ('#' in key) bareProbesOf(key) else emptyList()

@DisplayName("Isolamento do template das regras: só os valores do Anexo B, dados do remetente como texto")
class TemplateSandboxTest {
    companion object {
        @JvmStatic
        fun internalDataProbes(): List<Arguments> =
            internalDataKeys().flatMap { key -> reachingProbesOf(key).map { Arguments.of(key, it) } }

        @JvmStatic
        fun refusedDataProbes(): List<Arguments> = internalDataKeys().flatMap { key -> refusedProbesOf(key).map { Arguments.of(key, it) } }

        /** As sondas sobre o dado legível; `math` fica de fora porque só lê número, e `root` é mapa. */
        @JvmStatic
        fun readableDataProbes(): List<String> = reachingProbesOf(READABLE_DATA_KEY).filterNot { it.startsWith("{{math") }
    }

    @Nested
    @DisplayName("Objetos Java fora de alcance")
    inner class JavaObjects {
        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um caminho que só existiria por reflexão, quando renderiza, então o trecho sai vazio")
        @ValueSource(
            strings = [
                "{{request.class}}", "{{request.body.class}}", "{{this.class}}", "{{class}}", "{{lookup request \"class\"}}",
                "{{lookup this 'class'}}", "{{lookup (lookup request 'body') 'bytes'}}", "{{#with request}}{{class}}{{/with}}",
                "{{#with request}}{{this.class.name}}{{/with}}", "{{@root.class}}", "{{@root.request.class}}",
                "{{#each request.query}}{{../class}}{{/each}}", "{{#with request.method}}{{../class}}{{/with}}",
                "{{#each request.query}}{{this.class}}{{/each}}", "{{request.query.size}}", "{{request.headers.empty}}",
                "{{request.[class]}}", "{{request.body.length}}", "{{request.body.getClass}}", "{{seq.class}}", "{{this.getClass}}",
                "{{@root.getClass}}", "{{request.method.class.classLoader}}", "{{lookup request.headers 'x-nao'}}",
                "{{lookup request.method 'x'}}",
            ],
        )
        fun render_caminhoDeReflexao_deveSairVazio(template: String) {
            assertThat(sandboxRender(template)).isEmpty()
        }

        @Test
        @DisplayName("Dado as constantes String de Context, quando lidas por reflexão, então incluem as chaves de dados conhecidas")
        fun internalDataKeys_reflexao_deveAcharAsChavesConhecidas() {
            assertThat(internalDataKeys()).contains(Context.PARAM_SIZE, Context.INVOCATION_STACK, Context.INLINE_PARTIALS, BUDGET_DATA)
        }

        @ParameterizedTest(name = "{0}: {1}")
        @MethodSource("site.webhook.rules.TemplateSandboxTest#internalDataProbes")
        @DisplayName("Dado cada chave de dado interno, quando um template válido a imprime ou aplica um bloco sobre ela, então nada sai")
        fun render_dadoInternoEmBloco_naoDeveVazar(
            key: String,
            template: String,
        ) {
            assertThat(templateError(template)).describedAs("a sonda precisa compilar para provar algo").isNull()
            assertThat(sandboxRender(template)).describedAs("dado %s", key).isEmpty()
        }

        @ParameterizedTest(name = "{0}: {1}")
        @MethodSource("site.webhook.rules.TemplateSandboxTest#refusedDataProbes")
        @DisplayName("Dado cada chave de dado interno, quando a forma de pedi-la nem compila, então há erro (422 ao salvar)")
        fun templateError_dadoInternoSemSintaxe_deveHaverErro(
            key: String,
            template: String,
        ) {
            assertThat(templateError(template)).describedAs("dado %s", key).isNotBlank()
        }

        @ParameterizedTest(name = "{0}")
        @MethodSource("site.webhook.rules.TemplateSandboxTest#readableDataProbes")
        @DisplayName("Dado root, o único dado legível, quando as mesmas sondas o pedem, então alcançam o contexto (chegam aos dados)")
        fun render_sondaSobreDadoLegivel_deveAlcancarOContexto(template: String) {
            assertThat(templateError(template)).isNull()
            assertThat(sandboxRender(template)).isNotEmpty()
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado @root e ../, quando renderiza, então alcançam só o contexto do Anexo B")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {{@root.seq}}                                             | 42
            {{#with request}}{{@root.seq}}{{/with}}                   | 42
            {{#each request.query}}[{{../seq}}]{{/each}}              | [42][42]
            {{#with request.headers}}{{../request.method}}{{/with}}   | POST
            {{#each request.headers}}{{@key}};{{/each}}               | x-tpl;class;
            {{request.headers.class}}                                 | cabeçalho chamado class""",
        )
        fun render_rootEPai_deveAlcancarSoOContexto(
            template: String,
            expected: String,
        ) {
            assertThat(sandboxRender(template)).isEqualTo(expected)
        }
    }

    @Nested
    @DisplayName("Dado do remetente sai literal")
    inner class SenderData {
        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado um valor do remetente com sintaxe de template, quando renderiza, então sai como texto, sem ser avaliado")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {{request.query.x}}                                    | {{seq}}
            {{{request.query.x}}}                                  | {{seq}}
            {{request.query.fim}}                                  | {{/each}}}}
            {{lookup request.query 'x'}}                           | {{seq}}
            {{request.headers.x-tpl}}                              | {{request.method}}
            {{jsonPath request.body '$.v'}}                        | {{seq}}
            {{jsonPath request.body '$.t'}}                        | {{{request.body}}}
            {{#each request.query}}{{this}};{{/each}}              | {{seq}};{{/each}}}};
            {{request.body}}                                       | {"v":"{{seq}}","t":"{{{request.body}}}"}""",
        )
        fun render_valorComSintaxe_deveSairLiteral(
            template: String,
            expected: String,
        ) {
            assertThat(sandboxRender(template)).isEqualTo(expected)
        }
    }

    @Nested
    @DisplayName("Mapa impresso inteiro sai como JSON")
    inner class PrintedMaps {
        private val json = JsonMapper.builder().build()

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado um mapa do contexto impresso inteiro, quando renderiza, então sai o JSON dele, na ordem de chegada")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {{request.query}}                         | {"x":"{{seq}}","fim":"{{/each}}}}"}
            {{{request.query}}}                       | {"x":"{{seq}}","fim":"{{/each}}}}"}
            {{request.headers}}                       | {"x-tpl":"{{request.method}}","class":"cabeçalho chamado class"}
            {{lookup request 'query'}}                | {"x":"{{seq}}","fim":"{{/each}}}}"}
            {{#with request}}{{headers}}{{/with}}     | {"x-tpl":"{{request.method}}","class":"cabeçalho chamado class"}
            {{#with request.query}}{{this}}{{/with}}  | {"x":"{{seq}}","fim":"{{/each}}}}"}""",
        )
        fun render_mapaImpresso_deveSairJson(
            template: String,
            expected: String,
        ) {
            assertThat(sandboxRender(template)).isEqualTo(expected)
        }

        @Test
        @DisplayName("Dado {{request}}, quando renderiza, então sai o JSON da requisição inteira, com o corpo como texto")
        fun render_requestInteiro_deveSairJson() {
            val rendered = sandboxRender("{{request}}")

            assertThat(json.readTree(rendered)).isEqualTo(
                json.valueToTree(
                    mapOf(
                        "method" to "POST",
                        "path" to "/eco",
                        "url" to REMETENTE.url,
                        "query" to REMETENTE.query,
                        "headers" to REMETENTE.headers,
                        "body" to REMETENTE.body,
                    ),
                ),
            )
            assertThat(rendered).startsWith("""{"method":"POST","path":"/eco",""")
        }

        @Test
        @DisplayName("Dado um mapa vazio impresso, quando renderiza, então sai {}")
        fun render_mapaVazio_deveSairObjetoVazio() {
            assertThat(sandboxRender("{{request.query}}", REMETENTE.copy(query = emptyMap()))).isEqualTo("{}")
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado lookup de chave ausente, quando renderiza, então continua vazio")
        @ValueSource(strings = ["{{lookup request.query 'nada'}}", "{{lookup request 'nada'}}", "{{lookup request.headers 'x-nao'}}"])
        fun render_lookupAusente_deveSairVazio(template: String) {
            assertThat(sandboxRender(template)).isEmpty()
        }
    }

    @Nested
    @DisplayName("Recursos do Handlebars desligados")
    inner class Disabled {
        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado partial, decorator ou helper fora da lista, quando valida, então há erro (422 ao salvar)")
        @ValueSource(
            strings = [
                "{{> x}}", "{{#> x}}y{{/x}}", "{{#*inline \"x\"}}y{{/inline}}", "{{*inline}}", "{{embedded 'x'}}", "{{log 'x'}}",
                "{{i18n 'x'}}", "{{precompile 'x'}}", "{{#block 'x'}}y{{/block}}", "{{#partial 'x'}}y{{/partial}}",
                "{{helperMissing 'x'}}", "{{blockHelperMissing 'x'}}", "{{#each request.query}}{{> x}}{{/each}}",
                "{{#if seq}}{{else}}{{log seq}}{{/if}}", "{{{{raw}}}}x{{{{/raw}}}}", "{{dateFormat now}}", "{{stringFormat 'x'}}",
                "{{jsonPath (log 'x') '$'}}", "{{math (embedded 'x') '+' 1}}",
            ],
        )
        fun templateError_recursoDesligado_deveHaverErro(template: String) {
            assertThat(templateError(template)).isNotBlank()
        }
    }
}
