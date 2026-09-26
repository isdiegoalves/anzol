package site.webhook.outbound

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.ApiClient
import site.webhook.support.JSON_CLIENT
import site.webhook.support.PermissiveOutboundApiTest
import site.webhook.support.Receiver
import site.webhook.support.outbound
import site.webhook.support.sendOut
import tools.jackson.databind.json.JsonMapper
import java.nio.charset.StandardCharsets.UTF_8

private const val SECRET = "segredo-do-send-7Kq2"

@PermissiveOutboundApiTest
@ExtendWith(OutputCaptureExtension::class)
@DisplayName("POST /token/{id}/send")
class SendApiTest(
    @LocalServerPort private val port: Int,
    private val jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)
    private val receivers = mutableListOf<Receiver>()

    private fun receiver() = Receiver().also { receivers.add(it) }

    @AfterEach
    fun close() = receivers.forEach { it.close() }

    private fun json(vararg fields: Pair<String, Any>): String = jsonMapper.writeValueAsString(mapOf(*fields))

    @Test
    @DisplayName("Dado método, cabeçalhos e corpo, quando envia sem assinatura, então chegam como montados e a resposta volta")
    fun send_semAssinatura_deveEnviarOMontado() {
        val target = receiver()
        val tokenId = api.tokenId()

        val result =
            api.json(
                api.sendOut(
                    tokenId,
                    json(
                        "url" to target.url("/in?x=1"),
                        "method" to "put",
                        "headers" to mapOf("X-Um" to "1", "Content-Type" to "text/plain", "Content-Length" to "999", "Host" to "evil.test"),
                        "body" to "olá",
                    ),
                ),
            )

        val received = target.received.single()
        assertThat(received.method).isEqualTo("PUT")
        assertThat(received.target).isEqualTo("/in?x=1")
        assertThat(received.body).isEqualTo("olá".toByteArray(UTF_8))
        assertThat(received.header("x-um")).isEqualTo("1")
        assertThat(received.header("content-type")).isEqualTo("text/plain")
        assertThat(received.header("host")).isEqualTo("127.0.0.1:${target.port}")
        assertThat(result["kind"].asString()).isEqualTo("send")
        assertThat(result["method"].asString()).isEqualTo("PUT")
        assertThat(result["status"].asInt()).isEqualTo(200)
        assertThat(result["body"].asString()).isEqualTo("ok")
        assertThat(result.has("source_request")).isFalse()
        assertThat(result["request_headers"]["X-Um"].asString()).isEqualTo("1")
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(
        delimiter = '|',
        textBlock = """
        github  | X-Hub-Signature-256   |
        shopify | X-Shopify-Hmac-Sha256 |
        stripe  | Stripe-Signature      |
        slack   | X-Slack-Signature     |
        generic | X-Assinatura          | ,"header":"X-Assinatura","algorithm":"sha512","encoding":"base64","prefix":"v1="""",
    )
    @DisplayName(
        "Dada a signature da URL, quando envia com sign para a própria URL, então a verificação do app a aceita e o segredo não aparece",
    )
    fun send_assinado_deveSerAceitoPelaVerificacao(
        provider: String,
        header: String,
        settings: String?,
        output: CapturedOutput,
    ) {
        val tokenId = api.tokenId("""{"signature":{"provider":"$provider","secret":"$SECRET"${settings.orEmpty()}}}""")
        val body = """{"evento":"pago","valor":"R$ 10,00"}"""

        val response =
            api.sendOut(
                tokenId,
                json(
                    "url" to "http://localhost:$port/$tokenId/webhook",
                    "headers" to mapOf("Content-Type" to "application/json"),
                    "body" to body,
                    "sign" to true,
                ),
            )

        val captured = api.json(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT))["data"][0]
        assertThat(captured["signature"]["provider"].asString()).isEqualTo(provider)
        assertThat(captured["signature"]["valid"].asBoolean()).describedAs(captured["signature"].toString()).isTrue()
        assertThat(captured["content"].asString()).isEqualTo(body)
        val result = api.json(response)
        assertThat(result["request_headers"].propertyNames()).contains(header)
        assertThat(response.body()).doesNotContain(SECRET)
        assertThat(api.send("GET", "/token/$tokenId/outbound", headers = JSON_CLIENT).body()).doesNotContain(SECRET)
        assertThat(redis.opsForList().range("token:$tokenId:outbound", 0, -1).orEmpty()).noneMatch { SECRET in it }
        assertThat(output.all).doesNotContain(SECRET)
    }

    @Test
    @DisplayName("Dado um cabeçalho de assinatura escrito à mão, quando envia com sign, então vale o gerado")
    fun send_assinado_deveSubstituirOCabecalhoManual() {
        val target = receiver()
        val tokenId = api.tokenId("""{"signature":{"provider":"github","secret":"$SECRET"}}""")

        api.sendOut(
            tokenId,
            json(
                "url" to target.url("/"),
                "headers" to mapOf("x-hub-signature-256" to "sha256=00"),
                "body" to "{}",
                "sign" to true,
            ),
        )

        assertThat(target.received.single().headers["x-hub-signature-256"]).hasSize(1).noneMatch { it == "sha256=00" }
    }

    @Test
    @DisplayName("Dado sign sem signature na URL, quando envia, então 422 em sign e nada sai")
    fun send_signSemSignature_deveResponder422() {
        val target = receiver()
        val tokenId = api.tokenId()

        val response = api.sendOut(tokenId, json("url" to target.url("/"), "sign" to true))

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response).propertyNames()).containsExactly("sign")
        assertThat(target.received).isEmpty()
    }

    @Test
    @DisplayName("Dado um body de exatamente 1 MiB em bytes UTF-8, quando envia, então sai inteiro; com 1 byte a mais, 422 em body")
    fun send_corpo_deveAceitarAte1MiB() {
        val target = receiver()
        val tokenId = api.tokenId()
        // 2 bytes por caractere em UTF-8: o limite é em bytes, não em caracteres.
        val exact = "é".repeat(MAX_OUTBOUND_BODY / 2)

        val ok = api.sendOut(tokenId, json("url" to target.url("/"), "body" to exact))
        val over = api.sendOut(tokenId, json("url" to target.url("/"), "body" to exact + "a"))

        assertThat(ok.statusCode()).isEqualTo(200)
        assertThat(target.received.single().body).hasSize(MAX_OUTBOUND_BODY)
        assertThat(over.statusCode()).isEqualTo(422)
        assertThat(api.json(over).propertyNames()).containsExactly("body")
    }

    @Test
    @DisplayName("Dado o teto de 2 MiB só do send, quando o pedido passa dele ou outra rota passa de 1 MiB, então 413")
    fun tetoDoPedido_deveValerSoParaOSend() {
        val tokenId = api.tokenId()
        val search = "{\"text\":\"" + "a".repeat(MAX_OUTBOUND_BODY) + "\"}"

        val sendTooLarge = api.sendOut(tokenId, json("url" to "http://169.254.169.254/", "body" to "a".repeat(2 * MAX_OUTBOUND_BODY)))
        val otherRoute =
            api.send(
                "POST",
                "/token/$tokenId/requests/search",
                search.toByteArray(),
                mapOf("Content-Type" to "application/json"),
            )
        val capture = api.send("POST", "/$tokenId", ByteArray(MAX_OUTBOUND_BODY + 1))

        assertThat(sendTooLarge.statusCode()).isEqualTo(413)
        assertThat(otherRoute.statusCode()).isEqualTo(413)
        assertThat(capture.statusCode()).isEqualTo(413)
    }

    @Test
    @DisplayName("Dado um corpo inválido, quando envia, então 422 nas chaves dos campos")
    fun send_invalido_deveResponder422() {
        val tokenId = api.tokenId()
        val cases =
            mapOf(
                "{}" to "url",
                """{"url":""}""" to "url",
                """{"url":"http://127.0.0.1/","method":"TRACE"}""" to "method",
                """{"url":"http://127.0.0.1/","headers":[1]}""" to "headers",
                """{"url":"http://127.0.0.1/","headers":{"X a":"1"}}""" to "headers.X a",
                """{"url":"http://127.0.0.1/","headers":{"X-A":1}}""" to "headers.X-A",
                """{"url":"http://127.0.0.1/","headers":{"X-A":"1\r\nX-B: 2"}}""" to "headers.X-A",
                """{"url":"http://127.0.0.1/","body":{}}""" to "body",
                """{"url":"http://127.0.0.1/","sign":"sim"}""" to "sign",
                """{"url":"http://127.0.0.1/","timeout":0}""" to "timeout",
                "5" to "send",
            )

        cases.forEach { (body, key) ->
            val response = api.sendOut(tokenId, body)
            assertThat(response.statusCode()).describedAs(body).isEqualTo(422)
            assertThat(api.json(response).propertyNames()).describedAs(body).contains(key)
            api.json(response).forEach { messages -> assertThat(messages[0].asString()).matches("^[A-Z].*\\.$") }
        }
        assertThat(api.outbound(tokenId).isEmpty).isTrue()
    }

    @Test
    @DisplayName("Dados 100 cabeçalhos, um de 8192 caracteres, somando menos de 64 KiB, quando envia, então saem todos")
    fun cabecalhosNoTeto_devemSair() {
        val target = receiver()
        val tokenId = api.tokenId()
        val headers =
            (0 until MAX_SEND_HEADERS).associate {
                "X-H$it" to
                    if (it ==
                        0
                    ) {
                        "a".repeat(MAX_SEND_HEADER_VALUE)
                    } else {
                        "b".repeat(500)
                    }
            }

        val response = api.sendOut(tokenId, json("url" to target.url("/"), "headers" to headers))

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(target.received.single().header("x-h0")).hasSize(MAX_SEND_HEADER_VALUE)
        assertThat(target.received.single().header("x-h99")).isEqualTo("b".repeat(500))
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(
        "101 cabeçalhos, 101, 10",
        "valor de 8193, 1, 8193",
        "total acima de 64 KiB, 9, 8000",
    )
    @DisplayName("Dados cabeçalhos acima dos tetos e um destino que passa pela política, quando envia, então 422 em headers e nada sai")
    fun cabecalhosAcimaDoTeto_devemResponder422(
        case: String,
        count: Int,
        length: Int,
    ) {
        val target = receiver()
        val tokenId = api.tokenId()
        val headers = (0 until count).associate { "X-H$it" to "a".repeat(length) }

        val response = api.sendOut(tokenId, json("url" to target.url("/"), "headers" to headers))

        assertThat(response.statusCode()).describedAs(case).isEqualTo(422)
        assertThat(api.json(response).propertyNames()).containsExactly("headers")
        assertThat(api.json(response)["headers"][0].asString()).matches("^[A-Z].*\\.$")
        assertThat(target.received).isEmpty()
        assertThat(api.outbound(tokenId).isEmpty).isTrue()
    }

    @Test
    @DisplayName(
        "Dados cabeçalhos acima dos tetos e um destino sempre bloqueado, quando envia, então 200 blocked com os cabeçalhos cortados",
    )
    fun cabecalhosAcimaDoTeto_destinoRecusado_deveGravarCortado() {
        val tokenId = api.tokenId()
        val headers = (0 until 150).associate { "X-H$it" to "a".repeat(10_000) }

        val result = api.json(api.sendOut(tokenId, json("url" to "http://169.254.169.254/", "headers" to headers)))

        assertThat(result["error"]["kind"].asString()).isEqualTo("blocked")
        val kept = result["request_headers"].properties().map { (name, value) -> name to value.asString() }
        assertThat(kept).isNotEmpty().hasSizeLessThanOrEqualTo(MAX_SEND_HEADERS)
        assertThat(kept).allSatisfy { (_, value) -> assertThat(value).hasSize(MAX_SEND_HEADER_VALUE) }
        assertThat(kept.sumOf { (name, value) -> name.length + value.length }).isLessThanOrEqualTo(MAX_SEND_HEADERS_TOTAL)
        assertThat(api.outbound(tokenId)[0]).isEqualTo(result)
    }

    @Test
    @DisplayName("Dado um alvo com esquema proibido, inválido ou sempre bloqueado, quando envia, então 200 com o error.kind")
    fun send_falhaDeSaida_deveVoltarComoErro() {
        val tokenId = api.tokenId()

        val kinds =
            listOf("file:///etc/passwd", "http://1.2.3.4.5/", "http://0.0.0.0:8080/").map { url ->
                val response = api.sendOut(tokenId, json("url" to url))
                assertThat(response.statusCode()).isEqualTo(200)
                api.json(response)["error"]["kind"].asString()
            }

        assertThat(kinds).containsExactly("blocked", "invalid_url", "blocked")
    }
}
