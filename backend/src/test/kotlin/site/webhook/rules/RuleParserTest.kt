package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import tools.jackson.databind.json.JsonMapper
import java.math.BigDecimal
import java.time.Instant

@DisplayName("Leitura e validação das regras (422 do Anexo A)")
class RuleParserTest {
    private val mapper = JsonMapper.builder().build()

    private fun errorsOf(json: String): Map<String, List<String>> =
        when (val parsed = parseRules(mapper.readTree(json))) {
            is Parsed.Valid -> emptyMap()
            is Parsed.Invalid -> parsed.errors
        }

    private fun valid(json: String): List<Rule> =
        when (val parsed = parseRules(mapper.readTree(json))) {
            is Parsed.Valid -> parsed.value
            is Parsed.Invalid -> error("esperava válida: ${parsed.errors}")
        }

    @Nested
    @DisplayName("Lista")
    inner class RuleList {
        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um corpo que não é lista, quando lê as regras, então responde rules: must be an array")
        @CsvSource(delimiter = '|', value = ["{}", "\"x\"", "1", "null"])
        fun parseRules_naoLista_deveRecusar(json: String) {
            assertThat(errorsOf(json)).isEqualTo(mapOf("rules" to listOf("The rules must be an array.")))
        }

        @Test
        @DisplayName("Dado 101 regras, quando lê, então recusa pelo teto de 100; com 100, aceita")
        fun parseRules_acimaDoTeto_deveRecusar() {
            val rules = { count: Int -> (1..count).joinToString(",", "[", "]") { """{"name":"r$it"}""" } }

            assertThat(errorsOf(rules(101))).isEqualTo(mapOf("rules" to listOf("The rules may not have more than 100 items.")))
            assertThat(valid(rules(100))).hasSize(100)
        }

        @Test
        @DisplayName("Dado uma lista vazia, quando lê, então é válida e sem regras")
        fun parseRules_listaVazia_deveSerValida() {
            assertThat(valid("[]")).isEmpty()
        }

        @Test
        @DisplayName("Dado duas regras com o mesmo id, quando lê, então a segunda é recusada por duplicata")
        fun parseRules_idRepetido_deveRecusarASegunda() {
            val id = "0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41"

            val errors = errorsOf("""[{"id":"$id","name":"a"},{"id":"$id","name":"b"}]""")

            assertThat(errors).isEqualTo(mapOf("1.id" to listOf("The id field has a duplicate value.")))
        }
    }

    @Nested
    @DisplayName("Padrões")
    inner class Defaults {
        @Test
        @DisplayName("Dado uma regra só com nome, quando lê, então gera id e aplica os padrões do Anexo A")
        fun parseRules_soNome_deveAplicarPadroes() {
            val rule = valid("""[{"name":"mínima"}]""").single()

            assertThat(rule.id.value.toString()).matches("[0-9a-f-]{36}")
            assertThat(rule.enabled).isTrue()
            assertThat(rule.priority).isEqualTo(5)
            assertThat(rule.match).isEqualTo(RuleMatch())
            assertThat(rule.response).isEqualTo(RuleResponse(status = 200, headers = emptyMap(), body = ""))
        }

        @Test
        @DisplayName("Dado uma regra com id, quando lê, então mantém o id enviado")
        fun parseRules_comId_deveManterId() {
            val rule = valid("""[{"id":"0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41","name":"a"}]""").single()

            assertThat(rule.id.toString()).isEqualTo("0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41")
        }
    }

