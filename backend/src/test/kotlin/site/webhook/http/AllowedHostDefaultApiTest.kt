package site.webhook.http

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.support.ApiTest
import site.webhook.support.rawHttp

/** Sem `WEBHOOK_ALLOWED_HOSTS` (o padrão do app): a lista fechada, só o loopback e o host do Docker. */
@ApiTest
@DisplayName("Host e Origin com a lista padrão")
class AllowedHostDefaultApiTest(
    @LocalServerPort private val port: Int,
) {
    private val json = "{}".toByteArray()
    private val jsonHeaders = listOf("Content-Type: application/json", "Content-Length: ${json.size}", "Accept: application/json")

    @Test
    @DisplayName("Dado a lista padrão, quando chega Host de fora ou Origin de outra porta na gestão, então 403; loopback passa")
    fun padrao_deveSerFechado() {
        val evilHost = rawHttp(port, "POST /token HTTP/1.1", jsonHeaders, json, host = "evil.example")
        val otherPort = rawHttp(port, "POST /token HTTP/1.1", jsonHeaders + "Origin: http://localhost:1", json)
        val loopback = rawHttp(port, "POST /token HTTP/1.1", jsonHeaders + "Origin: http://[::1]:$port", json, host = "[::1]:$port")

        assertThat(evilHost.status).isEqualTo(403)
        assertThat(evilHost.body).isEqualTo("""{"error":"host not allowed"}""")
        assertThat(otherPort.status).isEqualTo(403)
        assertThat(otherPort.body).isEqualTo("""{"error":"origin not allowed"}""")
        assertThat(loopback.status).isEqualTo(201)
    }
}
