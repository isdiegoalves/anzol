package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import site.webhook.RequestId
import site.webhook.TokenId
import site.webhook.capture.CapturedRequest
import site.webhook.schema.SchemaError
import site.webhook.schema.SchemaResult
import site.webhook.signature.SignatureResult
import tools.jackson.databind.json.JsonMapper
import java.time.LocalDateTime
import java.util.UUID

private val mapper = JsonMapper.builder().build()

/** Regra válida a partir do JSON do Anexo A. */
private fun rule(json: String): Rule =
    when (val parsed = parseRule(mapper.readTree(json))) {
        is Parsed.Valid -> parsed.value
        is Parsed.Invalid -> error("regra inválida no teste: ${parsed.errors}")
    }

/** Regra só com `match`, para testar uma condição. */
private fun matching(match: String): Rule = rule("""{"name":"r","match":$match}""")

private fun input(
    method: String = "GET",
    path: String = "/",
    query: Map<String, String> = emptyMap(),
    headers: Map<String, String> = emptyMap(),
    body: String = "",
) = MatchInput(method = method, path = path, query = query, headers = headers, body = body)

/** Entrada com o resultado da verificação gravado. */
private fun signed(
    signature: SignatureResult?,
    body: String = "",
) = MatchInput(method = "GET", path = "/", query = emptyMap(), headers = emptyMap(), body = body, signature = signature)

/** Entrada com o resultado da validação do schema gravado. */
private fun validated(
    schema: SchemaResult?,
    signature: SignatureResult? = null,
) = MatchInput(method = "GET", path = "/", query = emptyMap(), headers = emptyMap(), body = "", signature = signature, schema = schema)

/** Resultado com [count] erros (0 = válido). */
private fun schemaResult(count: Int) = SchemaResult(valid = count == 0, errors = List(count) { SchemaError("/$it", "erro $it") })

@DisplayName("Motor de matching das regras de resposta")
class RuleMatchingTest {
    @Nested
    @DisplayName("Método e caminho")
    inner class MethodAndPath {
        @ParameterizedTest(name = "{0} com {1} → {2}")
        @DisplayName("Dado a lista de métodos da regra, quando compara com o da requisição, então casa qualquer um da lista, sem caixa")
        @CsvSource(
            delimiter = '|',
            nullValues = ["null"],
            textBlock = """
            ["POST"]        | POST | null
            ["post"]        | POST | null
            ["POST"]        | GET  | method: expected POST, got GET
            ["POST","PUT"]  | PUT  | null
            ["POST","PUT"]  | GET  | method: expected one of POST, PUT, got GET
            []              | GET  | null""",
        )
        fun failures_metodo_deveCasarPelaLista(
            methods: String,
            method: String,
            expected: String?,
        ) {
            assertThat(matching("""{"method":$methods}""").failures(input(method = method))).isEqualTo(listOfNotNull(expected))
        }

        @ParameterizedTest(name = "{0} com {1} → {2}")
        @DisplayName(
            "Dado uma condição de caminho, quando compara com o caminho após o token, então aplica igual, prefixo ou regex inteira",
        )
        @CsvSource(
            delimiter = '|',
            nullValues = ["null"],
            textBlock = """
            {"equals":"/pagamentos"}      | /pagamentos    | null
            {"equals":"/pagamentos"}      | /pagamentos/1  | path: expected "/pagamentos", got "/pagamentos/1"
            {"prefix":"/api"}             | /api/v1        | null
            {"prefix":"/api"}             | /apx           | path: expected prefix "/api", got "/apx"
            {"regex":"/pedidos/\\d+"}     | /pedidos/42    | null
            {"regex":"/pedidos/\\d+"}     | /pedidos/42/x  | path: expected to match "/pedidos/\\d+", got "/pedidos/42/x"
            {"equals":"/"}                | /              | null""",
        )
        fun failures_caminho_deveAplicarOperador(
            condition: String,
            path: String,
            expected: String?,
        ) {
            assertThat(matching("""{"path":$condition}""").failures(input(path = path))).isEqualTo(listOfNotNull(expected))
        }
    }