    @Nested
    @DisplayName("Campos da regra")
    inner class Fields {
        @ParameterizedTest(name = "{0} → {1}: {2}")
        @DisplayName(
            "Dado um campo inválido, quando lê a lista, então a chave em pontos a partir do índice leva a mensagem no estilo Laravel",
        )
        @CsvSource(
            delimiter = '|',
            textBlock = """
            "x"                                                  | 0                          | The rule must be an object.
            {"id":"abc","name":"a"}                              | 0.id                       | The id must be a valid UUID.
            {}                                                   | 0.name                     | The name field is required.
            {"name":""}                                          | 0.name                     | The name field is required.
            {"name":7}                                           | 0.name                     | The name must be a string.
            {"name":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"} | 0.name | The name may not be greater than 100 characters.
            {"name":"a","enabled":"sim"}                         | 0.enabled                  | The enabled field must be true or false.
            {"name":"a","priority":0}                            | 0.priority                 | The priority must be at least 1.
            {"name":"a","priority":1.5}                          | 0.priority                 | The priority must be an integer.
            {"name":"a","priority":"2"}                          | 0.priority                 | The priority must be an integer.
            {"name":"a","match":[]}                              | 0.match                    | The match must be an object.
            {"name":"a","match":{"method":"POST"}}               | 0.match.method             | The method must be an array.
            {"name":"a","match":{"method":["POST",1]}}           | 0.match.method.1           | The method must be a string.
            {"name":"a","match":{"path":{}}}                     | 0.match.path               | The path must have exactly one of: equals, prefix, regex.
            {"name":"a","match":{"path":{"equals":"/","prefix":"/"}}} | 0.match.path          | The path must have exactly one of: equals, prefix, regex.
            {"name":"a","match":{"path":"/x"}}                   | 0.match.path               | The path must be an object.
            {"name":"a","match":{"path":{"equals":1}}}           | 0.match.path.equals        | The equals must be a string.
            {"name":"a","match":{"path":{"regex":"(abc"}}}       | 0.match.path.regex         | The regex is invalid.
            {"name":"a","match":{"query":[]}}                    | 0.match.query              | The query must be an object.
            {"name":"a","match":{"query":{"tipo":"pix"}}}        | 0.match.query.tipo         | The condition must be an object.
            {"name":"a","match":{"query":{"tipo":{}}}}           | 0.match.query.tipo         | The condition must have exactly one of: equals, contains, regex, present.
            {"name":"a","match":{"query":{"tipo":{"contains":1}}}} | 0.match.query.tipo.contains | The contains must be a string.
            {"name":"a","match":{"headers":{"X-Canal":{"regex":"["}}}} | 0.match.headers.X-Canal.regex | The regex is invalid.
            {"name":"a","match":{"headers":{"X-A":{"present":"sim"}}}} | 0.match.headers.X-A.present | The present field must be true or false.
            {"name":"a","match":{"body":{}}}                     | 0.match.body               | The body must be an array.
            {"name":"a","match":{"body":["x"]}}                  | 0.match.body.0             | The condition must be an object.
            {"name":"a","match":{"body":[{"equals":"a","contains":"b"}]}} | 0.match.body.0    | The condition must have exactly one of: equals, contains, regex, jsonPath, equalToJson.
            {"name":"a","match":{"body":[{"jsonPath":"$.a"}]}}   | 0.match.body.0.jsonPath    | The jsonPath must be an object.
            {"name":"a","match":{"body":[{"jsonPath":{}}]}}      | 0.match.body.0.jsonPath.path | The path field is required.
            {"name":"a","match":{"body":[{"jsonPath":{"path":"$['status'"}}]}} | 0.match.body.0.jsonPath.path | The path is invalid.
            {"name":"a","match":{"body":[{"jsonPath":{"path":"$.a."}}]}} | 0.match.body.0.jsonPath.path | The path is invalid.
            {"name":"a","match":{"body":[{"equalToJson":"{a"}]}} | 0.match.body.0.equalToJson | The equalToJson must be a valid JSON string.
            {"name":"a","scenario":"s"}                          | 0.scenario                 | The scenario must be an object.
            {"name":"a","scenario":{}}                           | 0.scenario.name            | The name field is required.
            {"name":"a","scenario":{"name":" "}}                 | 0.scenario.name            | The name field is required.
            {"name":"a","scenario":{"name":1}}                   | 0.scenario.name            | The name must be a string.
            {"name":"a","scenario":{"name":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}} | 0.scenario.name | The name may not be greater than 100 characters.
            {"name":"a","scenario":{"name":"s","requiredState":1}} | 0.scenario.requiredState | The requiredState must be a string.
            {"name":"a","scenario":{"name":"s","newState":""}}   | 0.scenario.newState        | The newState field is required.
            {"name":"a","response":"ok"}                         | 0.response                 | The response must be an object.
            {"name":"a","response":{"status":99}}                | 0.response.status          | The status must be between 100 and 599.
            {"name":"a","response":{"status":600}}               | 0.response.status          | The status must be between 100 and 599.
            {"name":"a","response":{"status":"200"}}             | 0.response.status          | The status must be an integer.
            {"name":"a","response":{"headers":[]}}               | 0.response.headers         | The headers must be an object.
            {"name":"a","response":{"headers":{"X-A":1}}}        | 0.response.headers.X-A     | The header value must be a string.
            {"name":"a","response":{"headers":{"X A":"1"}}}      | 0.response.headers.X A     | The header name is invalid.
            {"name":"a","response":{"headers":{"X-A":"1\r\nX-B: 2"}}} | 0.response.headers.X-A | The header value is invalid.
            {"name":"a","response":{"body":{"a":1}}}             | 0.response.body            | The body must be a string.
            {"name":"a","response":{"template":true,"body":"{{foo 'x'}}"}} | 0.response.body | The template is invalid: could not find helper: 'foo' (line 1, column 2).
            {"name":"a","response":{"template":true,"headers":{"X-A":"{{> p}}"}}} | 0.response.headers.X-A | The template is invalid: partials are not supported.
            {"name":"a","response":{"template":"não"}}           | 0.response.template        | The template field must be true or false.
            {"name":"a","response":{"delay":"10"}}               | 0.response.delay           | The delay must be an object.
            {"name":"a","response":{"delay":{}}}                 | 0.response.delay           | The delay must have exactly one of: fixed, uniform, lognormal.
            {"name":"a","response":{"delay":{"fixed":1,"uniform":{"min":1,"max":2}}}} | 0.response.delay | The delay must have exactly one of: fixed, uniform, lognormal.
            {"name":"a","response":{"delay":{"fixed":60001}}}    | 0.response.delay.fixed     | The fixed must be between 0 and 60000.
            {"name":"a","response":{"delay":{"fixed":-1}}}       | 0.response.delay.fixed     | The fixed must be between 0 and 60000.
            {"name":"a","response":{"delay":{"fixed":1.5}}}      | 0.response.delay.fixed     | The fixed must be an integer.
            {"name":"a","response":{"delay":{"uniform":[1,2]}}}  | 0.response.delay.uniform   | The uniform must be an object.
            {"name":"a","response":{"delay":{"uniform":{"min":10}}}} | 0.response.delay.uniform.max | The max field is required.
            {"name":"a","response":{"delay":{"uniform":{"min":10,"max":5}}}} | 0.response.delay.uniform.max | The max must be greater than or equal to the min.
            {"name":"a","response":{"delay":{"uniform":{"min":0,"max":60001}}}} | 0.response.delay.uniform.max | The max must be between 0 and 60000.
            {"name":"a","response":{"delay":{"lognormal":{"median":0,"sigma":0.5}}}} | 0.response.delay.lognormal.median | The median must be between 1 and 60000.
            {"name":"a","response":{"delay":{"lognormal":{"median":"x","sigma":0.5}}}} | 0.response.delay.lognormal.median | The median must be a number.
            {"name":"a","response":{"delay":{"lognormal":{"median":100,"sigma":-1}}}} | 0.response.delay.lognormal.sigma | The sigma must be between 0 and 10.
            {"name":"a","response":{"delay":{"lognormal":{"median":100}}}} | 0.response.delay.lognormal.sigma | The sigma field is required.
            {"name":"a","response":{"dribble":"sim"}}            | 0.response.dribble         | The dribble must be an object.
            {"name":"a","response":{"dribble":{"chunks":0,"durationMs":10}}} | 0.response.dribble.chunks | The chunks must be between 1 and 100.
            {"name":"a","response":{"dribble":{"chunks":101,"durationMs":10}}} | 0.response.dribble.chunks | The chunks must be between 1 and 100.
            {"name":"a","response":{"dribble":{"chunks":2,"durationMs":60001}}} | 0.response.dribble.durationMs | The durationMs must be between 0 and 60000.
            {"name":"a","response":{"dribble":{"chunks":2}}}     | 0.response.dribble.durationMs | The durationMs field is required.
            {"name":"a","response":{"fault":"timeout"}}          | 0.response.fault           | The selected fault is invalid.
            {"name":"a","response":{"fault":1}}                  | 0.response.fault           | The selected fault is invalid.""",
        )
        fun parseRules_campoInvalido_deveResponderChaveEMensagem(
            rule: String,
            key: String,
            message: String,
        ) {
            assertThat(errorsOf("[$rule]")).isEqualTo(mapOf(key to listOf(message)))
        }

        @Test
        @DisplayName("Dado erros em duas regras, quando lê, então cada chave leva o índice da sua regra")
        fun parseRules_errosEmDuasRegras_deveUsarOIndiceDeCada() {
            val errors = errorsOf("""[{"name":"ok"},{"priority":0}]""")

            assertThat(errors).isEqualTo(
                mapOf("1.name" to listOf("The name field is required."), "1.priority" to listOf("The priority must be at least 1.")),
            )
        }

        @Test
        @DisplayName("Dado campos nulos das fases seguintes, quando lê, então aceita como ausentes")
        fun parseRules_camposFuturosNulos_deveAceitar() {
            val rule = """{"name":"a","scenario":null,"response":{"template":false,"delay":null,"dribble":null,"fault":null}}"""

            assertThat(valid("[$rule]")).hasSize(1)
        }
    }

