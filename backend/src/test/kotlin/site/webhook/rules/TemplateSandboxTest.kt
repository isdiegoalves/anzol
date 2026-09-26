package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
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

@DisplayName("Isolamento do template das regras: só os valores do Anexo B, dados do remetente como texto")
class TemplateSandboxTest {
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

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado os dados internos da renderização, quando o template os pede, então nada sai")
        @ValueSource(
            strings = [
                "{{@site.webhook.now}}", "{{@[site.webhook.now]}}", "{{@site.webhook.validating}}", "{{@[site.webhook.validating]}}",
                "{{@[site.webhook.budget]}}", "{{@[com.github.jknack.handlebars.Context#paramSize]}}",
                "{{@[com.github.jknack.handlebars.Context#partials]}}", "{{@[com.github.jknack.handlebars.Context#invocationStack]}}",
                "{{@__inline_partials_}}", "{{@[__inline_partials_]}}",
            ],
        )
        fun render_dadoInterno_deveSairVazio(template: String) {
            assertThat(sandboxRender(template)).isEmpty()
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
