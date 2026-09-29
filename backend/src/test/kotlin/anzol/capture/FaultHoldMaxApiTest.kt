package anzol.capture

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.TestPropertySource
import tools.jackson.databind.json.JsonMapper
import java.time.Duration

/** `ANZOL_FAULT_HOLD_MAX`: o teto de uma conexão presa quando o cliente não desiste. */
@ApiTest
@TestPropertySource(properties = ["anzol.fault.hold-max=2"])
@DisplayName("Teto de tempo das conexões presas")
class FaultHoldMaxApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName(
        "Dado ANZOL_FAULT_HOLD_MAX 2, quando hang e stall_after_headers prendem sem o cliente desistir, então o servidor fecha " +
            "aos 2 s: hang sem nenhum byte, stall depois dos cabeçalhos",
    )
    fun capture_semDesistir_deveFecharNoTeto() {
        val tokenId = api.tokenId()
        val rules =
            """[{"name":"presa","match":{"path":{"equals":"/h"}},"response":{"fault":"hang"}},""" +
                """{"name":"parada","match":{"path":{"equals":"/s"}},"response":{"body":"abc","fault":"stall_after_headers"}}]"""
        check(api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY).statusCode() == 200)

        val (hang, stall) =
            RawConnection(port, "/$tokenId/h").use { hang ->
                RawConnection(port, "/$tokenId/s").use { stall -> hang.read(Duration.ofSeconds(6)) to stall.read(Duration.ofSeconds(6)) }
            }

        assertThat(hang.closed).isTrue()
        assertThat(hang.bytes).isEmpty()
        assertThat(hang.atMs).isBetween(1_900L, 4_000L)
        assertThat(stall.closed).isTrue()
        assertThat(stall.header("Content-Length")).isEqualTo("3")
        assertThat(stall.body).isEmpty()
        assertThat(stall.atMs).isBetween(1_900L, 4_000L)
    }
}
