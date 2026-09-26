package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.RepeatedTest
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** "Falha 3×, depois 200": três 503 com Retry-After, cada um levando ao próximo estado, e 200 no fim. */
private const val FALHA_TRES_VEZES =
    """[{"name":"falha 1","scenario":{"name":"entrega","requiredState":"Started","newState":"falhou 1"},""" +
        """"response":{"status":503,"headers":{"Retry-After":"1"},"body":"tente de novo"}},""" +
        """{"name":"falha 2","scenario":{"name":"entrega","requiredState":"falhou 1","newState":"falhou 2"},""" +
        """"response":{"status":503,"headers":{"Retry-After":"1"},"body":"tente de novo"}},""" +
        """{"name":"falha 3","scenario":{"name":"entrega","requiredState":"falhou 2","newState":"entregue"},""" +
        """"response":{"status":503,"headers":{"Retry-After":"1"},"body":"tente de novo"}},""" +
        """{"name":"ok","scenario":{"name":"entrega","requiredState":"entregue"},"response":{"status":200,"body":"ok"}}]"""

private const val THREADS = 20
private const val STEPS = 5

@ApiTest
@DisplayName("Cenários com estado nas regras de resposta")
class ScenarioApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun putRules(
        tokenId: String,
        rules: String,
    ): HttpResponse<String> = api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY)

    private fun scenarios(tokenId: String): JsonNode = api.json(api.send("GET", "/token/$tokenId/scenarios", headers = JSON_CLIENT))

    private fun statuses(
        tokenId: String,
        times: Int,
    ): List<Int> = (1..times).map { api.send("POST", "/$tokenId/entregas").statusCode() }

    @Nested
    @DisplayName("Webhook")
    inner class Webhook {
        @Test
        @DisplayName("Dado o cenário falha 3×, quando o webhook chega 5 vezes, então responde 503 com Retry-After três vezes e depois 200")
        fun capture_falhaTresVezes_deveResponder503Tres200Depois() {
            val tokenId = api.tokenId()
            putRules(tokenId, FALHA_TRES_VEZES)

            val first = api.send("POST", "/$tokenId/entregas")

            assertThat(first.headers().firstValue("Retry-After")).hasValue("1")
            assertThat(listOf(first.statusCode()) + statuses(tokenId, 4)).containsExactly(503, 503, 503, 200, 200)
        }

        @Test
        @DisplayName("Dado o cenário no fim, quando reseta todos, então volta a Started e recomeça pelas falhas")
        fun deleteScenarios_cenarioNoFim_deveRecomecar() {
            val tokenId = api.tokenId()
            putRules(tokenId, FALHA_TRES_VEZES)
            statuses(tokenId, 4)

            val reset = api.send("DELETE", "/token/$tokenId/scenarios", headers = JSON_CLIENT)

            assertThat(reset.statusCode()).isEqualTo(200)
            assertThat(api.json(reset)[0]["state"].asString()).isEqualTo("Started")
            assertThat(statuses(tokenId, 4)).containsExactly(503, 503, 503, 200)
        }

        @Test
        @DisplayName("Dado uma regra de cenário fora do estado, quando o webhook chega, então o near miss traz o estado esperado e o atual")
        fun capture_foraDoEstado_deveGravarNearMissDoCenario() {
            val tokenId = api.tokenId()
            putRules(tokenId, """[{"name":"só no fim","scenario":{"name":"entrega","requiredState":"entregue"}}]""")

            val message = api.capture(tokenId)

            assertThat(message["near_miss"]["failed"]).isEqualTo(
                api.tree("""["scenario entrega: expected state \"entregue\", got \"Started\""]"""),
            )
            assertThat(message["near_miss"]["conditions"]).isEqualTo(api.tree("""["scenario"]"""))
        }

        @Test
        @DisplayName("Dado uma regra de cenário desativada, quando o webhook chega, então o estado não muda")
        fun capture_regraDesativada_naoDeveMudarEstado() {
            val tokenId = api.tokenId()
            putRules(tokenId, """[{"name":"x","enabled":false,"scenario":{"name":"entrega","newState":"mudou"}}]""")

            api.send("GET", "/$tokenId")

            assertThat(scenarios(tokenId)[0]["state"].asString()).isEqualTo("Started")
        }
    }

    @Nested
    @DisplayName("Concorrência")
    inner class Concurrency {
        /** Cinco passos em cadeia (Started → passo 2 → … → fim), cada um respondendo com o seu número. */
        private val chain =
            (1..STEPS).joinToString(",", "[", "]") { step ->
                val required = if (step == 1) "Started" else "passo $step"
                val next = if (step == STEPS) "fim" else "passo ${step + 1}"
                """{"name":"passo $step","scenario":{"name":"cadeia","requiredState":"$required","newState":"$next"},""" +
                    """"response":{"status":${200 + step},"body":"$step"}}"""
            }

        @RepeatedTest(5)
        @DisplayName("Dado um cenário de 5 passos e 20 requisições simultâneas, quando o webhook responde, então cada passo sai uma vez só")
        fun capture_vinteSimultaneas_deveDarCadaPassoUmaVez() {
            val tokenId = api.tokenId()
            putRules(tokenId, chain)
            val start = CountDownLatch(1)
            val pool = Executors.newFixedThreadPool(THREADS)

            val futures = (1..THREADS).map { pool.submit<Int> { start.await().let { api.send("POST", "/$tokenId").statusCode() } } }
            start.countDown()
            val codes = futures.map { it.get(30, TimeUnit.SECONDS) }
            pool.shutdown()

            assertThat(codes.filter { it > 200 }).containsExactlyInAnyOrder(201, 202, 203, 204, 205)
            assertThat(codes.count { it == 200 }).isEqualTo(THREADS - STEPS)
            assertThat(scenarios(tokenId)[0]["state"].asString()).isEqualTo("fim")
            assertThat(pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue()
        }
    }

    @Nested
    @DisplayName("API /token/{id}/scenarios")
    inner class Api {
        @Test
        @DisplayName("Dado regras com cenários, quando lista, então cada cenário traz o estado atual e os estados que as regras citam")
        fun get_regrasComCenarios_deveListarEstados() {
            val tokenId = api.tokenId()
            putRules(tokenId, FALHA_TRES_VEZES)
            statuses(tokenId, 1)

            assertThat(scenarios(tokenId)).isEqualTo(
                api.tree(
                    """[{"name":"entrega","state":"falhou 1","states":["Started","falhou 1","falhou 2","entregue"]}]""",
                ),
            )
        }

        @Test
        @DisplayName("Dado uma URL sem regras de cenário, quando lista, então responde lista vazia")
        fun get_semCenarios_deveResponderListaVazia() {
            assertThat(scenarios(api.tokenId())).isEqualTo(api.tree("[]"))
        }

        @Test
        @DisplayName("Dado um estado definido à mão, quando o webhook chega, então responde a regra daquele estado")
        fun put_estadoManual_deveValerNoWebhook() {
            val tokenId = api.tokenId()
            putRules(tokenId, FALHA_TRES_VEZES)

            val response = api.send("PUT", "/token/$tokenId/scenarios/entrega", """{"state":"entregue"}""".toByteArray(), JSON_BODY)

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(api.json(response)).isEqualTo(
                api.tree("""{"name":"entrega","state":"entregue","states":["Started","falhou 1","falhou 2","entregue"]}"""),
            )
            assertThat(statuses(tokenId, 1)).containsExactly(200)
        }

        @Test
        @DisplayName("Dado um estado vazio ou que não é texto, quando define à mão, então responde 422 em state")
        fun put_estadoInvalido_deveResponder422() {
            val tokenId = api.tokenId()

            val vazio = api.send("PUT", "/token/$tokenId/scenarios/entrega", """{"state":""}""".toByteArray(), JSON_BODY)
            val numero = api.send("PUT", "/token/$tokenId/scenarios/entrega", """{"state":1}""".toByteArray(), JSON_BODY)

            assertThat(vazio.statusCode()).isEqualTo(422)
            assertThat(api.json(vazio)).isEqualTo(api.tree("""{"state":["The state field is required."]}"""))
            assertThat(api.json(numero)).isEqualTo(api.tree("""{"state":["The state must be a string."]}"""))
        }

        @Test
        @DisplayName("Dado um token inexistente, quando chama as rotas de cenário, então responde 410")
        fun rotas_tokenInexistente_deveResponder410() {
            val tokenId = api.tokenId()
            api.send("DELETE", "/token/$tokenId", headers = JSON_CLIENT)

            assertThat(api.send("GET", "/token/$tokenId/scenarios", headers = JSON_CLIENT).statusCode()).isEqualTo(410)
            assertThat(api.send("DELETE", "/token/$tokenId/scenarios", headers = JSON_CLIENT).statusCode()).isEqualTo(410)
            assertThat(
                api.send("PUT", "/token/$tokenId/scenarios/x", """{"state":"a"}""".toByteArray(), JSON_BODY).statusCode(),
            ).isEqualTo(410)
        }
    }

    @Nested
    @DisplayName("Chave token:{uuid}:scenarios no Redis")
    inner class Storage {
        @Test
        @DisplayName("Dado uma transição, quando olha o Redis, então o hash tem o estado e o TTL da URL, e sai com a URL")
        fun capture_transicao_deveGravarComTtlEApagarComAUrl() {
            val tokenId = api.tokenId()
            putRules(tokenId, FALHA_TRES_VEZES)
            statuses(tokenId, 1)

            assertThat(redis.opsForHash<String, String>().entries("token:$tokenId:scenarios")).isEqualTo(mapOf("entrega" to "falhou 1"))
            assertThat(redis.getExpire("token:$tokenId:scenarios")).isBetween(EXPIRY_SECONDS - 5, EXPIRY_SECONDS)

            api.send("DELETE", "/token/$tokenId", headers = JSON_CLIENT)

            assertThat(redis.hasKey("token:$tokenId:scenarios")).isFalse()
        }
    }

    private companion object {
        const val EXPIRY_SECONDS = 604_800L
    }
}
