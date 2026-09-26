package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.http.HttpResponse

private const val PAGAMENTO =
    """{"name":"pagamento","priority":2,"match":{"method":["POST"],"path":{"equals":"/pagamentos"},""" +
        """"headers":{"X-Signature":{"present":true}},"body":[{"jsonPath":{"path":"$.status","equals":"pago"}}]},""" +
        """"response":{"status":201,"headers":{"Content-Type":"application/json","X-Mock":"sim"},"body":"{\"ok\":true}"}}"""

@ApiTest
@DisplayName("API de regras de resposta e resposta do webhook por regra")
class RuleApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun putRules(
        tokenId: String,
        rules: String,
    ): HttpResponse<String> = api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY)

    private fun getRules(tokenId: String): JsonNode = api.json(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT))

    @Nested
    @DisplayName("GET e PUT de /token/{id}/rules")
    inner class Crud {
        @Test
        @DisplayName("Dado uma URL sem regras, quando lê as regras, então responde lista vazia")
        fun get_semRegras_deveResponderListaVazia() {
            val response = api.send("GET", "/token/${api.tokenId()}/rules", headers = JSON_CLIENT)

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(api.json(response)).isEqualTo(api.tree("[]"))
        }

        @Test
        @DisplayName("Dado uma regra sem id, quando salva, então devolve a regra normalizada com id gerado e o GET devolve o mesmo")
        fun put_regraSemId_deveNormalizarEGerarId() {
            val tokenId = api.tokenId()

            val saved = putRules(tokenId, """[{"name":"mínima"}]""")

            assertThat(saved.statusCode()).isEqualTo(200)
            val rule = api.json(saved)[0]
            assertThat(rule["id"].asString()).matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
            assertThat(rule).isEqualTo(
                api.tree(
                    """{"id":"${rule["id"].asString()}","name":"mínima","enabled":true,"priority":5,""" +
                        """"match":{"method":[],"path":null,"query":{},"headers":{},"body":[]},"scenario":null,""" +
                        """"response":{"status":200,"headers":{},"body":"","template":false,"delay":null,"dribble":null,"fault":null}}""",
                ),
            )
            assertThat(getRules(tokenId)).isEqualTo(api.json(saved))
        }

        @Test
        @DisplayName("Dado a lista exportada pelo GET, quando é importada de volta pelo PUT, então nada se perde")
        fun put_listaExportada_deveVoltarIgual() {
            val tokenId = api.tokenId()
            val completa =
                """{"name":"completa","enabled":false,"priority":1,"match":{"method":["put"],"path":{"regex":"/a/\\d+"},""" +
                    """"query":{"q":{"contains":"x"}},"headers":{"X-A":{"present":false}},""" +
                    """"body":[{"equals":"a"},{"regex":"b.*"},{"jsonPath":{"path":"$.a"}},{"equalToJson":{"b":[1,2]}}]}}"""
            putRules(tokenId, "[$PAGAMENTO,$completa]")
            val exported = getRules(tokenId)

            val imported = putRules(api.tokenId(), exported.toString())

            assertThat(api.json(imported)).isEqualTo(exported)
            assertThat(exported.toList().map { it["name"].asString() }).containsExactly("pagamento", "completa")
        }

        @Test
        @DisplayName("Dado uma regra inválida, quando salva, então responde 422 e as regras salvas ficam como estavam")
        fun put_regraInvalida_deveResponder422SemMexer() {
            val tokenId = api.tokenId()
            putRules(tokenId, "[$PAGAMENTO]")
            val before = getRules(tokenId)

            val response = putRules(tokenId, """[{"name":"ok"},{"name":"x","match":{"path":{"regex":"("}}}]""")

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(api.tree("""{"1.match.path.regex":["The regex is invalid."]}"""))
            assertThat(getRules(tokenId)).isEqualTo(before)
        }

        @Test
        @DisplayName("Dado um corpo que não é JSON, quando salva, então responde 422 em rules, mesmo sem Accept JSON")
        fun put_corpoNaoJson_deveResponder422() {
            val response = api.send("PUT", "/token/${api.tokenId()}/rules", "isto não é json".toByteArray())

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(api.tree("""{"rules":["The rules must be an array."]}"""))
        }

        @Test
        @DisplayName("Dado um token inexistente, quando chama GET ou PUT, então responde 410")
        fun rotas_tokenInexistente_deveResponder410() {
            val tokenId = api.tokenId()
            api.send("DELETE", "/token/$tokenId", headers = JSON_CLIENT)

            assertThat(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT).statusCode()).isEqualTo(410)
            assertThat(putRules(tokenId, "[]").statusCode()).isEqualTo(410)
        }
    }

    @Nested
    @DisplayName("Chave token:{uuid}:rules no Redis")
    inner class Storage {
        @Test
        @DisplayName("Dado regras salvas, quando olha o Redis, então a chave tem o TTL da URL e sai com a lista vazia")
        fun put_regras_deveGravarComTtlEApagarComListaVazia() {
            val tokenId = api.tokenId()

            putRules(tokenId, "[$PAGAMENTO]")
            assertThat(redis.getExpire("token:$tokenId:rules")).isBetween(EXPIRY_SECONDS - 5, EXPIRY_SECONDS)

            putRules(tokenId, "[]")
            assertThat(redis.hasKey("token:$tokenId:rules")).isFalse()
        }

        @Test
        @DisplayName("Dado uma URL com regras, quando é apagada, então a chave das regras sai junto")
        fun deleteToken_comRegras_deveApagarAsRegras() {
            val tokenId = api.tokenId()
            putRules(tokenId, "[$PAGAMENTO]")

            api.send("DELETE", "/token/$tokenId", headers = JSON_CLIENT)

            assertThat(redis.hasKey("token:$tokenId:rules")).isFalse()
        }
    }

    private companion object {
        const val EXPIRY_SECONDS = 604_800L
    }
}
