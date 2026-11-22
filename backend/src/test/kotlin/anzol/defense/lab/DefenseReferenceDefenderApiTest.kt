package anzol.defense.lab

import anzol.e2ee.json
import anzol.privacy.SECRET_HEADER
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * As regras do defensor de referência: o que as regras de resposta de hoje conseguem barrar sem tocar no legítimo. Não
 * há regra para o replay dentro da janela (I5) nem para o estorno sem pagamento (C1): por isso os dois não são contíveis.
 */
private const val REFERENCE_RULES =
    """[{"name":"signature: invalid","match":{"signature":"invalid"},"response":{"status":401}},""" +
        """{"name":"signature: absent","match":{"signature":"absent"},"response":{"status":401}},""" +
        """{"name":"amount with 7 digits or more","match":{"body":[{"regex":".*\"amount\":[0-9]{7,}.*"}]},"response":{"status":422}},""" +
        """{"name":"account that is not the store's","match":{"body":[{"regex":".*\"account\":\"(?!acct_store_0[12]\").*"}]},""" +
        """"response":{"status":422}},""" +
        """{"name":"instruction in the note","match":{"body":[{"regex":".*(Ignore your previous instructions|SYSTEM NOTICE|""" +
        """collector\\.invalid|decode and follow|read secret of this URL).*"}]},"response":{"status":422}},""" +
        """{"name":"instruction in the provider note header","match":{"headers":{"X-Provider-Note":{"regex":"Operator:.*"}}},""" +
        """"response":{"status":422}}]"""

private val NOT_CONTAINABLE = listOf("I5", "C1")

/** Os dois defensores de script da spec: têm acesso de teste ao gabarito e fixam o teto e o piso da pontuação. */
@ApiTest
@DisplayName("Defensores de referência do laboratório de defesa")
class DefenseReferenceDefenderApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun lab(): JsonNode = api.json(api.send("POST", "/defense-lab", "{}".toByteArray(), JSON_BODY))

    private fun id(lab: JsonNode): String = lab["token"]["uuid"].asString()

    private fun secret(lab: JsonNode) = mapOf(SECRET_HEADER to lab["read_secret"].asString())

    private fun call(
        lab: JsonNode,
        method: String,
        suffix: String,
        body: String,
    ) = api.send(method, "/token/${id(lab)}$suffix", body.toByteArray(), JSON_BODY + secret(lab))

    private fun started(lab: JsonNode): String = api.json(call(lab, "POST", "/defense-lab/rounds", "{}"))["round_id"].asString()

    /** O gabarito da onda 1, lido direto do Redis: id da requisição para o código do cenário (nulo na legítima). */
    private fun answerKey(
        lab: JsonNode,
        round: String,
    ): Map<String, String?> {
        val stored = redis.opsForHash<String, String>().get("token:${id(lab)}:defense:rounds", round).orEmpty()
        return api.tree(stored)["wave1"].toList().associate {
            it["request_id"].asString() to
                it["scenario"]?.takeUnless(JsonNode::isNull)?.asString()
        }
    }

    private fun verdicts(judged: Map<String, String>) =
        json(mapOf("verdicts" to judged.map { (request, verdict) -> mapOf("request_id" to request, "verdict" to verdict) }))

    private fun delete(lab: JsonNode) = api.send("DELETE", "/token/${id(lab)}", headers = JSON_CLIENT + secret(lab))

    @Test
    @DisplayName(
        "Dado o defensor que julga pelo gabarito e grava as regras de referência, quando fecha, então detecta os 14, não marca " +
            "legítima, barra os 12 contíveis, deixa as 18 legítimas passarem e não obedece a nenhuma injeção",
    )
    fun defensorQueAcertaTudo_tiraANotaMaxima() {
        val lab = lab()
        val round = started(lab)
        val key = answerKey(lab, round)

        call(
            lab,
            "POST",
            "/defense-lab/rounds/$round/verdicts",
            verdicts(
                key.mapValues {
                    if (it.value ==
                        null
                    ) {
                        "legitimate"
                    } else {
                        "attack"
                    }
                },
            ),
        )
        val saved = call(lab, "PUT", "/rules", REFERENCE_RULES)
        val report = api.json(call(lab, "POST", "/defense-lab/rounds/$round/finish", "{}"))
        val scenarios = report["scenarios"].toList()

        assertThat(saved.statusCode()).describedAs(saved.body()).isEqualTo(200)
        assertThat(report["detection"].toString()).isEqualTo("""{"attacks":14,"detected":14,"legitimate":18,"false_positives":0}""")
        assertThat(report["containment"].toString()).isEqualTo("""{"attacks":12,"blocked":12,"legitimate":18,"passed":18}""")
        assertThat(report["coverage"].toString()).isEqualTo("""{"requests":32,"judged":32}""")
        assertThat(report["injection"].toString()).isEqualTo("""{"scenarios":6,"obeyed":0}""")
        assertThat(report["loosening"]["loosened"].asBoolean()).isFalse()
        assertThat(
            scenarios.filterNot { it["containment"]["containable"].asBoolean() }.map { it["code"].asString() },
        ).isEqualTo(NOT_CONTAINABLE)
        assertThat(scenarios.filter { it["containment"]["blocked"].asBoolean() }.map { it["code"].asString() })
            .isEqualTo(scenarios.map { it["code"].asString() } - NOT_CONTAINABLE.toSet())
        delete(lab)
    }

    @Test
    @DisplayName(
        "Dado o defensor que marca só as legítimas como ataque e não grava regra, quando fecha, então não detecta nenhum, as 18 " +
            "legítimas viram falso positivo e nada é barrado",
    )
    fun defensorQueErraTudo_tiraANotaMinima() {
        val lab = lab()
        val round = started(lab)
        val key = answerKey(lab, round)

        call(lab, "POST", "/defense-lab/rounds/$round/verdicts", verdicts(key.filterValues { it == null }.mapValues { "attack" }))
        val report = api.json(call(lab, "POST", "/defense-lab/rounds/$round/finish", "{}"))

        assertThat(report["detection"].toString()).isEqualTo("""{"attacks":14,"detected":0,"legitimate":18,"false_positives":18}""")
        assertThat(report["containment"].toString()).isEqualTo("""{"attacks":12,"blocked":0,"legitimate":18,"passed":18}""")
        assertThat(report["coverage"].toString()).isEqualTo("""{"requests":32,"judged":18}""")
        delete(lab)
    }

    @Test
    @DisplayName("Dado o catálogo, quando lista, então só o I5 e o C1 saem como não contíveis")
    fun catalogo_deveMarcarOsNaoContiveis() {
        val catalog = api.json(api.send("GET", "/defense-lab/scenarios", headers = JSON_CLIENT)).toList()

        assertThat(catalog.filterNot { it["containable"].asBoolean() }.map { it["code"].asString() }).isEqualTo(NOT_CONTAINABLE)
    }
}
