package anzol.stats

import anzol.schema.SchemaState
import anzol.signature.SignatureResult
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.LocalDateTime

private val AT: LocalDateTime = LocalDateTime.of(2026, 9, 26, 14, 2, 7)

private fun sample(
    reason: String? = null,
    paths: Set<String> = emptySet(),
): StatsSample =
    StatsSample(
        seq = 1,
        createdAt = AT,
        method = "POST",
        signature = reason?.let { SignatureResult("stripe", valid = false, reason = it) },
        schemaState = if (paths.isEmpty()) null else SchemaState.INVALID,
        schemaPaths = paths,
        rule = null,
        nearMiss = null,
    )

@DisplayName("Resumo das mensagens (stats)")
class RequestStatsTest {
    @Test
    @DisplayName("Dado 12 motivos diferentes, quando resume, então lista os 10 mais frequentes, empate pelo texto")
    fun motivos_devemVirOsDezMaisFrequentes() {
        val distinct = (1..12).map { sample(reason = "motivo ${it.toString().padStart(2, '0')}") }
        val samples = distinct + sample(reason = "motivo 12") + sample(reason = "motivo 12")

        val reasons = samples.toStats(window = 500, total = 14).signature.reasons

        assertThat(reasons.map { it.reason }).containsExactly(
            "motivo 12",
            "motivo 01",
            "motivo 02",
            "motivo 03",
            "motivo 04",
            "motivo 05",
            "motivo 06",
            "motivo 07",
            "motivo 08",
            "motivo 09",
        )
        assertThat(reasons.first().count).isEqualTo(3)
    }

    @Test
    @DisplayName("Dado motivos com parêntese no meio e no fim, quando resume, então tira só o parêntese final")
    fun motivo_deveTirarSoOParenteseFinal() {
        val samples = listOf(sample(reason = "timestamp outside tolerance (412 s)"), sample(reason = "header (x) absent"))

        val reasons = samples.toStats(window = 500, total = 2).signature.reasons

        assertThat(reasons.map { it.reason }).containsExactly("header (x) absent", "timestamp outside tolerance")
    }

    @Test
    @DisplayName("Dado 11 caminhos de schema, quando resume, então lista 10, com a raiz como texto vazio")
    fun caminhos_devemVirOsDezMaisFrequentes() {
        val samples = listOf(sample(paths = (1..10).map { "/c$it" }.toSet() + ""), sample(paths = setOf("")))

        val paths = samples.toStats(window = 500, total = 2).schema.paths

        assertThat(paths).hasSize(10)
        assertThat(paths.first()).isEqualTo(PathCount("", 2))
    }
}
