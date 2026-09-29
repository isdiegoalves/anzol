package anzol.outbound

import anzol.support.ApiClient
import anzol.support.JSON_CLIENT
import anzol.support.PermissiveOutboundApiTest
import anzol.support.Receiver
import anzol.support.chunked
import anzol.support.outbound
import anzol.support.rawHttp
import anzol.support.replay
import anzol.support.reply
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.json.JsonMapper
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

/** Cabeçalhos da captura que o replay não repassa (§1), além do `Host` e do `Content-Length`, que o cliente reescreve. */
private val FILTERED =
    listOf(
        "Keep-Alive: timeout=5",
        "TE: trailers",
        "Trailer: X-Fim",
        "Upgrade-Insecure-Requests: 1",
        "Proxy-Authorization: Basic cHJveHk6c2VjcmV0",
        "Proxy-Connection: keep-alive",
        "X-Forwarded-For: 203.0.113.9",
        "X-Forwarded-Proto: https",
        "X-Real-IP: 203.0.113.9",
        "CF-Connecting-IP: 203.0.113.9",
        "CF-Ray: 8a1b2c3d4e5f",
    )

private val KEPT = listOf("X-Pedido: 42", "User-Agent: Stripe/1.0", "Content-Type: application/json; charset=utf-8", "Accept: */*")

