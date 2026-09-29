package anzol.outbound

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.Receiver
import anzol.support.replay
import anzol.support.sendOut
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.json.JsonMapper

/** O padrão do app (`allow-private=false`, sem alias): o que se publica. */
@ApiTest
@DisplayName("Replay e send com o padrão seguro (allow-private=false)")
class OutboundStrictApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    @ParameterizedTest(name = "{0}")
    @ValueSource(
        strings = [
            "http://127.0.0.1:{port}/",
            "http://localhost:{port}/",
            "http://[::1]:{port}/",
            "http://2130706433:{port}/",
            "http://[::ffff:127.0.0.1]:{port}/",
        ],
    )
    @DisplayName("Dado um receptor no loopback, quando envia ou reenvia, então é bloqueado com a mensagem genérica e nada chega")
    fun loopback_deveSerBloqueado(template: String) {
        Receiver().use { target ->
            val tokenId = api.tokenId()
            val requestId = api.capture(tokenId)["uuid"].asString()
            val url = template.replace("{port}", target.port.toString())

            val sent = api.json(api.sendOut(tokenId, """{"url":"$url"}"""))
            val replayed = api.json(api.replay(tokenId, requestId, """{"url":"$url"}"""))

            listOf(sent, replayed).forEach { result ->
                assertThat(result["error"]["kind"].asString()).isEqualTo("blocked")
                assertThat(result["error"]["message"].asString()).isEqualTo(NOT_ALLOWED)
            }
            assertThat(target.received).isEmpty()
        }
    }

    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = ["http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "http://192.168.0.1/", "http://[fd00::1]/"])
    @DisplayName("Dado um destino de metadados ou de rede privada, quando envia, então é bloqueado")
    fun privadoOuMetadados_deveSerBloqueado(url: String) {
        val tokenId = api.tokenId()

        assertThat(api.json(api.sendOut(tokenId, """{"url":"$url"}"""))["error"]["kind"].asString()).isEqualTo("blocked")
    }
}