    @Nested
    @DisplayName("Atraso, dribble e falha")
    inner class Timing {
        @Test
        @DisplayName("Dado os três tipos de atraso, dribble e cada falha, quando lê, então guarda os valores")
        fun parseRules_atrasoDribbleFalha_deveGuardarOsValores() {
            val rules =
                valid(
                    """[{"name":"a","response":{"delay":{"fixed":0},"dribble":{"chunks":100,"durationMs":60000}}},""" +
                        """{"name":"b","response":{"delay":{"uniform":{"min":5,"max":5}}}},""" +
                        """{"name":"c","response":{"delay":{"lognormal":{"median":60000,"sigma":0.25}},"fault":"connection_reset"}},""" +
                        """{"name":"d","response":{"fault":"empty_response"}},{"name":"e","response":{"fault":"malformed_chunk"}},""" +
                        """{"name":"f","response":{"fault":"random_data_then_close"}}]""",
                )

            assertThat(rules.map { it.response.delay }).containsExactly(
                Delay.Fixed(0),
                Delay.Uniform(5, 5),
                Delay.LogNormal(BigDecimal("60000"), BigDecimal("0.25")),
                null,
                null,
                null,
            )
            assertThat(rules[0].response.dribble).isEqualTo(Dribble(chunks = 100, durationMs = 60000))
            assertThat(rules.mapNotNull { it.response.fault }).containsExactly(
                Fault.CONNECTION_RESET,
                Fault.EMPTY_RESPONSE,
                Fault.MALFORMED_CHUNK,
                Fault.RANDOM_DATA_THEN_CLOSE,
            )
        }
    }