    @Nested
    @DisplayName("Query e cabeçalhos")
    inner class QueryAndHeaders {
        @ParameterizedTest(name = "{0} com tipo={1} → {2}")
        @DisplayName("Dado uma condição de query, quando o valor chega ou falta, então casa ou diz o motivo")
        @CsvSource(
            delimiter = '|',
            nullValues = ["null"],
            textBlock = """
            {"equals":"pix"}      | pix     | null
            {"equals":"pix"}      | boleto  | query tipo: expected "pix", got "boleto"
            {"equals":"pix"}      | null    | query tipo: absent
            {"contains":"ol"}     | boleto  | null
            {"contains":"pi"}     | boleto  | query tipo: expected to contain "pi", got "boleto"
            {"regex":"p.x"}       | pix     | null
            {"regex":"p"}         | pix     | query tipo: expected to match "p", got "pix"
            {"present":true}      | ''      | null
            {"present":true}      | null    | query tipo: absent
            {"present":false}     | null    | null
            {"present":false}     | pix     | query tipo: present""",
        )
        fun failures_query_deveAplicarOperador(
            condition: String,
            value: String?,
            expected: String?,
        ) {
            val query = if (value == null) emptyMap() else mapOf("tipo" to value)

            val failures = matching("""{"query":{"tipo":$condition}}""").failures(input(query = query))

            assertThat(failures).isEqualTo(listOfNotNull(expected))
        }

        @ParameterizedTest(name = "regra {0}")
        @DisplayName("Dado o nome do cabeçalho em qualquer caixa ou com underscore, quando compara, então acha o cabeçalho gravado")
        @CsvSource("X-Signature", "x-signature", "X-SIGNATURE", "X_Signature")
        fun failures_nomeDeCabecalho_deveIgnorarCaixa(name: String) {
            val rule = matching("""{"headers":{"$name":{"equals":"abc"}}}""")

            assertThat(rule.failures(input(headers = mapOf("x-signature" to "abc")))).isEmpty()
            assertThat(rule.failures(input(headers = mapOf("x-signature" to "xyz"))))
                .containsExactly("header x-signature: expected \"abc\", got \"xyz\"")
        }

        @Test
        @DisplayName("Dado um cabeçalho exigido que não veio, quando compara, então a frase diz absent com o nome em minúsculas")
        fun failures_cabecalhoAusente_deveDizerAbsent() {
            val rule = matching("""{"headers":{"X-Signature":{"present":true}}}""")

            assertThat(rule.failures(input())).containsExactly("header x-signature: absent")
        }
    }

