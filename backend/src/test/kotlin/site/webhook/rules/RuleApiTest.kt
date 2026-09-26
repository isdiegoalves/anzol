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
import java.time.Duration

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
        @DisplayName("Dado um token inexistente, quando chama GET, PUT ou rules/test, então responde 410")
        fun rotas_tokenInexistente_deveResponder410() {
            val tokenId = api.tokenId()
            api.send("DELETE", "/token/$tokenId", headers = JSON_CLIENT)

            assertThat(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT).statusCode()).isEqualTo(410)
            assertThat(putRules(tokenId, "[]").statusCode()).isEqualTo(410)
            assertThat(api.send("POST", "/token/$tokenId/rules/test", "{}".toByteArray(), JSON_BODY).statusCode()).isEqualTo(410)
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

    @Nested
    @DisplayName("Webhook com regras")
    inner class Webhook {
        private val pago = """{"status":"pago"}""".toByteArray()
        private val signed = mapOf("X-Signature" to "abc", "Content-Type" to "application/json")

        @Test
        @DisplayName("Dado uma regra que casa, quando o webhook chega, então responde status, cabeçalhos e corpo da regra e grava rule")
        fun capture_regraQueCasa_deveResponderPelaRegra() {
            val tokenId = api.tokenId("""{"default_status":202,"default_content":"padrão","retry_after":30}""")
            val ruleId = api.json(putRules(tokenId, "[$PAGAMENTO]"))[0]["id"].asString()

            val response = api.send("POST", "/$tokenId/pagamentos", pago, signed)

            assertThat(response.statusCode()).isEqualTo(201)
            assertThat(response.body()).isEqualTo("""{"ok":true}""")
            assertThat(response.headers().firstValue("Content-Type")).hasValue("application/json")
            assertThat(response.headers().firstValue("X-Mock")).hasValue("sim")
            assertThat(response.headers().firstValue("X-Token-Id")).hasValue(tokenId)
            assertThat(response.headers().firstValue("Retry-After")).isEmpty()
            val message = message(tokenId, response)
            assertThat(message["rule"]).isEqualTo(api.tree("""{"id":"$ruleId","name":"pagamento"}"""))
            assertThat(message["near_miss"].isNull).isTrue()
        }

        @Test
        @DisplayName("Dado uma regra que não casa, quando o webhook chega, então responde o padrão da URL e grava o near miss")
        fun capture_regraQueNaoCasa_deveResponderPadraoEGravarNearMiss() {
            val tokenId = api.tokenId("""{"default_status":202,"default_content":"padrão","retry_after":30}""")
            val ruleId = api.json(putRules(tokenId, "[$PAGAMENTO]"))[0]["id"].asString()

            val response = api.send("POST", "/$tokenId/pagamentos", """{"status":"pendente"}""".toByteArray(), JSON_BODY)

            assertThat(response.statusCode()).isEqualTo(202)
            assertThat(response.body()).isEqualTo("padrão")
            assertThat(response.headers().firstValue("Retry-After")).hasValue("30")
            val message = message(tokenId, response)
            assertThat(message["rule"].isNull).isTrue()
            assertThat(message["near_miss"]).isEqualTo(
                api.tree(
                    """{"id":"$ruleId","name":"pagamento","failed":""" +
                        """["header x-signature: absent","body $.status: expected \"pago\", got \"pendente\""]}""",
                ),
            )
        }

        @Test
        @DisplayName("Dado uma URL sem regras, quando o webhook chega, então a mensagem traz rule e near_miss nulos")
        fun capture_semRegras_deveGravarCamposNulos() {
            val tokenId = api.tokenId()

            val message = api.capture(tokenId)

            assertThat(message.has("rule")).isTrue()
            assertThat(message["rule"].isNull).isTrue()
            assertThat(message["near_miss"].isNull).isTrue()
        }

        @Test
        @DisplayName("Dado duas regras que casam, quando o webhook chega, então responde a de menor prioridade e ignora a desativada")
        fun capture_prioridade_deveResponderAMenor() {
            val tokenId = api.tokenId()
            putRules(
                tokenId,
                """[{"name":"cinco","response":{"status":205}},{"name":"um","priority":1,"response":{"status":201}},""" +
                    """{"name":"zero-desligada","priority":1,"enabled":false,"response":{"status":500}}]""",
            )

            val response = api.send("GET", "/$tokenId/qualquer")

            assertThat(response.statusCode()).isEqualTo(201)
            assertThat(message(tokenId, response)["rule"]["name"].asString()).isEqualTo("um")
        }

        @Test
        @DisplayName("Dado uma regra com status 200, quando o webhook chega em /404, então o status da regra vence o do caminho")
        fun capture_statusNoCaminho_deveValerODaRegra() {
            val tokenId = api.tokenId()
            putRules(tokenId, """[{"name":"ok","response":{"status":200,"body":"regra"}}]""")

            val response = api.send("GET", "/$tokenId/404")

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(response.body()).isEqualTo("regra")
        }

        @Test
        @DisplayName("Dado uma URL com timeout de 3 s e uma regra que casa, quando o webhook chega, então responde sem esperar")
        fun capture_regraComTimeoutNaUrl_naoDeveEsperar() {
            val tokenId = api.tokenId("""{"timeout":3}""")
            putRules(tokenId, """[{"name":"rápida","response":{"status":201}}]""")
            val start = System.nanoTime()

            val response = api.send("GET", "/$tokenId")

            assertThat(response.statusCode()).isEqualTo(201)
            assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(2))
        }

        private fun message(
            tokenId: String,
            response: HttpResponse<String>,
        ): JsonNode {
            val requestId = response.headers().firstValue("X-Request-Id").orElseThrow()
            return api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT))
        }
    }

    @Nested
    @DisplayName("POST /token/{id}/rules/test")
    inner class RulesTest {
        @Test
        @DisplayName(
            "Dado mensagens gravadas, quando testa uma regra, então diz quais casariam e por que as outras não, da mais nova à mais antiga",
        )
        fun test_mensagensGravadas_deveSepararMatchesEMisses() {
            val tokenId = api.tokenId()
            val get = api.capture(tokenId, suffix = "/pagamentos")
            val post = api.capture(tokenId, method = "POST", suffix = "/pagamentos")
            val outro = api.capture(tokenId, method = "POST", suffix = "/outro")
            val rule = """{"name":"t","enabled":false,"match":{"method":["POST"],"path":{"equals":"/pagamentos"}}}"""

            val response = api.send("POST", "/token/$tokenId/rules/test", rule.toByteArray(), JSON_BODY)

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(api.json(response)).isEqualTo(
                api.tree(
                    """{"matches":[${ref(post)}],"misses":[""" +
                        """${ref(outro, """"path: expected \"/pagamentos\", got \"/outro\""""")},""" +
                        """${ref(get, """"method: expected POST, got GET"""")}]}""",
                ),
            )
        }

        @Test
        @DisplayName("Dado uma regra inválida, quando testa, então responde 422 com a chave sem índice")
        fun test_regraInvalida_deveResponder422() {
            val response = api.send("POST", "/token/${api.tokenId()}/rules/test", """{"name":"t","priority":0}""".toByteArray(), JSON_BODY)

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(api.tree("""{"priority":["The priority must be at least 1."]}"""))
        }

        private fun ref(
            message: JsonNode,
            failed: String? = null,
        ): String {
            val base = """"uuid":"${message["uuid"].asString()}","seq":${message["seq"].asLong()}"""
            return if (failed == null) "{$base}" else """{$base,"failed":[$failed]}"""
        }
    }

    private companion object {
        const val EXPIRY_SECONDS = 604_800L
    }
}