    @Nested
    @DisplayName("Cenário")
    inner class Scenario {
        @Test
        @DisplayName("Dado um cenário completo, quando lê, então guarda nome, estado exigido e novo estado")
        fun parseRules_cenario_deveGuardarOsTresCampos() {
            val rule = valid("""[{"name":"a","scenario":{"name":"pedido","requiredState":"Started","newState":"pago"}}]""").single()

            assertThat(rule.scenario).isEqualTo(RuleScenario(name = "pedido", requiredState = "Started", newState = "pago"))
        }

        @Test
        @DisplayName("Dado um cenário só com nome, quando lê, então estado exigido e novo estado ficam nulos")
        fun parseRules_cenarioSoNome_deveDeixarEstadosNulos() {
            assertThat(valid("""[{"name":"a","scenario":{"name":"pedido"}}]""").single().scenario).isEqualTo(RuleScenario("pedido"))
        }
    }

    @Nested
    @DisplayName("Template")
    inner class Template {
        @Test
        @DisplayName("Dado template ligado com corpo e cabeçalhos válidos, quando lê, então aceita e guarda o texto como veio")
        fun parseRules_templateValido_deveAceitar() {
            val rule =
                valid(
                    """[{"name":"a","response":{"template":true,"headers":{"X-Id":"{{jsonPath request.body '$.id'}}"},""" +
                        """"body":"{\"seq\":{{seq}} }"}}]""",
                ).single()

            assertThat(rule.response.template).isTrue()
            assertThat(rule.response.body).isEqualTo("{\"seq\":{{seq}} }")
            assertThat(rule.response.headers).containsEntry("X-Id", "{{jsonPath request.body '$.id'}}")
        }

        @Test
        @DisplayName("Dado template desligado com texto que não é template válido, quando lê, então aceita: o texto sai literal")
        fun parseRules_templateDesligado_naoDeveValidar() {
            assertThat(valid("""[{"name":"a","response":{"body":"{{foo 'x'"}}]""")).hasSize(1)
        }

        @Test
        @DisplayName("Dado erro de sintaxe no corpo, quando lê, então o 422 vai na chave do corpo com o motivo")
        fun parseRules_erroDeSintaxe_deveRecusarNoCorpo() {
            val errors = errorsOf("""[{"name":"a","response":{"template":true,"body":"{{request.method"}}]""")

            assertThat(errors.keys).containsExactly("0.response.body")
            assertThat(errors["0.response.body"]).singleElement().asString().startsWith("The template is invalid: ")
        }
    }