    @Nested
    @DisplayName("Corpo")
    inner class Body {
        @ParameterizedTest(name = "{0} com {1} → {2}")
        @DisplayName("Dado uma condição de corpo em texto, quando compara, então aplica igual, contém ou regex inteira")
        @CsvSource(
            delimiter = '|',
            nullValues = ["null"],
            textBlock = """
            {"equals":"ok"}        | ok               | null
            {"equals":"ok"}        | OK               | body: expected "ok", got "OK"
            {"contains":"pedido"}  | novo pedido 1    | null
            {"contains":"pedido"}  | novo pagamento   | body: expected to contain "pedido"
            {"regex":"id=\\d+"}    | id=42            | null
            {"regex":"\\d+"}       | id=42            | body: expected to match "\\d+"
            {"regex":"a.b"}        | 'a
b'                                                    | null""",
        )
        fun failures_corpoTexto_deveAplicarOperador(
            condition: String,
            body: String,
            expected: String?,
        ) {
            assertThat(matching("""{"body":[$condition]}""").failures(input(body = body))).isEqualTo(listOfNotNull(expected))
        }

        @ParameterizedTest(name = "{0} com {1} → {2}")
        @DisplayName("Dado uma condição JSONPath, quando o corpo tem, não tem ou não é JSON, então casa ou diz o motivo")
        @CsvSource(
            delimiter = '|',
            nullValues = ["null"],
            textBlock = """
            {"path":"$.status","equals":"pago"}  | {"status":"pago"}           | null
            {"path":"$.status","equals":"pago"}  | {"status":"pendente"}       | body $.status: expected "pago", got "pendente"
            {"path":"$.status","equals":"pago"}  | {"outro":1}                 | body $.status: absent
            {"path":"$.status"}                  | {"status":null}             | null
            {"path":"$.status"}                  | {"x":1}                     | body $.status: absent
            {"path":"$.status"}                  | não é json                  | body $.status: body is not JSON
            {"path":"$.total","equals":10}       | {"total":10.0}              | null
            {"path":"$.total","equals":"10"}     | {"total":10}                | null
            {"path":"$.total","equals":10}       | {"total":"10"}              | body $.total: expected 10, got "10"
            {"path":"$.a","equals":{"b":1}}      | {"a":{"b":1}}               | null
            {"path":"$.itens[*].id","equals":2}  | {"itens":[{"id":1},{"id":2}]} | null
            {"path":"$.itens[*].id"}             | {"itens":[]}                | body $.itens[*].id: absent""",
        )
        fun failures_jsonPath_deveAplicarCaminho(
            condition: String,
            body: String,
            expected: String?,
        ) {
            val rule = matching("""{"body":[{"jsonPath":$condition}]}""")

            assertThat(rule.failures(input(body = body))).isEqualTo(listOfNotNull(expected))
        }

        @ParameterizedTest(name = "{0} com {1} → {2}")
        @DisplayName("Dado uma condição equalToJson, quando compara, então ignora ordem de chaves e espaço, mas não a de listas")
        @CsvSource(
            delimiter = '|',
            nullValues = ["null"],
            textBlock = """
            {"a":1,"b":{"c":[1,2]}}      | { "b" : {"c":[1,2]}, "a":1 }  | null
            "{\"a\":1,\"b\":2}"          | {"b":2,"a":1}                 | null
            {"a":1}                      | {"a":1.0}                     | null
            {"a":[1,2]}                  | {"a":[2,1]}                   | body: not equal to the expected JSON
            {"a":1}                      | {"a":1,"b":2}                 | body: not equal to the expected JSON
            {"a":1}                      | a=1                           | body: body is not JSON""",
        )
        fun failures_equalToJson_deveCompararArvores(
            expectedJson: String,
            body: String,
            expected: String?,
        ) {
            val rule = matching("""{"body":[{"equalToJson":$expectedJson}]}""")

            assertThat(rule.failures(input(body = body))).isEqualTo(listOfNotNull(expected))
        }
    }

    @Nested
    @DisplayName("Todas as condições em E")
    inner class AllConditions {
        @Test
        @DisplayName("Dado uma regra com várias condições, quando algumas falham, então lista uma frase por condição, na ordem da regra")
        fun failures_variasCondicoes_deveListarCadaUma() {
            val rule =
                matching(
                    """{"method":["POST"],"path":{"equals":"/p"},"query":{"a":{"present":true}},""" +
                        """"headers":{"X-A":{"equals":"1"}},"body":[{"contains":"x"},{"contains":"y"}]}""",
                )

            val failures = rule.failures(input(method = "POST", path = "/p", headers = mapOf("x-a" to "2"), body = "x"))

            assertThat(failures).containsExactly(
                "query a: absent",
                "header x-a: expected \"1\", got \"2\"",
                "body: expected to contain \"y\"",
            )
        }

        @Test
        @DisplayName("Dado uma regra sem condições, quando compara com qualquer requisição, então casa")
        fun failures_semCondicoes_deveCasarSempre() {
            assertThat(rule("""{"name":"tudo"}""").failures(input(method = "DELETE", path = "/x", body = "y"))).isEmpty()
        }
    }

