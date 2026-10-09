package anzol.ai

import anzol.e2ee.DecryptionState
import anzol.rules.Fault
import anzol.rules.Parsed
import anzol.rules.Rule
import anzol.rules.parseRule
import anzol.schema.SchemaConfig
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EnumSource
import org.springframework.core.io.ClassPathResource
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode
import java.time.Instant

private val mapper = JsonMapper.builder().build()

private val suggestionSchema =
    SchemaConfig(mapper.readTree(ClassPathResource("ai/rule-suggestion.schema.json").inputStream) as ObjectNode).compile()

/** As violações do schema de saída do suggest, como mensagens. */
private fun schemaErrors(suggestion: JsonNode): List<String> = suggestionSchema.validate(suggestion).map { it.toString() }

private fun parsed(suggestion: JsonNode): Rule =
    when (val parsed = parseRule(suggestion["rule"])) {
        is Parsed.Valid -> parsed.value
        is Parsed.Invalid -> error("esperava válida: ${parsed.errors}")
    }

@DisplayName("Schema de saída do rules/suggest")
class RuleSuggestionSchemaTest {
    @Test
    @DisplayName(
        "Dada uma sugestão com chance, janela com fuso e fração e truncated_body, quando confere, " +
            "então passa pelo schema e pelo parser",
    )
    fun schema_chanceJanelaEFalhaNova_devePassarPeloSchemaEPeloParser() {
        val suggestion =
            mapper.readTree(
                """{"explanation": "Corta metade do corpo em 30% dos POST durante a manutenção.",
                "rule": {"name": "manutenção instável", "chance": 30,
                "active_from": "2026-09-29T09:00:00-03:00", "active_until": "2026-09-29T12:30:00.500Z",
                "match": {"method": ["POST"]},
                "response": {"status": 200, "body": "{\"ok\":true}", "fault": "truncated_body"}}}""",
            )

        assertThat(schemaErrors(suggestion)).isEmpty()
        val rule = parsed(suggestion)
        assertThat(rule.chance).isEqualTo(30)
        assertThat(rule.activeFrom).isEqualTo(Instant.parse("2026-09-29T12:00:00Z"))
        assertThat(rule.activeUntil).isEqualTo(Instant.parse("2026-09-29T12:30:00Z"))
        assertThat(rule.response.fault).isEqualTo(Fault.TRUNCATED_BODY)
    }

    @ParameterizedTest(name = "{0}")
    @EnumSource(Fault::class)
    @DisplayName("Dada cada falha que o parser aceita, quando uma sugestão a usa, então passa pelo schema e pelo parser")
    fun schema_cadaFalhaDoParser_devePassarPeloSchemaEPeloParser(fault: Fault) {
        val suggestion =
            mapper.readTree(
                """{"explanation": "Falha.",
                "rule": {"name": "falha", "match": {}, "response": {"body": "abc", "fault": "${fault.value}"}}}""",
            )

        assertThat(schemaErrors(suggestion)).isEmpty()
        assertThat(parsed(suggestion).response.fault).isEqualTo(fault)
    }

    @ParameterizedTest(name = "{0}")
    @EnumSource(DecryptionState::class)
    @DisplayName("Dado cada estado da decifra, quando uma sugestão o usa no match, então passa pelo schema e pelo parser")
    fun schema_cadaEstadoDaDecifra_devePassarPeloSchemaEPeloParser(state: DecryptionState) {
        val suggestion =
            mapper.readTree(
                """{"explanation": "Decifra.",
                "rule": {"name": "decifra", "match": {"decryption": "${state.id}"}, "response": {"status": 500}}}""",
            )

        assertThat(schemaErrors(suggestion)).isEmpty()
        assertThat(parsed(suggestion).match.decryption).isEqualTo(state)
    }
}
