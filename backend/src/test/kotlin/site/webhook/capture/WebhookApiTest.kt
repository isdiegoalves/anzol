package site.webhook.capture

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.http.MAX_BODY_BYTES
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.json.JsonMapper

@ApiTest
@DisplayName("Webhook /{token}")
class WebhookApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)
    private val form = mapOf("Content-Type" to "application/x-www-form-urlencoded")

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado qualquer método do routes.php, quando chama o webhook, então responde o padrão do token e grava")
    @ValueSource(strings = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
    fun capture_metodoSuportado_deveResponderEGravar(method: String) {
        val tokenId = api.tokenId("""{"default_content":"resposta","default_status":201}""")

        val response = api.send(method, "/$tokenId")

        assertThat(response.statusCode()).isEqualTo(201)
        assertThat(response.headers().firstValue("Content-Type")).hasValue("text/plain;charset=UTF-8")
        assertThat(response.headers().firstValue("X-Token-Id")).hasValue(tokenId)
        assertThat(response.body()).isEqualTo(if (method == "HEAD") "" else "resposta")
        val stored = api.json(api.send("GET", "/token/$tokenId/request/${response.headers().firstValue("X-Request-Id").get()}"))
        assertThat(stored["method"].asString()).isEqualTo(method)
    }

    @Test
    @DisplayName("Dado um POST de formulário com query, quando grava, então separa request, query e corpo cru como o PHP")
    fun capture_formularioComQuery_deveGravarComoOPhp() {
        val tokenId = api.tokenId()

        val stored = api.capture(tokenId, "POST", "/abc/?x=1&q=z&c[]=1", "f1=a&f2[]=b&f2[]=c&m[k]=v&d.e=1".toByteArray(), form)

        assertThat(stored["request"]).isEqualTo(api.tree("""{"f1":"a","f2":["b","c"],"m":{"k":"v"},"d_e":"1"}"""))
        assertThat(stored["query"]).isEqualTo(api.tree("""{"x":"1","q":"z","c":["1"]}"""))
        assertThat(stored["content"].asString()).isEqualTo("f1=a&f2[]=b&f2[]=c&m[k]=v&d.e=1")
        assertThat(stored["url"].asString()).isEqualTo("${api.base}/$tokenId/abc?c%5B%5D=1&q=z&x=1")
        assertThat(stored["hostname"].asString()).isEqualTo("localhost")
    }

    @Test
    @DisplayName("Dado um GET sem corpo, quando grava, então request e query são null e content-type/length vazios")
    fun capture_getSemCorpo_deveGravarCamposVazios() {
        val stored = api.capture(api.tokenId())

        assertThat(stored["request"].isNull).isTrue()
        assertThat(stored["query"].isNull).isTrue()
        assertThat(stored["content"].asString()).isEmpty()
        assertThat(stored["headers"]["content-type"]).isEqualTo(api.tree("""[""]"""))
        assertThat(stored["headers"]["content-length"]).isEqualTo(api.tree("""[""]"""))
    }

    @Test
    @DisplayName("Dado um GET com query, quando grava, então request repete a query (input source do Laravel no GET)")
    fun capture_getComQuery_deveRepetirQueryEmRequest() {
        val stored = api.capture(api.tokenId(), suffix = "?a=1")

        assertThat(stored["request"]).isEqualTo(api.tree("""{"a":"1"}"""))
    }

    @Test
    @DisplayName("Dado um corpo JSON, quando grava, então a chave request não existe")
    fun capture_corpoJson_naoDeveTerChaveRequest() {
        val stored =
            api.capture(
                api.tokenId(),
                "POST",
                body = """{"k":"v"}""".toByteArray(),
                headers = mapOf("Content-Type" to "text/json"),
            )

        assertThat(stored.has("request")).isFalse()
        assertThat(stored["content"].asString()).isEqualTo("""{"k":"v"}""")
    }

    @Test
    @DisplayName("Dado um cabeçalho com underscore, quando grava, então o nome vira hífen (#160)")
    fun capture_cabecalhoComUnderscore_deveGravarComHifen() {
        val stored = api.capture(api.tokenId(), headers = mapOf("X_Custom_Under" to "v1"))

        assertThat(stored["headers"]["x-custom-under"]).isEqualTo(api.tree("""["v1"]"""))
        assertThat(stored["headers"].has("x_custom_under")).isFalse()
    }

    @Test
    @DisplayName("Dado um corpo com UTF-8 inválido, quando grava, então aceita com U+FFFD em vez do 500 do app antigo")
    fun capture_utf8Invalido_deveAceitar() {
        val stored = api.capture(api.tokenId(), "POST", body = byteArrayOf(0xFF.toByte(), 0x41))

        assertThat(stored["content"].asString()).isEqualTo("�A")
    }

    @Test
    @DisplayName(
        "Dado o segundo segmento do caminho (\"0\" conta, só vazio é pulado), quando responde, então usa o status dele só se for válido",
    )
    fun capture_statusPeloCaminho_deveRespeitarFaixa() {
        val tokenId = api.tokenId("""{"default_status":202}""")

        assertThat(api.send("POST", "/$tokenId/404/extra").statusCode()).isEqualTo(404)
        assertThat(api.send("POST", "/$tokenId//302").statusCode()).isEqualTo(302)
        assertThat(api.send("POST", "/$tokenId/12345").statusCode()).isEqualTo(202)
        assertThat(api.send("POST", "/$tokenId/600").statusCode()).isEqualTo(202)
        assertThat(api.send("POST", "/$tokenId/0/404").statusCode()).isEqualTo(202)
        assertThat(api.send("POST", "/$tokenId/0/0/404").statusCode()).isEqualTo(202)
    }

    @Test
    @DisplayName("Dado uma barra codificada no caminho, quando chama o webhook, então grava a url crua como o nginx deixava")
    fun capture_barraCodificada_deveAceitar() {
        val tokenId = api.tokenId()

        val stored = api.capture(tokenId, suffix = "/a%2Fb/404")

        assertThat(stored["url"].asString()).isEqualTo("${api.base}/$tokenId/a%2Fb/404")
    }

    @Test
    @DisplayName("Dado CORS ligado, quando chega um preflight, então o webhook grava e responde com os 4 cabeçalhos")
    fun capture_preflightComCors_deveGravarEResponderCabecalhos() {
        val tokenId = api.tokenId()
        api.send("PUT", "/token/$tokenId/cors/toggle", headers = JSON_CLIENT)

        val response =
            api.send(
                "OPTIONS",
                "/$tokenId",
                headers =
                    mapOf(
                        "Origin" to "http://exemplo.test",
                        "Access-Control-Request-Method" to "POST",
                    ),
            )

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.headers().firstValue("X-Request-Id")).isPresent()
        CORS_HEADERS.forEach { (name, value) -> assertThat(response.headers().firstValue(name)).hasValue(value) }
    }

    @Test
    @DisplayName("Dado um corpo acima de 1 MiB, quando chama o webhook, então responde 413 e não grava")
    fun capture_corpoAcimaDoLimite_deveResponder413() {
        val tokenId = api.tokenId()

        val accepted = api.send("POST", "/$tokenId", ByteArray(MAX_BODY_BYTES) { 'a'.code.toByte() })
        val rejected = api.send("POST", "/$tokenId", ByteArray(MAX_BODY_BYTES + 1) { 'a'.code.toByte() })

        assertThat(accepted.statusCode()).isEqualTo(200)
        assertThat(rejected.statusCode()).isEqualTo(413)
        assertThat(api.json(api.send("GET", "/token/$tokenId/requests"))["total"].asInt()).isEqualTo(1)
    }

    @Test
    @DisplayName("Dado um token inexistente, quando chama o webhook como cliente comum, então responde 410 em HTML")
    fun capture_tokenInexistente_deveResponder410() {
        val response = api.send("POST", "/00000000-0000-4000-8000-000000000000/a/b")

        assertThat(response.statusCode()).isEqualTo(410)
        assertThat(response.body()).contains("<title>Error: Token not found</title>")
    }
}