    @Nested
    @DisplayName("Escolha da regra")
    inner class Decide {
        private fun named(
            name: String,
            priority: Int,
            match: String = "{}",
            enabled: Boolean = true,
        ) = rule("""{"name":"$name","priority":$priority,"enabled":$enabled,"match":$match}""")

        @Test
        @DisplayName("Dado duas regras que casam, quando decide, então vence a de menor prioridade, mesmo depois na lista")
        fun decide_duasQueCasam_deveEscolherMenorPrioridade() {
            val decision = listOf(named("cinco", 5), named("um", 1)).decide(input())

            assertThat(decision).isEqualTo(Decision.Matched(named("um", 1).withIdOf(decision)))
            assertThat((decision as Decision.Matched).rule.name).isEqualTo("um")
        }

        @Test
        @DisplayName("Dado duas regras de mesma prioridade que casam, quando decide, então vence a primeira da lista")
        fun decide_empateDePrioridade_deveEscolherPrimeiraDaLista() {
            val decision = listOf(named("primeira", 3), named("segunda", 3)).decide(input())

            assertThat((decision as Decision.Matched).rule.name).isEqualTo("primeira")
        }

        @Test
        @DisplayName("Dado a regra de menor prioridade desativada, quando decide, então ela não responde e a próxima vence")
        fun decide_regraDesativada_naoDeveResponder() {
            val decision = listOf(named("desligada", 1, enabled = false), named("ligada", 9)).decide(input())

            assertThat((decision as Decision.Matched).rule.name).isEqualTo("ligada")
        }

        @Test
        @DisplayName("Dado regras ativas e nenhuma casando, quando decide, então o near miss é a de menos condições falhando")
        fun decide_nenhumaCasa_deveApontarAMaisProxima() {
            val longe = named("longe", 1, """{"method":["POST"],"path":{"equals":"/a"}}""")
            val perto = named("perto", 9, """{"method":["GET"],"path":{"equals":"/a"}}""")

            val decision = listOf(longe, perto).decide(input(method = "GET", path = "/b"))

            assertThat(decision).isEqualTo(
                Decision.Unmatched(NearMiss(perto.id, "perto", listOf("path: expected \"/a\", got \"/b\""))),
            )
        }

        @Test
        @DisplayName("Dado duas regras com o mesmo número de falhas, quando decide, então o near miss é a de menor prioridade")
        fun decide_empateNoNearMiss_deveUsarPrioridade() {
            val segunda = named("segunda", 7, """{"method":["POST"]}""")
            val primeira = named("primeira", 2, """{"method":["PUT"]}""")

            val decision = listOf(segunda, primeira).decide(input())

            assertThat((decision as Decision.Unmatched).nearMiss?.name).isEqualTo("primeira")
        }

        @Test
        @DisplayName("Dado só regras desativadas ou nenhuma regra, quando decide, então não casa e não há near miss")
        fun decide_semRegrasAtivas_naoDeveTerNearMiss() {
            val desligada = named("desligada", 1, """{"method":["POST"]}""", enabled = false)

            assertThat(listOf(desligada).decide(input())).isEqualTo(Decision.Unmatched(null))
            assertThat(emptyList<Rule>().decide(input())).isEqualTo(Decision.Unmatched(null))
        }

        @Test
        @DisplayName("Dado uma regra de cenário no estado exigido, quando decide, então ela responde")
        fun decide_cenarioNoEstadoExigido_deveResponder() {
            val passo = rule("""{"name":"passo","scenario":{"name":"pedido","requiredState":"pago","newState":"enviado"}}""")

            val decision = listOf(passo).decide(input(), states = mapOf("pedido" to "pago"))

            assertThat((decision as Decision.Matched).rule.scenario).isEqualTo(RuleScenario("pedido", "pago", "enviado"))
        }

        @Test
        @DisplayName("Dado um cenário sem estado gravado, quando decide, então o estado é Started")
        fun decide_cenarioSemEstado_deveUsarStarted() {
            val inicio = rule("""{"name":"início","scenario":{"name":"pedido","requiredState":"Started"}}""")

            assertThat(listOf(inicio).decide(input())).isInstanceOf(Decision.Matched::class.java)
        }

        @Test
        @DisplayName("Dado uma regra de cenário fora do estado exigido, quando decide, então não responde e o near miss diz o estado")
        fun decide_cenarioForaDoEstado_deveApontarNoNearMiss() {
            val passo = rule("""{"name":"passo","match":{"method":["POST"]},"scenario":{"name":"pedido","requiredState":"pago"}}""")

            val decision = listOf(passo).decide(input(), states = mapOf("pedido" to "novo"))

            assertThat(decision).isEqualTo(
                Decision.Unmatched(
                    NearMiss(
                        passo.id,
                        "passo",
                        listOf("method: expected POST, got GET", "scenario pedido: expected state \"pago\", got \"novo\""),
                    ),
                ),
            )
        }

        @Test
        @DisplayName("Dado uma regra de cenário sem requiredState, quando decide, então casa em qualquer estado")
        fun decide_cenarioSemEstadoExigido_deveCasarSempre() {
            val qualquer = rule("""{"name":"qualquer","scenario":{"name":"pedido","newState":"x"}}""")

            assertThat(listOf(qualquer).decide(input(), states = mapOf("pedido" to "outro"))).isInstanceOf(Decision.Matched::class.java)
        }

        /** O `id` é gerado na leitura; a comparação usa o da regra escolhida. */
        private fun Rule.withIdOf(decision: Decision) = copy(id = (decision as Decision.Matched).rule.id)
    }

