package site.webhook.schema

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import site.webhook.rules.Parsed
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode

private val mapper = JsonMapper.builder().build()

/** O `schema` como o `LegacyInput` o entrega: o JSON do corpo lido como `Map`/`List`/escalar. */
private fun given(json: String): Any? = mapper.readValue(json, Any::class.java)

/** A mensagem do 422, ou `null` quando o schema é aceito. */
private fun rejection(json: String): String? =
    when (val parsed = readSchema(given(json))) {
        is Parsed.Valid -> null
        is Parsed.Invalid -> parsed.errors.getValue("schema").single()
    }

/** Um schema já gravado, sem passar pela leitura da API (como o que vem do Redis). */
private fun stored(json: String): SchemaConfig = SchemaConfig(mapper.readTree(json) as ObjectNode)

private const val ORDER =
    """{"type":"object","required":["id","total"],"properties":{"id":{"type":"integer"},"items":{"items":{"type":"string"}}}}"""

@DisplayName("Schema da URL: configuração e validação")
class SchemaValidationTest {
    @Nested
    @DisplayName("Configuração")
    inner class Configuration {
        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um schema válido nos dialetos aceitos, quando lê, então aceita o documento como veio")
        @ValueSource(
            strings = [
                """{"type":"object"}""",
                """{}""",
                """{"${'$'}defs":{"id":{"type":"integer"}},"properties":{"id":{"${'$'}ref":"#/${'$'}defs/id"}}}""",
                """{"properties":{"child":{"${'$'}ref":"#"}}}""",
                """{"${'$'}schema":"http://json-schema.org/draft-07/schema#","definitions":{"a":{}},"${'$'}ref":"#/definitions/a"}""",
                """{"${'$'}schema":"http://json-schema.org/draft-07/schema","type":"string"}""",
                """{"${'$'}schema":"https://json-schema.org/draft/2019-09/schema","type":"string"}""",
                """{"${'$'}schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}""",
            ],
        )
        fun readSchema_valido_deveAceitar(json: String) {
            val parsed = readSchema(given(json))

            assertThat(parsed).isEqualTo(Parsed.Valid(SchemaConfig(mapper.readTree(json) as ObjectNode)))
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado um schema inválido, quando lê, então recusa com o motivo")
        @CsvSource(
            delimiter = '|',
            textBlock = $$"""
            [1]                                                  | The schema is invalid: it must be a JSON object.
            "texto"                                              | The schema is invalid: it must be a JSON object.
            true                                                 | The schema is invalid: it must be a JSON object.
            {"type":5}                                           | The schema is invalid: /type: does not have a value in the enumeration ["array", "boolean", "integer", "null", "number", "object", "string"].
            {"required":"id"}                                    | The schema is invalid: /required: string found, array expected.
            {"pattern":"("}                                      | The schema is invalid: java.util.regex.PatternSyntaxException: Unclosed group near index 1.
            {"$ref":"#/$defs/nada"}                              | The schema is invalid: Reference /$defs/nada cannot be resolved.
            {"$ref":"#/$defs/a","$defs":{"a":{"$ref":"#/$defs/a"}}} | The schema is invalid: $ref cycle that never ends.
            {"$schema":"http://json-schema.org/draft-04/schema#"}   | The schema is invalid: unsupported $schema http://json-schema.org/draft-04/schema#.
            {"$schema":7}                                        | The schema is invalid: unsupported $schema 7.""",
        )
        fun readSchema_invalido_deveRecusarComOMotivo(
            json: String,
            message: String,
        ) {
            assertThat(rejection(json)).isEqualTo(message)
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado uma referência que não é interna, em qualquer nível, quando lê, então recusa sem buscar nada")
        @CsvSource(
            delimiter = '|',
            textBlock = $$"""
            {"$ref":"https://example.com/s.json"}                                    | $ref https://example.com/s.json
            {"properties":{"a":{"$ref":"classpath:application.yaml"}}}               | $ref classpath:application.yaml
            {"$id":"https://example.com/s","allOf":[{"$ref":"outro.json"}]}          | $ref outro.json
            {"$dynamicRef":"file:///etc/passwd"}                                     | $dynamicRef file:///etc/passwd""",
        )
        fun readSchema_referenciaExterna_deveRecusar(
            json: String,
            reference: String,
        ) {
            assertThat(rejection(json)).isEqualTo("The schema is invalid: $reference is not internal (only #… is allowed).")
        }

        @Test
        @DisplayName("Dado um \$schema aninhado que aponta para o classpath, quando lê, então o carregador recusa")
        fun readSchema_metaSchemaForaDoOficial_deveRecusar() {
            assertThat(rejection("""{"properties":{"x":{"${'$'}schema":"classpath:application.yaml"}}}"""))
                .isEqualTo("The schema is invalid: Schema from 'classpath:application.yaml' is not allowed to be loaded.")
        }

        @Test
        @DisplayName("Dado um schema de exatamente 64 KB e outro de 1 byte a mais, quando lê, então aceita o primeiro e recusa o segundo")
        fun readSchema_tamanho_deveRespeitarOTeto() {
            val frame = """{"description":""}"""
            val limit = """{"description":"${"d".repeat(MAX_SCHEMA_BYTES - frame.length)}"}"""
            val above = """{"description":"${"d".repeat(MAX_SCHEMA_BYTES - frame.length + 1)}"}"""

            assertThat(limit.toByteArray().size).isEqualTo(MAX_SCHEMA_BYTES)
            assertThat(rejection(limit)).isNull()
            assertThat(rejection(above)).isEqualTo("The schema is invalid: it is larger than 64 KB.")
        }
    }

    @Nested
    @DisplayName("Validação do corpo")
    inner class Validation {
        @Test
        @DisplayName("Dado um corpo que segue o schema, quando valida, então é válido sem erros")
        fun validate_corpoValido_deveSerValido() {
            val result = stored(ORDER).validate("""{"id":1,"total":10,"items":["a"]}""")

            assertThat(result).isEqualTo(SchemaResult(valid = true, errors = emptyList()))
        }

        @Test
        @DisplayName("Dado um corpo com erros, quando valida, então lista cada erro com o JSON Pointer da instância, em ordem")
        fun validate_corpoInvalido_deveListarOsErros() {
            val result = stored(ORDER).validate("""{"id":"x","items":["a",2]}""")

            assertThat(result).isEqualTo(
                SchemaResult(
                    valid = false,
                    errors =
                        listOf(
                            SchemaError("/id", "string found, integer expected"),
                            SchemaError("/items/1", "integer found, string expected"),
                            SchemaError("", "required property 'total' not found"),
                        ),
                ),
            )
        }

        @Test
        @DisplayName("Dado um corpo com 30 erros, quando valida, então guarda só os 20 primeiros, na ordem")
        fun validate_maisDe20Erros_deveGuardarOs20Primeiros() {
            val result = stored("""{"items":{"type":"string"}}""").validate((0 until 30).joinToString(",", "[", "]"))

            assertThat(result.valid).isFalse()
            assertThat(result.errors).hasSize(MAX_SCHEMA_ERRORS)
            assertThat(result.errors.map { it.path }).isEqualTo((0 until 20).map { "/$it" })
        }

        @ParameterizedTest(name = "\"{0}\"")
        @DisplayName("Dado um corpo vazio ou que não é JSON, quando valida, então é inválido com body is not JSON")
        @ValueSource(strings = ["", "   ", "a=1&b=2", "<xml/>", "{\"id\":1} sobra"])
        fun validate_corpoNaoJson_deveSerInvalido(body: String) {
            val result = stored(ORDER).validate(body)

            assertThat(result).isEqualTo(SchemaResult(valid = false, errors = listOf(SchemaError("", "body is not JSON"))))
        }

        @Test
        @DisplayName("Dado um schema draft-07, quando valida, então usa o dialeto do \$schema (format é asserção no draft-07)")
        fun validate_draft07_deveUsarODialetoDoDocumento() {
            val schema = """{"${'$'}schema":"http://json-schema.org/draft-07/schema#","properties":{"e":{"format":"email"}}}"""

            val result = stored(schema).validate("""{"e":"nao-e-email"}""")

            assertThat(result.errors.map { it.path }).containsExactly("/e")
        }

        @Test
        @DisplayName("Dado um schema gravado que estoura a pilha da biblioteca, quando valida, então vira valid false sem lançar")
        fun validate_falhaDaBiblioteca_naoDeveLancar() {
            val cycle = stored("""{"${'$'}ref":"#/${'$'}defs/a","${'$'}defs":{"a":{"${'$'}ref":"#/${'$'}defs/a"}}}""")

            val result = cycle.validate("{}")

            assertThat(result).isEqualTo(
                SchemaResult(valid = false, errors = listOf(SchemaError("", "validation too deep (\$ref recursion)"))),
            )
        }

        @Test
        @DisplayName("Dado um schema gravado que a biblioteca não compila, quando valida, então vira valid false com a mensagem dela")
        fun validate_schemaQueNaoCompila_naoDeveLancar() {
            val result = stored("""{"pattern":"("}""").validate("\"x\"")

            assertThat(result.valid).isFalse()
            assertThat(result.errors.single().message).contains("PatternSyntaxException")
        }
    }
}
