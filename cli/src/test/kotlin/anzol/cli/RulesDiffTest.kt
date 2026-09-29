package anzol.cli

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

private const val ID = "0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41"

/** A regra salva como o servidor a devolve: janela em UTC, cortada no segundo. */
private val saved =
    rule("""{"id": "$ID", "name": "manutenção", "active_from": "2026-09-29T12:00:00Z", "active_until": "2026-09-29T12:30:00Z"}""")

private fun rule(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

private fun window(
    from: String,
    until: String,
): JsonObject = rule("""{"id": "$ID", "name": "manutenção", "active_from": "$from", "active_until": "$until"}""")

@DisplayName("Resumo do push --dry-run")
class RulesDiffTest {
    @Test
    @DisplayName("Dada a janela escrita com fuso -03:00 e fração de segundo, quando compara com a salva em UTC, então a regra é igual")
    fun diffRules_janelaComFusoEFracao_deveSerIgual() {
        val diff = diffRules(listOf(saved), listOf(window("2026-09-29T09:00:00.750-03:00", "2026-09-29t12:30:00.5z")))

        assertThat(diff).isEqualTo(rule("""{"equal": ["$ID"], "changed": [], "removed": [], "added": []}"""))
    }

    @Test
    @DisplayName("Dada a janela que abre um minuto depois, com fuso, quando compara com a salva, então só active_from mudou")
    fun diffRules_janelaDeslocada_deveMudarActiveFrom() {
        val diff = diffRules(listOf(saved), listOf(window("2026-09-29T09:01:00-03:00", "2026-09-29T12:30:00Z")))

        assertThat(diff["changed"]).isEqualTo(
            Json.parseToJsonElement("""[{"id": "$ID", "name": "manutenção", "fields": ["active_from"]}]"""),
        )
    }

    @Test
    @DisplayName("Dada uma janela que não é data-hora com fuso, quando compara, então aparece como alterada, como veio")
    fun diffRules_janelaInvalida_deveAparecerComoAlterada() {
        val diff = diffRules(listOf(saved), listOf(window("2026-09-29T12:00:00", "2026-09-29T12:30:00Z")))

        assertThat(diff["changed"]).isEqualTo(
            Json.parseToJsonElement("""[{"id": "$ID", "name": "manutenção", "fields": ["active_from"]}]"""),
        )
    }
}