    @Nested
    @DisplayName("Mensagem gravada vista pelo matching")
    inner class FromMessage {
        private val tokenId = TokenId(UUID.fromString("11111111-2222-4333-8444-555555555555"))

        private fun message(
            url: String,
            query: String? = null,
        ) = CapturedRequest(
            uuid = RequestId(UUID.randomUUID()),
            tokenId = tokenId,
            ip = "1.1.1.1",
            hostname = "localhost",
            method = "POST",
            userAgent = null,
            content = "{\"a\":1}",
            query = query?.let(mapper::readTree),
            headers = mapOf("x-signature" to listOf("abc"), "content-type" to listOf("")),
            url = url,
            createdAt = LocalDateTime.of(2026, 9, 26, 0, 0),
            updatedAt = LocalDateTime.of(2026, 9, 26, 0, 0),
        )

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado a url gravada, quando extrai o caminho, então é o que vem depois do token, decodificado, com vazio virando /")
        @CsvSource(
            "http://localhost:8084/11111111-2222-4333-8444-555555555555, /",
            "http://localhost/11111111-2222-4333-8444-555555555555/pagamentos?x=1, /pagamentos",
            "http://[::1]:8080/11111111-2222-4333-8444-555555555555/caf%C3%A9/a+b, /café/a+b",
            "http://localhost/11111111-2222-4333-8444-555555555555/100%, /100%",
        )
        fun toMatchInput_url_deveExtrairCaminhoAposToken(
            url: String,
            expected: String,
        ) {
            assertThat(message(url).toMatchInput().path).isEqualTo(expected)
        }

        @Test
        @DisplayName("Dado a query e os cabeçalhos gravados, quando monta a entrada, então usa o valor de cada nome e o texto do resto")
        fun toMatchInput_queryECabecalhos_deveUsarOsValoresGravados() {
            val matchInput = message("http://localhost/x", """{"tipo":"pix","n":"1","lista":["a","b"]}""").toMatchInput()

            assertThat(matchInput.method).isEqualTo("POST")
            assertThat(matchInput.query).containsEntry("tipo", "pix").containsEntry("lista", """["a","b"]""")
            assertThat(matchInput.headers).containsEntry("x-signature", "abc").containsEntry("content-type", "")
            assertThat(matchInput.body).isEqualTo("{\"a\":1}")
        }

        @Test
        @DisplayName("Dado uma query gravada como lista do PHP, quando monta a entrada, então os nomes são os índices")
        fun toMatchInput_queryLista_deveUsarIndices() {
            assertThat(message("http://localhost/x", """["a","b"]""").toMatchInput().query).isEqualTo(mapOf("0" to "a", "1" to "b"))
        }
    }

