package site.webhook.capture

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.concurrent.Executors

@ApiTest
@DisplayName("Timeout do token com threads virtuais")
class TimeoutConcurrencyTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName("Dado timeout de 2 s, quando chegam 50 requisições ao mesmo tempo, então todas respondem em cerca de 2 s")
    fun capture_cinquentaSimultaneasComTimeout_deveResponderEmParalelo() {
        val tokenId = api.tokenId("""{"timeout":2}""")
        val start = System.nanoTime()

        val statuses =
            Executors.newVirtualThreadPerTaskExecutor().use { executor ->
                (1..CONCURRENT).map { executor.submit<Int> { api.send("GET", "/$tokenId").statusCode() } }.map { it.get() }
            }

        val elapsed = Duration.ofNanos(System.nanoTime() - start)
        assertThat(statuses).hasSize(CONCURRENT).containsOnly(200)
        assertThat(elapsed).isBetween(Duration.ofSeconds(2), Duration.ofSeconds(5))
    }

    private companion object {
        const val CONCURRENT = 50
    }
}
