package anzol.cli

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource

@DisplayName("Atalhos do wait-for montam o match")
class MatchShortcutsTest {
    private fun json(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

    private fun jsonPath(shortcut: String): JsonObject = MatchShortcuts(jsonPaths = listOf(shortcut)).applyTo(JsonObject(emptyMap()))

    @Test
    @DisplayName("Dado nenhum atalho nem --match, quando monta, então o match é {} (casa qualquer mensagem)")
    fun applyTo_semNada_deveSerVazio() {
        assertThat(MatchShortcuts().applyTo(JsonObject(emptyMap()))).isEqualTo(json("{}"))
    }

    @Test
    @DisplayName("Dado cada atalho, quando monta, então vira a condição da regra: método em lista, prefixo, equals, contains e jsonPath")
    fun applyTo_atalhos_deveMontarAsCondicoes() {
        val shortcuts =
            MatchShortcuts(
                methods = listOf("POST", "PUT"),
                pathPrefix = "/pedidos",
                headers = mapOf("X-Conta" to "7"),
                bodyContains = "pedido",
                jsonPaths = listOf("$.status=pago", "$.id"),
            )

        assertThat(shortcuts.applyTo(JsonObject(emptyMap()))).isEqualTo(
            json(
                """{"method":["POST","PUT"],"path":{"prefix":"/pedidos"},"headers":{"X-Conta":{"equals":"7"}},""" +
                    """"body":[{"contains":"pedido"},{"jsonPath":{"path":"$.status","equals":"pago"}},{"jsonPath":{"path":"$.id"}}]}""",
            ),
        )
    }

    @Test
    @DisplayName("Dado um --match, quando há atalhos, então eles se somam e o de mesma chave de topo substitui a do --match")
    fun applyTo_comMatch_deveSubstituirAMesmaChave() {
        val base = json("""{"method":["GET"],"query":{"tipo":{"equals":"pix"}},"body":[{"contains":"velho"}]}""")

        val match = MatchShortcuts(methods = listOf("POST"), bodyContains = "novo").applyTo(base)

        assertThat(match).isEqualTo(json("""{"method":["POST"],"query":{"tipo":{"equals":"pix"}},"body":[{"contains":"novo"}]}"""))
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado --json-path com =, quando monta, então o resto depois do primeiro = é JSON, ou texto se não for JSON")
    @CsvSource(
        delimiter = '|',
        quoteCharacter = '`',
        value = [
            "$.valor=10        | 10",
            "$.valor=\"10\"    | \"10\"",
            "$.status=pago     | \"pago\"",
            "$.ok=true         | true",
            "$.x=null          | null",
            "$.obj={\"a\":[1]} | {\"a\":[1]}",
            "$.obj={\"a\":pago}| \"{\\\"a\\\":pago}\"",
            "$.expr=a=b        | \"a=b\"",
            "$.vazio=          | \"\"",
        ],
    )
    fun applyTo_jsonPathComValor_deveLerJsonOuTexto(
        shortcut: String,
        equals: String,
    ) {
        val path = shortcut.substringBefore('=')

        assertThat(jsonPath(shortcut)).isEqualTo(json("""{"body":[{"jsonPath":{"path":"$path","equals":$equals}}]}"""))
    }
}
