package anzol.ai

import anzol.e2ee.READ_SECRET
import anzol.e2ee.ecKey
import anzol.e2ee.envelope
import anzol.e2ee.json
import anzol.e2ee.policy
import anzol.privacy.SECRET_HEADER
import anzol.support.AiApiTest
import anzol.support.ApiClient
import anzol.support.FakeLlm
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * O bloco `check` do suggest: a regra que o modelo devolveu, conferida pelo servidor sem o modelo. As regras erradas
 * são as do estudo: caminho inventado, `{{…}}` sem template e sequência numa regra só.
 */
@AiApiTest
@DisplayName("POST /token/{id}/rules/suggest: bloco check")
class AiSuggestCheckApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    @BeforeEach
    fun reset() = FakeLlm.reset()

    /** O suggest com o modelo devolvendo [rule]; a resposta inteira. */
    private fun suggest(
        tokenId: String,
        rule: String,
        prompt: String = "responda 201 para POST em /pagamentos",
        requestId: String? = null,
        headers: Map<String, String> = emptyMap(),
    ): JsonNode {
        FakeLlm.answer("""{"rule": $rule, "explanation": "texto do modelo"}""")
        val example = requestId?.let { ""","request_id":"$it"""" }.orEmpty()
        val body = """{"prompt":"$prompt"$example}""".toByteArray()
        val response = api.send("POST", "/token/$tokenId/rules/suggest", body, JSON_BODY + headers)
        assertThat(response.statusCode()).`as`(response.body()).isEqualTo(200)
        return api.json(response)
    }

    private fun JsonNode.codes(): List<String> = this["check"]["warnings"].toList().map { it["code"].asString() }

    /** Duas mensagens em `/pagamentos` (a segunda é o exemplo) e uma em `/outro`; devolve o uuid do exemplo. */
    private fun seed(tokenId: String): String {
        api.capture(tokenId, "POST", "/pagamentos", """{"id":7}""".toByteArray())
        val example = api.capture(tokenId, "POST", "/pagamentos", """{"id":42}""".toByteArray())["uuid"].asString()
        api.capture(tokenId, "GET", "/outro")
        return example
    }

    @Test
    @DisplayName("Dado a regra certa e o exemplo, quando sugere, então example casa, recent conta as que casariam e não há avisos")
    fun suggest_regraCerta_deveConferirSemAvisos() {
        val tokenId = api.tokenId()
        val example = seed(tokenId)

        val body = suggest(tokenId, """{"name":"p","match":{"method":["POST"],"path":{"equals":"/pagamentos"}}}""", requestId = example)

        assertThat(body.propertyNames().toList()).containsExactly("rule", "explanation", "attempts", "check")
        assertThat(body["check"]).isEqualTo(
            api.tree("""{"example":{"matches":true,"failed":[],"conditions":[]},"recent":{"evaluated":3,"matched":2},"warnings":[]}"""),
        )
        assertThat(body["explanation"].asString()).isEqualTo("texto do modelo")
        assertThat(FakeLlm.received).hasSize(1)
    }

    @Test
    @DisplayName("Dado uma URL sem mensagens e nenhum exemplo, quando sugere, então example null, recent 0 de 0 e nenhum aviso de caminho")
    fun suggest_urlVazia_naoDeveAvisarDoCaminho() {
        val body = suggest(api.tokenId(), """{"name":"p","match":{"path":{"equals":"/pagamentos"}}}""")

        assertThat(body["check"]).isEqualTo(api.tree("""{"example":null,"recent":{"evaluated":0,"matched":0},"warnings":[]}"""))
    }

    @Test
    @DisplayName(
        "Dado tudo errado (caminho inventado, {{ sem template, sequência numa regra só), quando sugere, então os quatro avisos, " +
            "as frases do rules/test, uma chamada só ao modelo e nada gravado",
    )
    fun suggest_tudoErrado_deveSomarOsAvisos() {
        val tokenId = api.tokenId()
        val example = seed(tokenId)

        val body =
            suggest(
                tokenId,
                """{"name":"e","match":{"path":{"equals":"/"}},"response":{"status":503,"headers":{"X-Seq":"{{seq}}"}}}""",
                prompt = "falhe 3 vezes com 503 e depois responda 200",
                requestId = example,
            )

        assertThat(body["check"]["example"]).isEqualTo(
            api.tree("""{"matches":false,"failed":["path: expected \"/\", got \"/pagamentos\""],"conditions":["match.path"]}"""),
        )
        assertThat(body["check"]["recent"]).isEqualTo(api.tree("""{"evaluated":3,"matched":0}"""))
        assertThat(body.codes()).containsExactly("example_not_matched", "template_disabled", "path_never_seen", "sequence_as_single_rule")
        assertThat(body["check"]["warnings"].toList().map { it["message"].asString() }).allMatch { it.isNotBlank() && it.endsWith(".") }
        assertThat(body["attempts"].asInt()).isEqualTo(1)
        assertThat(FakeLlm.received).hasSize(1)
        assertThat(api.json(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT)).size()).isZero()
    }

    /** URL que decifra com quatro recusas recentes: duas em claro (`downgrade`), uma sem atributo e uma sem JSON. */
    private fun refusedDecryptions(): Pair<String, String> {
        val tokenId = api.tokenId(json(mapOf("read_secret" to READ_SECRET, "e2ee" to policy(ecKey("remetente-sig-1")))))

        fun deliver(body: String): String =
            api
                .send("POST", "/$tokenId", body.toByteArray(), mapOf("Content-Type" to "application/json"))
                .headers()
                .firstValue("X-Request-Id")
                .orElseThrow()
        deliver("{}")
        deliver("não é json")
        deliver(envelope("evt-1", mapOf("ok" to true)))
        return tokenId to deliver(envelope("evt-2", mapOf("ok" to false)))
    }

    @Test
    @DisplayName(
        "Dado decryption: invalid e recusas recentes por outros motivos, quando sugere a partir de uma em claro, então avisa " +
            "que a regra responde também às outras recusas, com os motivos contados nas recentes",
    )
    fun suggest_decifraInvalida_deveAvisarDosOutrosMotivos() {
        val (tokenId, example) = refusedDecryptions()
        val secret = mapOf(SECRET_HEADER to READ_SECRET)

        val body =
            suggest(
                tokenId,
                """{"name":"em claro","match":{"decryption":"invalid"},"response":{"status":400}}""",
                prompt = "responda 400 quando o atributo vier em claro",
                requestId = example,
                headers = secret,
            )

        assertThat(body.codes()).containsExactly("decryption_matches_other_reasons")
        assertThat(body["check"]["warnings"][0]["message"].asString()).isEqualTo(
            "match.decryption invalid answers every refused decryption, not only downgrade: 4 of the last 4 requests " +
                "match, with reasons downgrade (2), attribute_missing (1), body_not_json (1).",
        )
        assertThat(FakeLlm.received).hasSize(1)
    }

    @Test
    @DisplayName(
        "Dado decryption: invalid sem exemplo e recusas recentes por mais de um motivo, quando sugere, então avisa que a regra " +
            "responde a todas as recusas",
    )
    fun suggest_decifraInvalidaSemExemplo_deveAvisarQueRespondeATodas() {
        val (tokenId, _) = refusedDecryptions()

        val body =
            suggest(
                tokenId,
                """{"name":"recusa","match":{"decryption":"invalid"},"response":{"status":400}}""",
                headers = mapOf(SECRET_HEADER to READ_SECRET),
            )

        assertThat(body["check"]["warnings"][0]["message"].asString()).isEqualTo(
            "match.decryption invalid answers every refused decryption: 4 of the last 4 requests match, with reasons " +
                "downgrade (2), attribute_missing (1), body_not_json (1).",
        )
    }

    @Test
    @DisplayName(
        "Dado uma regra que só casa as recusas do motivo do exemplo, quando sugere, então nenhum aviso de decifra",
    )
    fun suggest_decifraInvalidaSoDoMotivo_naoDeveAvisar() {
        val (tokenId, example) = refusedDecryptions()
        val secret = mapOf(SECRET_HEADER to READ_SECRET)

        val narrow =
            suggest(
                tokenId,
                """{"name":"em claro","match":{"decryption":"invalid","body":[{"jsonPath":{"path":"$.payload.ok","present":true}}]}}""",
                requestId = example,
                headers = secret,
            )
        val valid = suggest(tokenId, """{"name":"ok","match":{"decryption":"valid"}}""", requestId = example, headers = secret)

        assertThat(narrow.codes()).isEmpty()
        assertThat(valid.codes()).doesNotContain("decryption_matches_other_reasons")
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado o texto do pedido, quando sugere uma regra sem cenário, então só o que tem forma de sequência ganha o aviso")
    @CsvSource(
        delimiter = '|',
        textBlock = """
        falhe 3 vezes com 503 e depois responda 200              | true
        fail 3 times with 503 then respond 200                   | true
        falhe 2x e em seguida responda 201 (marcador-abc)        | true
        responda 429 com Retry-After 5 para POST em /pagamentos  | false
        respond 503 to every request                             | false
        depois de 5 segundos responda 200                        | false""",
    )
    fun suggest_formaDeSequencia_deveAvisarSoQuandoTem(
        prompt: String,
        sequence: Boolean,
    ) {
        val tokenId = api.tokenId()

        val single = suggest(tokenId, """{"name":"f","response":{"status":503}}""", prompt)
        val step =
            suggest(
                tokenId,
                """{"name":"f","scenario":{"name":"r","requiredState":"Started","newState":"f1"},"response":{"status":503}}""",
                prompt,
            )

        assertThat(single.codes()).isEqualTo(if (sequence) listOf("sequence_as_single_rule") else emptyList())
        assertThat(step.codes()).isEmpty()
    }
}