@PermissiveOutboundApiTest
@DisplayName("POST /token/{id}/request/{rid}/replay")
class ReplayApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)
    private val receivers = mutableListOf<Receiver>()

    private fun receiver(receiver: Receiver = Receiver()) = receiver.also { receivers.add(it) }

    @AfterEach
    fun close() = receivers.forEach { it.close() }

    /** Captura crua (cabeçalhos que o cliente do JDK não manda, corpo chunked) e devolve o id da mensagem. */
    private fun captured(
        tokenId: String,
        target: String,
        body: ByteArray,
    ): String {
        val headers = FILTERED + KEPT + "Transfer-Encoding: chunked"
        val response = rawHttp(port, "POST /$tokenId$target HTTP/1.1", headers, chunked(body, size = 7))
        return checkNotNull(response.headers["x-request-id"])
    }

    @Test
    @DisplayName(
        "Dada uma mensagem gravada, quando reenvia com keep_path, então chegam método, caminho, query, cabeçalhos filtrados e corpo",
    )
    fun replay_keepPath_deveReenviarAMensagem() {
        val target = receiver(Receiver { it.reply(201, "criado".toByteArray(), mapOf("X-Resposta" to "sim")) })
        val tokenId = api.tokenId()
        val body = "{\"pedido\":42,\"nome\":\"João\"}".toByteArray(UTF_8)
        val requestId = captured(tokenId, "/pedidos/novo?b=2&a=1", body)

        val result = api.json(api.replay(tokenId, requestId, """{"url":"${target.url("/hooks")}"}"""))

        val received = target.received.single()
        assertThat(received.method).isEqualTo("POST")
        // A `url` gravada guarda a query com os pares em ordem alfabética (como o app antigo).
        assertThat(received.target).isEqualTo("/hooks/pedidos/novo?a=1&b=2")
        assertThat(received.body).isEqualTo(body)
        assertThat(received.header("x-pedido")).isEqualTo("42")
        assertThat(received.header("user-agent")).isEqualTo("Stripe/1.0")
        assertThat(received.header("content-type")).isEqualTo("application/json; charset=utf-8")
        assertThat(received.header("host")).isEqualTo("127.0.0.1:${target.port}")
        assertThat(received.headers.keys)
            .doesNotContain("keep-alive", "te", "trailer", "transfer-encoding", "proxy-authorization", "proxy-connection")
            .noneMatch { it.startsWith("x-forwarded-") || it.startsWith("cf-") || it == "x-real-ip" }
        // Upgrade-Insecure-Requests não é o `upgrade` hop-by-hop: segue como gravado.
        assertThat(received.header("upgrade-insecure-requests")).isEqualTo("1")
        assertThat(result["kind"].asString()).isEqualTo("replay")
        assertThat(result["status"].asInt()).isEqualTo(201)
        assertThat(result["body"].asString()).isEqualTo("criado")
        assertThat(result["headers"]["x-resposta"][0].asString()).isEqualTo("sim")
        assertThat(result["truncated"].asBoolean()).isFalse()
        assertThat(result["source_request"].asString()).isEqualTo(requestId)
        assertThat(result["target"].asString()).isEqualTo(target.url("/hooks/pedidos/novo?a=1&b=2"))
        assertThat(result["request_headers"].propertyNames()).contains("x-pedido").doesNotContain("x-forwarded-for", "host")
        assertThat(result.has("error")).isFalse()
        assertThat(api.outbound(tokenId)).isEqualTo(api.tree("[$result]"))
    }

    @Test
    @DisplayName("Dado keep_path false, quando reenvia, então vai para a URL dada, sem o caminho da mensagem")
    fun replay_semKeepPath_deveUsarAUrlDada() {
        val target = receiver()
        val tokenId = api.tokenId()
        val requestId = captured(tokenId, "/a/b?x=1", "x".toByteArray())

        api.replay(tokenId, requestId, """{"url":"${target.url("/so-aqui?k=v")}","keep_path":false}""")

        assertThat(target.received.single().target).isEqualTo("/so-aqui?k=v")
    }

    @Test
    @DisplayName("Dado um caminho com caractere que não vale em URI, quando reenvia com keep_path, então sai escapado")
    fun replay_caminhoCru_deveSairEscapado() {
        val target = receiver()
        val tokenId = api.tokenId()
        val requestId = checkNotNull(rawHttp(port, "GET /$tokenId/a%20b/{x}|y?q=1&r HTTP/1.1").headers["x-request-id"])

        api.replay(tokenId, requestId, """{"url":"${target.url("/base/?k=v")}"}""")

        assertThat(target.received.single().target).isEqualTo("/base/a%20b/%7Bx%7D%7Cy?k=v&q=1&r")
    }

    @Test
    @DisplayName("Dada uma URL bloqueada, quando reenvia, então responde 200 com error.kind blocked e grava no histórico")
    fun replay_bloqueado_deveVoltarComoErroDeSaida() {
        val tokenId = api.tokenId()
        val requestId = api.capture(tokenId)["uuid"].asString()

        val response = api.replay(tokenId, requestId, """{"url":"http://169.254.169.254/latest/meta-data"}""")

        val result = api.json(response)
        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(result["error"]["kind"].asString()).isEqualTo("blocked")
        assertThat(result.has("status")).isFalse()
        assertThat(api.outbound(tokenId)[0]["error"]["kind"].asString()).isEqualTo("blocked")
    }

    @Test
    @DisplayName("Dado token ou mensagem inexistente, quando reenvia, então 410 ou 404")
    fun replay_inexistente_deveResponder410Ou404() {
        val tokenId = api.tokenId()
        val body = """{"url":"http://127.0.0.1:1/"}"""

        assertThat(api.replay(UUID.randomUUID().toString(), UUID.randomUUID().toString(), body).statusCode()).isEqualTo(410)
        assertThat(api.replay(tokenId, UUID.randomUUID().toString(), body).statusCode()).isEqualTo(404)
    }

    @Test
    @DisplayName("Dado um corpo inválido, quando reenvia, então 422 nas chaves dos campos")
    fun replay_invalido_deveResponder422() {
        val tokenId = api.tokenId()
        val requestId = api.capture(tokenId)["uuid"].asString()
        val tooLong = "http://127.0.0.1/" + "a".repeat(MAX_URL_LENGTH)

        val cases =
            mapOf(
                "{}" to "url",
                """{"url":5}""" to "url",
                """{"url":"$tooLong"}""" to "url",
                """{"url":"http://127.0.0.1/","keep_path":"sim"}""" to "keep_path",
                """{"url":"http://127.0.0.1/","timeout":999}""" to "timeout",
                """{"url":"http://127.0.0.1/","timeout":30001}""" to "timeout",
                """[1]""" to "replay",
            )

        cases.forEach { (body, key) ->
            val response = api.replay(tokenId, requestId, body)
            assertThat(response.statusCode()).describedAs(body).isEqualTo(422)
            assertThat(api.json(response).propertyNames()).describedAs(body).contains(key)
        }
        assertThat(api.send("GET", "/token/$tokenId/outbound", headers = JSON_CLIENT).body()).isEqualTo("[]")
    }
}
