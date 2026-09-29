package anzol.rules

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.http.HttpResponse
import java.util.UUID

@ApiTest
@DisplayName("Trace das regras de uma mensagem (GET /token/{id}/request/{rid}/rules/trace)")
class RuleTraceApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun putRules(
        tokenId: String,
        rules: String,
    ): JsonNode {
        val saved = api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY)
        check(saved.statusCode() == 200) { saved.body() }
        return api.json(saved)
    }

    private fun trace(
        tokenId: String,
        requestId: String,
    ): HttpResponse<String> = api.send("GET", "/token/$tokenId/request/$requestId/rules/trace", headers = JSON_CLIENT)

    @Test
    @DisplayName(
        "Dado uma regra que não casou e outra que respondeu, quando pede o trace, então cada regra vem na ordem de avaliação " +
            "com as frases e chaves do near miss, e as desligadas no fim sem posição",
    )
    fun trace_outraRegraRespondeu_deveExplicarCadaRegra() {
        val tokenId = api.tokenId()
        val saved =
            putRules(
                tokenId,
                """[{"name":"resto","priority":9},{"name":"desligada","enabled":false,"match":{"method":["DELETE"]}},""" +
                    """{"name":"acme","priority":1,"match":{"headers":{"X-Tenant":{"equals":"acme"}}}}]""",
            )
        val (resto, desligada, acme) = saved.toList().map { it["id"].asString() }
        val message = api.capture(tokenId, headers = mapOf("X-Tenant" to "outra"))

        val response = trace(tokenId, message["uuid"].asString())

        assertThat(response.statusCode()).`as`(response.body()).isEqualTo(200)
        assertThat(api.json(response)).isEqualTo(
            api.tree(
                """{"request":"${message["uuid"].asString()}","responded_by":{"id":"$resto","name":"resto"},"rules":[""" +
                    """{"id":"$acme","name":"acme","enabled":true,"position":1,"matches":false,""" +
                    """"failed":["header x-tenant: expected \"acme\", got \"outra\""],"conditions":["match.headers.X-Tenant"]},""" +
                    """{"id":"$resto","name":"resto","enabled":true,"position":2,"matches":true,"failed":[],"conditions":[]},""" +
                    """{"id":"$desligada","name":"desligada","enabled":false,"position":null,"matches":false,""" +
                    """"failed":["method: expected DELETE, got GET"],"conditions":["match.method"]}]}""",
            ),
        )
        assertThat(message["near_miss"].isNull).isTrue()
    }

    @Test
    @DisplayName("Dado uma regra de cenário, quando pede o trace, então avalia contra o estado atual e não muda o cenário")
    fun trace_cenario_deveUsarEstadoAtualSemTransicao() {
        val tokenId = api.tokenId()
        putRules(tokenId, """[{"name":"pago","scenario":{"name":"entrega","requiredState":"Pago","newState":"Entregue"}}]""")
        val message = api.capture(tokenId)

        val antes = api.json(trace(tokenId, message["uuid"].asString()))["rules"][0]
        api.send("PUT", "/token/$tokenId/scenarios/entrega", """{"state":"Pago"}""".toByteArray(), JSON_BODY)
        val depois = api.json(trace(tokenId, message["uuid"].asString()))["rules"][0]
        val cenarios = api.json(api.send("GET", "/token/$tokenId/scenarios", headers = JSON_CLIENT))

        assertThat(antes["failed"]).isEqualTo(api.tree("""["scenario entrega: expected state \"Pago\", got \"Started\""]"""))
        assertThat(antes["conditions"]).isEqualTo(api.tree("""["scenario"]"""))
        assertThat(depois["matches"].asBoolean()).isTrue()
        assertThat(cenarios[0]["state"].asString()).isEqualTo("Pago")
    }

    @Test
    @DisplayName("Dado a regra que respondeu apagada, quando pede o trace, então responded_by continua o gravado e rules vem vazia")
    fun trace_semRegras_deveResponderListaVazia() {
        val tokenId = api.tokenId()
        val id = putRules(tokenId, """[{"name":"única"}]""")[0]["id"].asString()
        val message = api.capture(tokenId)
        putRules(tokenId, "[]")

        val response = api.json(trace(tokenId, message["uuid"].asString()))

        assertThat(response["responded_by"]).isEqualTo(api.tree("""{"id":"$id","name":"única"}"""))
        assertThat(response["rules"]).isEqualTo(api.tree("[]"))
    }

    @Test
    @DisplayName("Dado mensagem ou URL inexistente, quando pede o trace, então 404 como o GET da mensagem e 410 como o resto de /token")
    fun trace_inexistente_deveResponder404Ou410() {
        val tokenId = api.tokenId()
        val requestId = UUID.randomUUID().toString()

        val semMensagem = trace(tokenId, requestId)
        val getMensagem = api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT)
        val semUrl = trace(UUID.randomUUID().toString(), requestId)

        assertThat(semMensagem.statusCode()).isEqualTo(404)
        assertThat(api.json(semMensagem)).isEqualTo(api.json(getMensagem))
        assertThat(semUrl.statusCode()).isEqualTo(410)
    }
}
