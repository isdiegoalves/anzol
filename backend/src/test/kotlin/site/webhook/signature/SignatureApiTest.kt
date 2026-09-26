package site.webhook.signature

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import site.webhook.support.multipart
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.nio.charset.StandardCharsets.UTF_8
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val SECRET = "gh-segredo-de-teste-9876"
private const val GITHUB = """{"signature":{"provider":"github","secret":"$SECRET"}}"""

private fun githubSignature(
    body: ByteArray,
    secret: String = SECRET,
): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret.toByteArray(UTF_8), "HmacSHA256"))
    return "sha256=" + HexFormat.of().formatHex(mac.doFinal(body))
}

@ApiTest
@DisplayName("Assinatura HMAC pela API")
class SignatureApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun put(
        tokenId: String,
        fields: String,
    ) = api.send("PUT", "/token/$tokenId", fields.toByteArray(), JSON_BODY)

    /** POST assinado para o GitHub; devolve a mensagem gravada. */
    private fun signedPost(
        tokenId: String,
        body: ByteArray = """{"ok":true}""".toByteArray(),
        signature: String? = githubSignature(body),
        contentType: String = "application/json",
    ): JsonNode {
        val headers = listOfNotNull("Content-Type" to contentType, signature?.let { "X-Hub-Signature-256" to it }).toMap()
        return api.capture(tokenId, method = "POST", body = body, headers = headers)
    }

    @Nested
    @DisplayName("Configuração no token")
    inner class Configuration {
        @Test
        @DisplayName(
            "Dado um token criado com GitHub, quando responde e quando é lido, então o segredo sai mascarado e o Redis guarda o inteiro",
        )
        fun create_github_deveMascararOSegredo() {
            val created = api.createToken(GITHUB)
            val tokenId = created["uuid"].asString()

            val read = api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))

            assertThat(created["signature"]).isEqualTo(api.tree("""{"provider":"github","secret":"••••9876"}"""))
            assertThat(read["signature"]).isEqualTo(created["signature"])
            assertThat(read.toString()).doesNotContain(SECRET)
            assertThat(redis.opsForValue().get("token:$tokenId")).contains(SECRET)
        }

        @Test
        @DisplayName("Dado configurações sem os opcionais, quando cria, então grava os padrões de cada provedor")
        fun create_semOpcionais_devePreencherPadroes() {
            val stripe = api.createToken("""{"signature":{"provider":"stripe","secret":"whsec_abcdefgh"}}""")
            val slack = api.createToken("""{"signature":{"provider":"slack","secret":"abcdefgh","toleranceSeconds":60}}""")
            val generic =
                api.createToken(
                    """{"signature":{"provider":"generic","secret":"abcdefgh","header":"X-Sig","algorithm":"sha1"}}""",
                )

            assertThat(stripe["signature"]).isEqualTo(api.tree("""{"provider":"stripe","secret":"••••efgh","toleranceSeconds":300}"""))
            assertThat(slack["signature"]).isEqualTo(api.tree("""{"provider":"slack","secret":"••••efgh","toleranceSeconds":60}"""))
            assertThat(generic["signature"])
                .isEqualTo(api.tree("""{"provider":"generic","secret":"••••efgh","header":"X-Sig","algorithm":"sha1","encoding":"hex"}"""))
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um PUT com o segredo ausente, nulo, vazio ou mascarado, quando edita, então mantém o segredo atual")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {"signature":{"provider":"github"}}
            {"signature":{"provider":"github","secret":null}}
            {"signature":{"provider":"github","secret":""}}
            {"signature":{"provider":"github","secret":"••••9876"}}""",
        )
        fun update_semSegredoNovo_deveManterOAtual(fields: String) {
            val tokenId = api.tokenId(GITHUB)

            val response = put(tokenId, fields)

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(redis.opsForValue().get("token:$tokenId")).contains(SECRET)
            assertThat(signedPost(tokenId)["signature"]).isEqualTo(api.tree("""{"provider":"github","valid":true,"reason":null}"""))
        }

        @Test
        @DisplayName("Dado um PUT com outro segredo, quando edita, então passa a valer o novo")
        fun update_segredoNovo_deveTrocar() {
            val tokenId = api.tokenId(GITHUB)

            put(tokenId, """{"signature":{"provider":"github","secret":"novo-segredo"}}""")

            assertThat(signedPost(tokenId)["signature"]["reason"].asString()).isEqualTo("signature mismatch")
            val body = "{}".toByteArray()
            assertThat(signedPost(tokenId, body, githubSignature(body, "novo-segredo"))["signature"]["valid"].asBoolean()).isTrue()
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um PUT sem signature ou com null, quando edita, então a URL deixa de verificar")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {}
            {"signature":null}""",
        )
        fun update_semSignature_deveRemover(fields: String) {
            val tokenId = api.tokenId(GITHUB)

            val edited = api.json(put(tokenId, fields))

            assertThat(edited["signature"].isNull).isTrue()
            assertThat(signedPost(tokenId)["signature"].isNull).isTrue()
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado uma configuração inválida, quando cria, então responde 422 com a mensagem no estilo do Laravel")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {"signature":{"secret":"abc"}}                                    | {"signature.provider":["The signature.provider field is required."]}
            {"signature":{"provider":"paypal","secret":"abc"}}                | {"signature.provider":["The selected signature.provider is invalid."]}
            {"signature":{"provider":"github"}}                               | {"signature.secret":["The signature.secret field is required."]}
            {"signature":{"provider":"github","secret":123}}                  | {"signature.secret":["The signature.secret must be a string."]}
            {"signature":{"provider":"generic","secret":"abc"}}               | {"signature.header":["The signature.header field is required."]}
            {"signature":{"provider":"generic","secret":"abc","header":"a b"}}| {"signature.header":["The signature.header is invalid."]}
            {"signature":{"provider":"generic","secret":"a","header":"X","algorithm":"md5"}} | {"signature.algorithm":["The selected signature.algorithm is invalid."]}
            {"signature":{"provider":"generic","secret":"a","header":"X","encoding":"hex64"}} | {"signature.encoding":["The selected signature.encoding is invalid."]}
            {"signature":{"provider":"generic","secret":"a","header":"X","prefix":1}} | {"signature.prefix":["The signature.prefix must be a string."]}
            {"signature":{"provider":"stripe","secret":"a","toleranceSeconds":0}} | {"signature.toleranceSeconds":["The signature.toleranceSeconds must be between 1 and 86400."]}
            {"signature":{"provider":"slack","secret":"a","toleranceSeconds":86401}} | {"signature.toleranceSeconds":["The signature.toleranceSeconds must be between 1 and 86400."]}
            {"signature":{"provider":"slack","secret":"a","toleranceSeconds":"x"}} | {"signature.toleranceSeconds":["The signature.toleranceSeconds must be an integer."]}
            {"signature":"github"}                                            | {"signature":["The signature must be an object."]}""",
        )
        fun create_configuracaoInvalida_deveResponder422(
            fields: String,
            errors: String,
        ) {
            val response = api.send("POST", "/token", fields.toByteArray(), JSON_BODY)

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(api.tree(errors))
        }

        @Test
        @DisplayName("Dado um segredo de 256 caracteres e outro de 257, quando cria, então aceita o primeiro e recusa o segundo")
        fun create_tamanhoDoSegredo_deveRespeitarOLimite() {
            val limit =
                api.send(
                    "POST",
                    "/token",
                    """{"signature":{"provider":"github","secret":"${"s".repeat(256)}"}}""".toByteArray(),
                    JSON_BODY,
                )
            val above =
                api.send(
                    "POST",
                    "/token",
                    """{"signature":{"provider":"github","secret":"${"s".repeat(257)}"}}""".toByteArray(),
                    JSON_BODY,
                )

            assertThat(limit.statusCode()).isEqualTo(201)
            assertThat(above.statusCode()).isEqualTo(422)
            assertThat(
                api.json(above),
            ).isEqualTo(api.tree("""{"signature.secret":["The signature.secret may not be greater than 256 characters."]}"""))
        }

        @Test
        @DisplayName("Dado um PUT sem segredo numa URL que não tinha assinatura, quando edita, então responde 422 e nada muda")
        fun update_semSegredoAtual_deveResponder422() {
            val tokenId = api.tokenId("""{"default_content":"x"}""")

            val response = put(tokenId, """{"default_content":"y","signature":{"provider":"github"}}""")

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(api.tree("""{"signature.secret":["The signature.secret field is required."]}"""))
            assertThat(api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))["default_content"].asString()).isEqualTo("x")
        }
    }

    @Nested
    @DisplayName("Resultado na mensagem")
    inner class Message {
        @Test
        @DisplayName("Dado uma URL sem assinatura, quando recebe, então a mensagem traz signature null depois de near_miss")
        fun capture_semConfiguracao_deveGravarNull() {
            val message = signedPost(api.tokenId())

            assertThat(message["signature"].isNull).isTrue()
            assertThat(message.propertyNames().toList()).containsSubsequence("near_miss", "signature", "seq")
        }

        @Test
        @DisplayName("Dado assinatura correta, errada e ausente, quando recebe, então grava valid e o motivo")
        fun capture_github_deveGravarOResultado() {
            val tokenId = api.tokenId(GITHUB)

            val valid = signedPost(tokenId)
            val wrong = signedPost(tokenId, signature = githubSignature("outro".toByteArray()))
            val absent = signedPost(tokenId, signature = null)

            assertThat(valid["signature"]).isEqualTo(api.tree("""{"provider":"github","valid":true,"reason":null}"""))
            assertThat(wrong["signature"]).isEqualTo(api.tree("""{"provider":"github","valid":false,"reason":"signature mismatch"}"""))
            assertThat(absent["signature"])
                .isEqualTo(api.tree("""{"provider":"github","valid":false,"reason":"header X-Hub-Signature-256 absent"}"""))
        }

        @Test
        @DisplayName("Dado um corpo com UTF-8 inválido assinado, quando recebe, então valida sobre os bytes crus (o content tem U+FFFD)")
        fun capture_utf8Invalido_deveValidarOsBytesCrus() {
            val raw = byteArrayOf(0x7B, 0xC3.toByte(), 0x28, 0xFF.toByte(), 0x7D)

            val message = signedPost(api.tokenId(GITHUB), raw, contentType = "application/octet-stream")

            assertThat(message["content"].asString()).contains("�")
            assertThat(message["signature"]["valid"].asBoolean()).isTrue()
        }

        @Test
        @DisplayName("Dado um multipart assinado, quando recebe, então valida sobre o corpo inteiro que chegou")
        fun capture_multipart_deveValidarOsBytesCrus() {
            val body = multipart(listOf("evento" to "pago", "valor" to "10"))

            val message = signedPost(api.tokenId(GITHUB), body, contentType = "multipart/form-data; boundary=XyZ")

            assertThat(message["request"]["evento"].asString()).isEqualTo("pago")
            assertThat(message["signature"]["valid"].asBoolean()).isTrue()
        }

        @Test
        @DisplayName("Dado um formulário assinado, quando recebe, então valida sobre os bytes crus")
        fun capture_formulario_deveValidarOsBytesCrus() {
            val body = "a=1&b=%C3%A7".toByteArray()

            val message = signedPost(api.tokenId(GITHUB), body, contentType = "application/x-www-form-urlencoded")

            assertThat(message["signature"]["valid"].asBoolean()).isTrue()
        }
    }

    @Nested
    @DisplayName("Segredo fora do log")
    @ExtendWith(OutputCaptureExtension::class)
    inner class Logging {
        @Test
        @DisplayName("Dado criar, editar, errar a validação e receber webhooks, quando o app loga, então o segredo nunca aparece")
        fun log_fluxoCompleto_naoDeveMostrarOSegredo(output: CapturedOutput) {
            val tokenId = api.tokenId(GITHUB)
            put(tokenId, """{"signature":{"provider":"github","secret":"$SECRET","toleranceSeconds":"x"}}""")
            put(tokenId, """{"signature":{"provider":"generic","secret":"$SECRET"}}""")
            signedPost(tokenId)
            signedPost(tokenId, signature = "sha256=00")

            assertThat(output.all).doesNotContain(SECRET)
        }
    }

    @Nested
    @DisplayName("Condição de regra")
    inner class Rules {
        private fun saveRules(
            tokenId: String,
            json: String,
        ) = api.send("PUT", "/token/$tokenId/rules", json.toByteArray(), JSON_BODY)

        @Test
        @DisplayName(
            "Dado uma regra para assinatura inválida, quando chegam válida, inválida e sem assinatura, então só a inválida leva 401",
        )
        fun capture_regraInvalida_deveResponder401SoParaInvalida() {
            val tokenId = api.tokenId(GITHUB)
            saveRules(tokenId, """[{"name":"recusa","match":{"signature":"invalid"},"response":{"status":401}}]""")
            val body = "{}".toByteArray()
            val headers = mapOf("Content-Type" to "application/json")

            val invalid = api.send("POST", "/$tokenId", body, headers + ("X-Hub-Signature-256" to "sha256=00"))
            val valid = api.send("POST", "/$tokenId", body, headers + ("X-Hub-Signature-256" to githubSignature(body)))
            val absent = api.send("POST", "/$tokenId", body, headers)

            assertThat(invalid.statusCode()).isEqualTo(401)
            assertThat(valid.statusCode()).isEqualTo(200)
            assertThat(absent.statusCode()).isEqualTo(200)
        }

        @Test
        @DisplayName("Dado regras para valid e absent, quando chegam, então cada uma casa a sua e o near miss diz o motivo")
        fun capture_validEAbsent_deveCasarENearMiss() {
            val tokenId = api.tokenId(GITHUB)
            saveRules(
                tokenId,
                """[{"name":"ok","match":{"signature":"valid"},"response":{"status":202}},""" +
                    """{"name":"sem","match":{"method":["PUT"],"signature":"absent"},"response":{"status":203}}]""",
            )

            val valid = signedPost(tokenId)
            val absent = api.capture(tokenId, method = "PUT", body = "x".toByteArray())
            val wrong = signedPost(tokenId, signature = "sha256=00")

            assertThat(valid["rule"]["name"].asString()).isEqualTo("ok")
            assertThat(absent["rule"]["name"].asString()).isEqualTo("sem")
            assertThat(
                wrong["near_miss"]["failed"],
            ).isEqualTo(api.tree("""["signature: expected valid, got invalid (signature mismatch)"]"""))
        }

        @Test
        @DisplayName("Dado mensagens já gravadas, quando testa uma regra de assinatura, então usa o resultado gravado de cada uma")
        fun test_historico_deveUsarOResultadoGravado() {
            val tokenId = api.tokenId(GITHUB)
            val valid = signedPost(tokenId)
            val absent = signedPost(tokenId, signature = null)

            val result =
                api.json(
                    api.send(
                        "POST",
                        "/token/$tokenId/rules/test",
                        """{"name":"t","match":{"signature":"valid"}}""".toByteArray(),
                        JSON_BODY,
                    ),
                )

            assertThat(result["matches"].toList().map { it["uuid"].asString() }).containsExactly(valid["uuid"].asString())
            assertThat(result["misses"].single()["uuid"].asString()).isEqualTo(absent["uuid"].asString())
            assertThat(result["misses"].single()["failed"])
                .isEqualTo(api.tree("""["signature: expected valid, got absent (header X-Hub-Signature-256 absent)"]"""))
        }

        @Test
        @DisplayName("Dado um valor fora de valid, invalid e absent, quando salva a regra, então responde 422 na chave da condição")
        fun replace_valorInvalido_deveResponder422() {
            val tokenId = api.tokenId()

            val response = saveRules(tokenId, """[{"name":"r","match":{"signature":"ok"}}]""")

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(api.tree("""{"0.match.signature":["The selected signature is invalid."]}"""))
        }

        @Test
        @DisplayName("Dado uma regra com e outra sem a condição, quando lê a lista, então a chave aparece só na que tem")
        fun all_regraSemCondicao_deveOmitirAChave() {
            val tokenId = api.tokenId()
            saveRules(tokenId, """[{"name":"a","match":{"signature":"absent"}},{"name":"b","match":{"signature":null}}]""")

            val listed = api.json(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT))

            assertThat(listed[0]["match"]["signature"].asString()).isEqualTo("absent")
            assertThat(listed[1]["match"].has("signature")).isFalse()
        }
    }
}
