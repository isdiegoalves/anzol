package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import site.webhook.search.parseSearch
import site.webhook.wait.parseWait
import tools.jackson.databind.json.JsonMapper

private val mapper = JsonMapper.builder().build()

/** Condição de corpo com um filtro JSONPath que usa `=~` (a regex do filtro roda na biblioteca, sem o teto). */
private const val REGEX_FILTER = """{"body":[{"jsonPath":{"path":"$[?(@.nome =~ /((a+)*)+$/)]"}}]}"""

private const val REFUSAL = "The path may not use the regex operator =~; use the regex condition instead."

private fun errors(parsed: Parsed<*>): Map<String, List<String>> =
    when (parsed) {
        is Parsed.Valid -> emptyMap()
        is Parsed.Invalid -> parsed.errors
    }

@DisplayName("Filtro JSONPath com =~ nas condições de corpo")
class JsonPathRegexFilterTest {
    @Test
    @DisplayName("Dado um jsonPath com =~, quando salva, testa, busca ou espera, então 422 no path com a frase que aponta o operador regex")
    fun parse_filtroComRegex_deveRecusar() {
        val rule = parseRule(mapper.readTree("""{"name":"r","match":$REGEX_FILTER}"""))
        val search = parseSearch("""{"match":$REGEX_FILTER}""")
        val wait = parseWait("""{"match":$REGEX_FILTER}""")

        assertThat(errors(rule)).containsExactly(java.util.Map.entry("match.body.0.jsonPath.path", listOf(REFUSAL)))
        assertThat(errors(search)).containsExactly(java.util.Map.entry("match.body.0.jsonPath.path", listOf(REFUSAL)))
        assertThat(errors(wait)).containsExactly(java.util.Map.entry("match.body.0.jsonPath.path", listOf(REFUSAL)))
    }

    @Test
    @DisplayName("Dado um jsonPath com filtro sem =~, quando salva, então aceita como sempre")
    fun parse_filtroSemRegex_deveAceitar() {
        val rule = parseRule(mapper.readTree("""{"name":"r","match":{"body":[{"jsonPath":{"path":"$[?(@.nome == 'a')]"}}]}}"""))

        assertThat(rule).isInstanceOf(Parsed.Valid::class.java)
    }

    @Test
    @DisplayName("Dado uma lista gravada antes com =~, quando lê do Redis, então continua lida (a recusa vale ao salvar)")
    fun parseRules_gravadaComFiltroRegex_deveLer() {
        val stored = parseRules(mapper.readTree("""[{"name":"r","match":$REGEX_FILTER}]"""), checkTemplates = false)

        assertThat(stored).isInstanceOf(Parsed.Valid::class.java)
    }
}