    @Nested
    @DisplayName("Assinatura")
    inner class Signature {
        @ParameterizedTest(name = "espera {0}, recebe valid={1} reason={2} → {3}")
        @DisplayName("Dado a condição de assinatura, quando compara com o resultado gravado, então casa o estado ou diz o recebido")
        @CsvSource(
            delimiter = '|',
            nullValues = ["null"],
            textBlock = """
            valid   | true  | null                              | null
            invalid | false | signature mismatch                | null
            absent  | false | header X-Hub-Signature-256 absent | null
            valid   | false | signature mismatch                | signature: expected valid, got invalid (signature mismatch)
            valid   | false | header X-Hub-Signature-256 absent | signature: expected valid, got absent (header X-Hub-Signature-256 absent)
            invalid | true  | null                              | signature: expected invalid, got valid
            absent  | false | malformed header                  | signature: expected absent, got invalid (malformed header)""",
        )
        fun failures_assinatura_deveCompararOEstado(
            expected: String,
            valid: Boolean,
            reason: String?,
            failure: String?,
        ) {
            val signature = SignatureResult("github", valid, reason)

            val failures = matching("""{"signature":"$expected"}""").failures(signed(signature))

            assertThat(failures).isEqualTo(listOfNotNull(failure))
        }

        @Test
        @DisplayName("Dado uma URL sem assinatura configurada, quando a regra exige um estado, então falha como não configurada")
        fun failures_semConfiguracao_deveDizerNaoConfigurada() {
            val failures = matching("""{"signature":"absent"}""").failures(signed(null))

            assertThat(failures).containsExactly("signature: expected absent, got not configured")
        }

        @Test
        @DisplayName("Dado condições de corpo e de assinatura falhando, quando lista as falhas, então a assinatura vem depois do corpo")
        fun failures_corpoEAssinatura_deveListarAAssinaturaPorUltimo() {
            val rule = matching("""{"body":[{"contains":"x"}],"signature":"valid"}""")

            val failures = rule.failures(signed(SignatureResult("github", false, "signature mismatch"), body = "y"))

            assertThat(failures).containsExactly(
                "body: expected to contain \"x\"",
                "signature: expected valid, got invalid (signature mismatch)",
            )
        }
    }

    @Nested
    @DisplayName("Schema")
    inner class Schema {
        @ParameterizedTest(name = "espera {0}, recebe {1} erros → {2}")
        @DisplayName("Dado a condição de schema, quando compara com o resultado gravado, então casa o estado ou diz o recebido")
        @CsvSource(
            delimiter = '|',
            nullValues = ["null"],
            textBlock = """
            valid   | 0  | null
            invalid | 2  | null
            valid   | 3  | schema: expected valid, got invalid (3 errors)
            valid   | 20 | schema: expected valid, got invalid (20 errors)
            invalid | 0  | schema: expected invalid, got valid""",
        )
        fun failures_schema_deveCompararOEstado(
            expected: String,
            errors: Int,
            failure: String?,
        ) {
            val failures = matching("""{"schema":"$expected"}""").failures(validated(schemaResult(errors)))

            assertThat(failures).isEqualTo(listOfNotNull(failure))
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado uma URL sem schema configurado, quando a regra exige um estado, então falha como não configurado")
        @CsvSource("valid", "invalid")
        fun failures_semConfiguracao_deveDizerNaoConfigurado(expected: String) {
            val failures = matching("""{"schema":"$expected"}""").failures(validated(null))

            assertThat(failures).containsExactly("schema: expected $expected, got not configured")
        }

        @Test
        @DisplayName("Dado assinatura e schema falhando, quando lista as falhas, então o schema vem depois da assinatura")
        fun failures_assinaturaESchema_deveListarOSchemaPorUltimo() {
            val rule = matching("""{"signature":"valid","schema":"valid"}""")

            val failures = rule.failures(validated(schemaResult(1), SignatureResult("github", false, "signature mismatch")))

            assertThat(failures).containsExactly(
                "signature: expected valid, got invalid (signature mismatch)",
                "schema: expected valid, got invalid (1 errors)",
            )
        }
    }
}
