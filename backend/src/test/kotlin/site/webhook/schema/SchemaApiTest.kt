package site.webhook.schema

import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import site.webhook.support.SseClient
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode
import java.time.Duration
import java.util.UUID

private const val ORDER_SCHEMA =
    """{"type":"object","required":["id"],"properties":{"id":{"type":"integer"},"tags":{"items":{"type":"string"}}}}"""
private const val WITH_SCHEMA = """{"schema":$ORDER_SCHEMA}"""
private val JSON_REQUEST = mapOf("Content-Type" to "application/json")

@ApiTest
@DisplayName("Validação de schema pela API")
class SchemaApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun put(
        tokenId: String,
        fields: String,
    ) = api.send("PUT", "/token/$tokenId", fields.toByteArray(), JSON_BODY)

    private fun read(tokenId: String): JsonNode = api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))

    /** POST com corpo JSON (ou o que for [body]); devolve a mensagem gravada. */
    private fun post(
        tokenId: String,
        body: String,
        headers: Map<String, String> = JSON_REQUEST,
    ): JsonNode = api.capture(tokenId, method = "POST", body = body.toByteArray(), headers = headers)

    private fun saveRules(
        tokenId: String,
        json: String,
    ) = api.send("PUT", "/token/$tokenId/rules", json.toByteArray(), JSON_BODY)

    @Nested
    @DisplayName("Configuração no token")
    inner class Configuration {
        @Test
        @DisplayName("Dado um token criado com schema, quando responde e quando é lido, então devolve e grava o documento como veio")
        fun create_comSchema_deveDevolverEGravar() {
            val created = api.createToken(WITH_SCHEMA)
            val tokenId = created["uuid"].asString()

            assertThat(created["schema"]).isEqualTo(api.tree(ORDER_SCHEMA))
            assertThat(read(tokenId)["schema"]).isEqualTo(api.tree(ORDER_SCHEMA))
            assertThat(api.tree(redis.opsForValue().get("token:$tokenId").orEmpty())["schema"]).isEqualTo(api.tree(ORDER_SCHEMA))
        }

        @Test
        @DisplayName("Dado um token criado sem schema, quando responde, então schema é null depois de signature")
        fun create_semSchema_deveDevolverNull() {
            val created = api.createToken()

            assertThat(created["schema"].isNull).isTrue()
            assertThat(created.propertyNames().toList()).containsSubsequence("signature", "schema")
        }

        @Test
        @DisplayName("Dado um PUT com outro schema, quando edita, então passa a valer o novo")
        fun update_outroSchema_deveTrocar() {
            val tokenId = api.tokenId(WITH_SCHEMA)

            val edited = api.json(put(tokenId, """{"schema":{"type":"array"}}"""))

            assertThat(edited["schema"]).isEqualTo(api.tree("""{"type":"array"}"""))
            assertThat(post(tokenId, "[]")["schema"]["valid"].asBoolean()).isTrue()
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um PUT sem schema, com null ou em branco, quando edita, então a URL deixa de validar")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {}
            {"schema":null}
            {"schema":""}""",
        )
        fun update_semSchema_deveDesligar(fields: String) {
            val tokenId = api.tokenId(WITH_SCHEMA)

            val edited = api.json(put(tokenId, fields))

            assertThat(edited["schema"].isNull).isTrue()
            assertThat(post(tokenId, "{}")["schema"].isNull).isTrue()
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado um schema inválido, quando cria, então responde 422 em schema com o motivo")
        @CsvSource(
            delimiter = '|',
            textBlock = $$"""
            {"schema":[1]}                                   | The schema is invalid: it must be a JSON object.
            {"schema":{"type":"inteiro"}}                    | The schema is invalid: /type: does not have a value in the enumeration ["array", "boolean", "integer", "null", "number", "object", "string"].
            {"schema":{"$ref":"https://example.com/s.json"}} | The schema is invalid: $ref https://example.com/s.json is not internal (only #… is allowed).
            {"schema":"texto"}                               | The schema is invalid: it must be a JSON object.""",
        )
        fun create_schemaInvalido_deveResponder422(
            fields: String,
            message: String,
        ) {
            val response = api.send("POST", "/token", fields.toByteArray(), JSON_BODY)

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(api.tree("""{"schema":[${quote(message)}]}"""))
        }

        @Test
        @DisplayName("Dado um schema de mais de 64 KB, quando cria ou edita, então responde 422 e nada muda")
        fun create_acimaDe64KB_deveResponder422() {
            val big = """{"schema":{"description":"${"d".repeat(MAX_SCHEMA_BYTES)}"}}"""
            val tokenId = api.tokenId(WITH_SCHEMA)

            val created = api.send("POST", "/token", big.toByteArray(), JSON_BODY)
            val edited = put(tokenId, big)

            assertThat(created.statusCode()).isEqualTo(422)
            assertThat(api.json(created)).isEqualTo(api.tree("""{"schema":["The schema is invalid: it is larger than 64 KB."]}"""))
            assertThat(edited.statusCode()).isEqualTo(422)
            assertThat(read(tokenId)["schema"]).isEqualTo(api.tree(ORDER_SCHEMA))
        }
    }

    @Nested
    @DisplayName("Resultado na mensagem")
    inner class Message {
        @Test
        @DisplayName("Dado uma URL sem schema, quando recebe, então a mensagem traz schema null depois de signature")
        fun capture_semSchema_deveGravarNull() {
            val message = post(api.tokenId(), """{"id":1}""")

            assertThat(message["schema"].isNull).isTrue()
            assertThat(message.propertyNames().toList()).containsSubsequence("signature", "schema", "seq")
        }

        @Test
        @DisplayName("Dado corpos válido e inválido, quando recebe, então grava valid e os erros com o JSON Pointer da instância")
        fun capture_validoEInvalido_deveGravarOResultado() {
            val tokenId = api.tokenId(WITH_SCHEMA)

            val valid = post(tokenId, """{"id":1,"tags":["a"]}""")
            val invalid = post(tokenId, """{"tags":["a",2]}""")

            assertThat(valid["schema"]).isEqualTo(api.tree("""{"valid":true,"errors":[]}"""))
            assertThat(invalid["schema"]).isEqualTo(
                api.tree(
                    """{"valid":false,"errors":[{"path":"/tags/1","message":"integer found, string expected"},""" +
                        """{"path":"","message":"required property 'id' not found"}]}""",
                ),
            )
        }

        @Test
        @DisplayName("Dado um corpo com 25 erros, quando recebe, então a mensagem guarda só os 20 primeiros")
        fun capture_maisDe20Erros_deveGuardar20() {
            val tokenId = api.tokenId("""{"schema":{"items":{"type":"string"}}}""")

            val message = post(tokenId, (0 until 25).joinToString(",", "[", "]"))

            assertThat(message["schema"]["valid"].asBoolean()).isFalse()
            assertThat(message["schema"]["errors"].toList().map { it["path"].asString() }).isEqualTo((0 until 20).map { "/$it" })
        }

        @ParameterizedTest(name = "{0}: \"{1}\"")
        @DisplayName("Dado um corpo que não é JSON ou vazio, quando recebe, então grava body is not JSON na raiz")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            application/x-www-form-urlencoded | a=1&b=2
            text/xml                          | <pedido/>
            application/json                  | {"id":1
            application/json                  | ''""",
        )
        fun capture_corpoNaoJson_deveGravarNotJson(
            contentType: String,
            body: String,
        ) {
            val message = post(api.tokenId(WITH_SCHEMA), body, mapOf("Content-Type" to contentType))

            assertThat(message["schema"]).isEqualTo(api.tree("""{"valid":false,"errors":[{"path":"","message":"body is not JSON"}]}"""))
        }

        @Test
        @DisplayName("Dado um GET sem corpo numa URL com schema, quando recebe, então grava body is not JSON e responde normalmente")
        fun capture_getSemCorpo_deveGravarNotJson() {
            val tokenId = api.tokenId(WITH_SCHEMA)

            val response = api.send("GET", "/$tokenId")
            val message =
                api.json(api.send("GET", "/token/$tokenId/request/${response.headers().firstValue("X-Request-Id").orElseThrow()}"))

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(message["schema"]["errors"][0]["message"].asString()).isEqualTo("body is not JSON")
        }

        @Test
        @DisplayName("Dado um schema no Redis que estoura a pilha da biblioteca, quando recebe, então a captura não cai (valid false)")
        fun capture_falhaDaBiblioteca_naoDeveDerrubarACaptura() {
            val tokenId = api.tokenId()
            val stored = api.tree(redis.opsForValue().get("token:$tokenId").orEmpty()) as ObjectNode
            stored.set("schema", api.tree($$"""{"$ref":"#/$defs/a","$defs":{"a":{"$ref":"#/$defs/a"}}}"""))
            redis.opsForValue().set("token:$tokenId", stored.toString())

            val response = api.send("POST", "/$tokenId", "{}".toByteArray(), JSON_REQUEST)
            val message =
                api.json(api.send("GET", "/token/$tokenId/request/${response.headers().firstValue("X-Request-Id").orElseThrow()}"))

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(message["schema"]["valid"].asBoolean()).isFalse()
        }

        @Test
        @DisplayName("Dado uma aba assinando o token, quando chega uma mensagem, então o request.created traz o schema da mensagem")
        fun stream_evento_deveTrazerOSchema() {
            val tokenId = api.tokenId(WITH_SCHEMA)
            SseClient("${api.base}/token/$tokenId/stream").use { client ->
                api.send("POST", "/$tokenId", """{"id":"x"}""".toByteArray(), JSON_REQUEST)

                await().atMost(Duration.ofSeconds(5)).until { client.events.isNotEmpty() }
                val request = api.tree(client.events.first().data)["request"]

                assertThat(request["schema"]).isEqualTo(
                    api.tree("""{"valid":false,"errors":[{"path":"/id","message":"string found, integer expected"}]}"""),
                )
            }
        }
    }

    @Nested
    @DisplayName("Formato antigo no Redis")
    inner class LegacyFormat {
        @Test
        @DisplayName(
            "Dado token e mensagem gravados pela versão anterior (sem schema), quando a API os lê, " +
                "então abrem com schema null e a URL segue capturando",
        )
        fun leitura_semOCampo_deveAbrirComSchemaNull() {
            val tokenId = UUID.randomUUID().toString()
            val requestId = UUID.randomUUID().toString()
            redis.opsForValue().set("token:$tokenId", previousToken(tokenId))
            redis.opsForHash<String, String>().put("token:$tokenId:requests", requestId, previousMessage(tokenId, requestId))

            val token = read(tokenId)
            val message = api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT))
            val page = api.json(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT))
            val captured = post(tokenId, """{"id":1}""")

            assertThat(token["schema"].isNull).isTrue()
            assertThat(token["signature"]["provider"].asString()).isEqualTo("github")
            assertThat(message["schema"].isNull).isTrue()
            assertThat(message["signature"]).isEqualTo(api.tree("""{"provider":"github","valid":true,"reason":null}"""))
            assertThat(page["data"][0]["schema"].isNull).isTrue()
            assertThat(captured["schema"].isNull).isTrue()
        }

        /** `token:{uuid}` como a versão com assinatura HMAC o gravava: tudo até `signature`, sem `schema`. */
        private fun previousToken(tokenId: String) =
            """{"uuid":"$tokenId","ip":"172.18.0.1","user_agent":"curl/8.16.0","default_content":"","default_status":200,""" +
                """"default_content_type":"text/plain","timeout":0,"cors":false,"created_at":"2026-09-26 12:00:00",""" +
                """"updated_at":"2026-09-26 12:00:00","retry_after":null,"auto_cleanup":null,""" +
                """"signature":{"provider":"github","secret":"segredo-antigo"}}"""

        /** Mensagem da mesma versão: `rule`, `near_miss` e `signature`, sem `schema`. */
        private fun previousMessage(
            tokenId: String,
            requestId: String,
        ) = """{"uuid":"$requestId","token_id":"$tokenId","ip":"172.18.0.1","hostname":"localhost","method":"POST",""" +
            """"user_agent":"curl/8.16.0","content":"{\"id\":1}","query":null,"headers":{"content-type":["application/json"]},""" +
            """"url":"http://localhost:8084/$tokenId","created_at":"2026-09-26 12:00:01","updated_at":"2026-09-26 12:00:01",""" +
            """"rule":null,"near_miss":null,"signature":{"provider":"github","valid":true,"reason":null}}"""
    }

    @Nested
    @DisplayName("Condição de regra")
    inner class Rules {
        @Test
        @DisplayName("Dado uma regra para schema inválido, quando chegam corpo válido e inválido, então só o inválido leva 400")
        fun capture_regraInvalid_deveResponder400SoParaInvalido() {
            val tokenId = api.tokenId(WITH_SCHEMA)
            saveRules(tokenId, """[{"name":"recusa","match":{"schema":"invalid"},"response":{"status":400}}]""")

            val invalid = api.send("POST", "/$tokenId", """{"id":"x"}""".toByteArray(), JSON_REQUEST)
            val valid = api.send("POST", "/$tokenId", """{"id":1}""".toByteArray(), JSON_REQUEST)

            assertThat(invalid.statusCode()).isEqualTo(400)
            assertThat(valid.statusCode()).isEqualTo(200)
        }

        @Test
        @DisplayName("Dado regras de schema que não casam, quando chegam, então o near miss usa as frases da condição")
        fun capture_naoCasa_deveTrazerAsFrases() {
            val withSchema = api.tokenId(WITH_SCHEMA)
            val without = api.tokenId()
            saveRules(withSchema, """[{"name":"ok","match":{"schema":"valid"}}]""")
            saveRules(without, """[{"name":"ok","match":{"schema":"valid"}}]""")

            val twoErrors = post(withSchema, """{"tags":[1]}""")
            val notConfigured = post(without, """{"id":1}""")
            saveRules(withSchema, """[{"name":"ruim","match":{"schema":"invalid"}}]""")
            val valid = post(withSchema, """{"id":1}""")

            assertThat(twoErrors["near_miss"]["failed"]).isEqualTo(api.tree("""["schema: expected valid, got invalid (2 errors)"]"""))
            assertThat(notConfigured["near_miss"]["failed"]).isEqualTo(api.tree("""["schema: expected valid, got not configured"]"""))
            assertThat(valid["near_miss"]["failed"]).isEqualTo(api.tree("""["schema: expected invalid, got valid"]"""))
        }

        @Test
        @DisplayName("Dado mensagens já gravadas, quando testa uma regra de schema, então usa o resultado gravado de cada uma")
        fun test_historico_deveUsarOResultadoGravado() {
            val tokenId = api.tokenId(WITH_SCHEMA)
            val valid = post(tokenId, """{"id":1}""")
            val invalid = post(tokenId, "{}")
            put(tokenId, "{}")
            val rule = """{"name":"t","match":{"schema":"valid"}}"""

            val result = api.json(api.send("POST", "/token/$tokenId/rules/test", rule.toByteArray(), JSON_BODY))

            assertThat(result["matches"].toList().map { it["uuid"].asString() }).containsExactly(valid["uuid"].asString())
            assertThat(result["misses"].single()["uuid"].asString()).isEqualTo(invalid["uuid"].asString())
            assertThat(result["misses"].single()["failed"]).isEqualTo(api.tree("""["schema: expected valid, got invalid (1 errors)"]"""))
        }

        @Test
        @DisplayName("Dado um valor fora de valid e invalid, quando salva a regra, então responde 422 na chave da condição")
        fun replace_valorInvalido_deveResponder422() {
            val response = saveRules(api.tokenId(), """[{"name":"r","match":{"schema":"absent"}}]""")

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(api.tree("""{"0.match.schema":["The selected schema is invalid."]}"""))
        }

        @Test
        @DisplayName("Dado uma regra com e outra sem a condição, quando lê a lista, então a chave aparece só na que tem")
        fun all_regraSemCondicao_deveOmitirAChave() {
            val tokenId = api.tokenId()
            saveRules(tokenId, """[{"name":"a","match":{"schema":"invalid"}},{"name":"b","match":{"schema":null}}]""")

            val listed = api.json(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT))

            assertThat(listed[0]["match"]["schema"].asString()).isEqualTo("invalid")
            assertThat(listed[1]["match"].has("schema")).isFalse()
        }

        @Test
        @DisplayName("Dado mensagens válida e inválida, quando espera por match.schema invalid, então o wait-for devolve só a inválida")
        fun wait_matchSchema_deveCasarPeloResultado() {
            val tokenId = api.tokenId(WITH_SCHEMA)
            post(tokenId, """{"id":1}""")
            val invalid = post(tokenId, """{"id":"x"}""")

            val response =
                api.send(
                    "POST",
                    "/token/$tokenId/requests/wait",
                    """{"match":{"schema":"invalid"},"timeout":0}""".toByteArray(),
                    JSON_BODY,
                )

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(api.json(response)["requests"].toList().map { it["uuid"].asString() }).containsExactly(invalid["uuid"].asString())
        }
    }
}

/** O texto como string JSON. */
private fun quote(text: String): String = JsonMapper.builder().build().writeValueAsString(text)
