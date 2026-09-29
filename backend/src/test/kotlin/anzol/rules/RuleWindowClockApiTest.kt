package anzol.rules

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import tools.jackson.databind.json.JsonMapper
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.concurrent.atomic.AtomicLong

/** Relógio que anda um segundo a cada leitura: cada `clock.instant()` da captura cai num segundo diferente. */
class SteppingClock : Clock() {
    private val start = Instant.now()
    private val reads = AtomicLong()

    override fun instant(): Instant = start.plus(Duration.ofSeconds(reads.getAndIncrement()))

    override fun getZone(): ZoneId = ZoneOffset.UTC

    override fun withZone(zone: ZoneId): Clock = this
}

@TestConfiguration(proxyBeanMethods = false)
class SteppingClockConfiguration {
    @Bean
    @Primary
    fun steppingClock(): Clock = SteppingClock()
}

@ApiTest
@Import(SteppingClockConfiguration::class)
@DisplayName("Janela julgada pelo created_at gravado")
class RuleWindowClockApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName(
        "Dado um relógio que muda de segundo a cada leitura, quando o webhook chega fora da janela, então a hora do near miss é o " +
            "created_at gravado, e o trace diz o mesmo",
    )
    fun capture_janela_deveUsarOCreatedAtGravado() {
        val tokenId = api.tokenId()
        val rules = """[{"name":"futura","active_from":"2099-01-01T00:00:00Z"}]"""
        check(api.send("PUT", "/token/$tokenId/rules", rules.toByteArray(), JSON_BODY).statusCode() == 200)

        val message = api.capture(tokenId)

        val receivedAt = message["created_at"].asString().replace(' ', 'T') + "Z"
        val phrase = "window: opens at 2099-01-01T00:00:00Z, received at $receivedAt"
        val trace = api.json(api.send("GET", "/token/$tokenId/request/${message["uuid"].asString()}/rules/trace", headers = JSON_CLIENT))
        assertThat(message["near_miss"]["failed"]).isEqualTo(api.tree("""["$phrase"]"""))
        assertThat(trace["rules"][0]["failed"]).isEqualTo(api.tree("""["$phrase"]"""))
    }
}