    @Nested
    @DisplayName("Regra única do rules/test")
    inner class Single {
        @Test
        @DisplayName("Dado uma regra inválida no rules/test, quando lê, então as chaves vêm sem o índice")
        fun parseRule_invalida_deveUsarChaveSemIndice() {
            val parsed = parseRule(mapper.readTree("""{"name":"a","match":{"path":{"regex":"("}}}"""))

            assertThat(parsed).isEqualTo(Parsed.Invalid(mapOf("match.path.regex" to listOf("The regex is invalid."))))
        }

        @Test
        @DisplayName("Dado um corpo que não é objeto no rules/test, quando lê, então a chave é rule")
        fun parseRule_naoObjeto_deveUsarChaveRule() {
            assertThat(parseRule(mapper.readTree("[]"))).isEqualTo(Parsed.Invalid(mapOf("rule" to listOf("The rule must be an object."))))
        }
    }

    @Nested
    @DisplayName("Chance e janela")
    inner class ChanceAndWindow {
        @Test
        @DisplayName("Dado chance 1, 50 e 100, ausente ou nula, quando lê, então guarda o número ou nada")
        fun parseRules_chance_deveGuardarONumero() {
            val rules =
                valid(
                    """[{"name":"a","chance":1},{"name":"b","chance":50},{"name":"c","chance":100},{"name":"d"},""" +
                        """{"name":"e","chance":null}]""",
                )

            assertThat(rules.map { it.chance }).containsExactly(1, 50, 100, null, null)
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado uma chance fora de 1..100 ou não inteira, quando lê, então recusa em 0.chance com a mensagem de cada caso")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            0     | The chance must be between 1 and 100.
            101   | The chance must be between 1 and 100.
            -5    | The chance must be between 1 and 100.
            1.5   | The chance must be an integer.
            "20"  | The chance must be an integer.
            true  | The chance must be an integer.
            {}    | The chance must be an integer.""",
        )
        fun parseRules_chanceInvalida_deveRecusar(
            chance: String,
            message: String,
        ) {
            assertThat(errorsOf("""[{"name":"x","chance":$chance}]""")).isEqualTo(mapOf("0.chance" to listOf(message)))
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado uma data-hora com fuso, com ou sem fração, quando lê, então guarda em UTC cortada no segundo")
        @CsvSource(
            "2026-09-29T12:00:00Z, 2026-09-29T12:00:00Z",
            "2026-09-29T12:00:00.789Z, 2026-09-29T12:00:00Z",
            "2026-09-29T09:00:00-03:00, 2026-09-29T12:00:00Z",
            "2026-09-29T12:00:00+00:00, 2026-09-29T12:00:00Z",
            "2026-09-29t12:00:00.123456789z, 2026-09-29T12:00:00Z",
        )
        fun parseRules_dataHora_deveGuardarEmUtcNoSegundo(
            text: String,
            expected: String,
        ) {
            val rule = valid("""[{"name":"x","active_from":"$text","active_until":"2099-01-01T00:00:00Z"}]""").single()

            assertThat(rule.activeFrom).isEqualTo(Instant.parse(expected))
            assertThat(rule.activeUntil).isEqualTo(Instant.parse("2099-01-01T00:00:00Z"))
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName(
            "Dado um texto que não é data-hora com fuso, ou um valor que não é texto, quando lê, então recusa com a mensagem do formato",
        )
        @CsvSource(
            delimiter = '|',
            textBlock = """
            "2026-09-29"
            "2026-09-29T12:00:00"
            "2026-09-29T12:00Z"
            "2026-02-30T12:00:00Z"
            "amanhã"
            ""
            1759147200
            true""",
        )
        fun parseRules_dataHoraInvalida_deveRecusar(value: String) {
            val format = "must be an ISO-8601 date-time with a time zone, like 2026-09-29T12:00:00Z."

            assertThat(errorsOf("""[{"name":"x","active_from":$value}]"""))
                .isEqualTo(mapOf("0.active_from" to listOf("The active from $format")))
            assertThat(errorsOf("""[{"name":"x","active_until":$value}]"""))
                .isEqualTo(mapOf("0.active_until" to listOf("The active until $format")))
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName(
            "Dado active_until igual ou antes de active_from depois do corte no segundo, quando lê, então recusa em 0.active_until",
        )
        @CsvSource(
            "2026-09-29T12:00:00Z, 2026-09-29T12:00:00Z",
            "2026-09-29T12:00:00Z, 2026-09-29T11:00:00Z",
            "2026-09-29T12:00:00.100Z, 2026-09-29T12:00:00.900Z",
        )
        fun parseRules_janelaInvertida_deveRecusar(
            from: String,
            until: String,
        ) {
            assertThat(errorsOf("""[{"name":"x","active_from":"$from","active_until":"$until"}]"""))
                .isEqualTo(mapOf("0.active_until" to listOf("The active until must be a date after active from.")))
        }

        @Test
        @DisplayName("Dado chance e janela inválidas no rules/test, quando lê, então as chaves vêm sem o índice")
        fun parseRule_chanceEJanelaInvalidas_deveUsarChaveSemIndice() {
            val parsed = parseRule(mapper.readTree("""{"name":"x","chance":0,"active_from":"amanhã"}"""))

            assertThat(parsed).isEqualTo(
                Parsed.Invalid(
                    mapOf(
                        "chance" to listOf("The chance must be between 1 and 100."),
                        "active_from" to
                            listOf("The active from must be an ISO-8601 date-time with a time zone, like 2026-09-29T12:00:00Z."),
                    ),
                ),
            )
        }
    }

    @Nested
    @DisplayName("Falhas que prendem ou cortam a resposta")
    inner class HeldFaults {
        @Test
        @DisplayName("Dado hang, stall_after_headers e truncated_body, quando lê, então guarda cada falha; hang aceita corpo vazio")
        fun parseRules_falhasNovas_deveGuardar() {
            val rules =
                valid(
                    """[{"name":"a","response":{"fault":"hang"}},""" +
                        """{"name":"b","response":{"body":"x","fault":"stall_after_headers"}},""" +
                        """{"name":"c","response":{"body":"x","fault":"truncated_body"}}]""",
                )

            assertThat(rules.map { it.response.fault }).containsExactly(Fault.HANG, Fault.STALL_AFTER_HEADERS, Fault.TRUNCATED_BODY)
        }

        @ParameterizedTest(name = "{0} com {1}")
        @DisplayName("Dado stall_after_headers ou truncated_body sem corpo, quando lê, então recusa em 0.response.body")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            stall_after_headers | {"fault":"stall_after_headers"}
            stall_after_headers | {"body":"","fault":"stall_after_headers"}
            stall_after_headers | {"body":null,"fault":"stall_after_headers"}
            truncated_body      | {"fault":"truncated_body"}
            truncated_body      | {"body":"","fault":"truncated_body"}""",
        )
        fun parseRules_falhaSemCorpo_deveRecusar(
            fault: String,
            response: String,
        ) {
            assertThat(errorsOf("""[{"name":"x","response":$response}]"""))
                .isEqualTo(mapOf("0.response.body" to listOf("The body field is required when fault is $fault.")))
        }

        @Test
        @DisplayName("Dado um corpo que não é texto com stall_after_headers, quando lê, então só o erro do tipo aparece")
        fun parseRules_corpoNaoTexto_deveDarSoOErroDoTipo() {
            val errors = errorsOf("""[{"name":"x","response":{"body":1,"fault":"stall_after_headers"}}]""")

            assertThat(errors).isEqualTo(mapOf("0.response.body" to listOf("The body must be a string.")))
        }
    }
}
