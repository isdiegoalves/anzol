package anzol.cli

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.assertThatIllegalArgumentException
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.time.Instant
import java.util.UUID

private val EVENT =
    Event(seq = 3, at = Instant.parse("2026-09-26T14:02:07.123456Z"), uuid = UUID.fromString("0b5c7a8e-1d2f-4e3a-9b8c-7d6e5f4a3b2c"))

private fun render(text: String): String = Template.parse(text).render(EVENT)

@DisplayName("Placeholders do send")
class TemplateTest {
    @Nested
    @DisplayName("Resolução")
    inner class Resolution {
        @Test
        @DisplayName("Dado uuid, now, timestamp e seq, quando resolve, então usa os valores do envio (now em ISO-8601 UTC, em segundos)")
        fun render_placeholdersDoEnvio_deveUsarOsValoresDoEnvio() {
            val text = render("""{"id":"{{uuid}}","em":"{{now}}","t":{{timestamp}},"n":{{seq}}}""")

            assertThat(text)
                .isEqualTo("""{"id":"0b5c7a8e-1d2f-4e3a-9b8c-7d6e5f4a3b2c","em":"2026-09-26T14:02:07Z","t":1790431327,"n":3}""")
        }

        @Test
        @DisplayName("Dado o mesmo placeholder duas vezes, quando resolve, então as duas recebem o mesmo valor do envio")
        fun render_uuidRepetido_deveRepetirOValor() {
            assertThat(render("{{uuid}}/{{uuid}}")).isEqualTo("${EVENT.uuid}/${EVENT.uuid}")
        }

        @Test
        @DisplayName("Dado espaços dentro das chaves, quando resolve, então os ignora")
        fun render_espacosDentroDasChaves_deveResolver() {
            assertThat(render("{{ seq }}-{{random  4}}")).matches("3-[A-Za-z0-9]{4}")
        }

        @Test
        @DisplayName("Dado random 256, quando resolve, então gera 256 alfanuméricos")
        fun render_randomNoLimite_deveGerarOTamanhoPedido() {
            assertThat(render("{{random 256}}")).matches("[A-Za-z0-9]{256}")
        }

        @Test
        @DisplayName("Dado duas resoluções do mesmo template, quando tem random, então os valores diferem")
        fun render_randomEmDuasResolucoes_deveMudar() {
            val template = Template.parse("{{random 32}}")

            assertThat(template.render(EVENT)).isNotEqualTo(template.render(EVENT))
        }

        @Test
        @DisplayName("Dado texto sem placeholder (e vazio), quando resolve, então fica igual")
        fun render_semPlaceholder_deveFicarIgual() {
            assertThat(render("")).isEmpty()
            assertThat(render("""{"a":{"b":1}} } { }}""")).isEqualTo("""{"a":{"b":1}} } { }}""")
        }
    }

    @Nested
    @DisplayName("Escape")
    inner class Escape {
        @Test
        @DisplayName("Dado {{{{, quando resolve, então vira {{ literal e o que segue não é placeholder")
        fun render_escape_deveVirarChavesLiterais() {
            assertThat(render("{{{{uuid}} e {{seq}}")).isEqualTo("{{uuid}} e 3")
        }

        @Test
        @DisplayName("Dado um template do Handlebars escapado, quando resolve, então o app recebe o template")
        fun render_handlebarsEscapado_deveChegarLiteral() {
            assertThat(render("{{{{#each itens}}{{{{this}}{{{{/each}}")).isEqualTo("{{#each itens}}{{this}}{{/each}}")
        }
    }

    @Nested
    @DisplayName("Erros de template")
    inner class Errors {
        @ParameterizedTest(name = "{0}")
        @ValueSource(strings = ["{{foo}}", "{{}}", "{{random}}", "{{random x}}", "{{UUID}}", "{{{uuid}}"])
        @DisplayName("Dado um placeholder desconhecido, quando lê o template, então recusa dizendo qual")
        fun parse_placeholderDesconhecido_deveRecusar(text: String) {
            assertThatIllegalArgumentException().isThrownBy { Template.parse("a $text b") }.withMessageContaining("unknown placeholder")
        }

        @ParameterizedTest(name = "{0}")
        @ValueSource(strings = ["{{random 0}}", "{{random 257}}"])
        @DisplayName("Dado random fora de 1..256, quando lê o template, então recusa")
        fun parse_randomForaDoLimite_deveRecusar(text: String) {
            assertThatIllegalArgumentException()
                .isThrownBy { Template.parse(text) }
                .withMessage("{{random N}} takes N from 1 to 256: $text")
        }

        @Test
        @DisplayName("Dado {{ sem fechar, quando lê o template, então recusa")
        fun parse_chavesSemFechar_deveRecusar() {
            assertThatIllegalArgumentException().isThrownBy { Template.parse("""{"a":"{{uuid"}""") }.withMessage("unclosed {{")
        }
    }
}
