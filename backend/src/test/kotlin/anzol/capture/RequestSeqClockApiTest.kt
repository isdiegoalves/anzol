package anzol.capture

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
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

/** Relógio do sistema com um deslocamento que o teste move: o ajuste de NTP que volta a hora. */
class MovableClock : Clock() {
    @Volatile var offset: Duration = Duration.ZERO

    override fun instant(): Instant = Instant.now().plus(offset)

    override fun getZone(): ZoneId = ZoneOffset.UTC

    override fun withZone(zone: ZoneId): Clock = this
}

@TestConfiguration(proxyBeanMethods = false)
class MovableClockConfiguration {
    @Bean
    @Primary
    fun movableClock(): MovableClock = MovableClock()
}

/** `seq` dado à frente do relógio não volta a sair quando a mensagem que o tinha é apagada. */
@ApiTest
@Import(MovableClockConfiguration::class)
@DisplayName("seq com o relógio que volta")
class RequestSeqClockApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val clock: MovableClock,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun seqOf(
        tokenId: String,
        requestId: String,
    ): Long = api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT))["seq"].asLong()

    private fun send(tokenId: String): String =
        api
            .send("GET", "/$tokenId")
            .headers()
            .firstValue("X-Request-Id")
            .orElseThrow()

    @ParameterizedTest(name = "apagando {0}")
    @DisplayName(
        "Dado a mais nova gravada com o relógio adiantado, quando é apagada, o relógio volta e chega outra, então o seq não se repete",
    )
    @CsvSource("uma", "todas")
    fun seq_maisNovaApagadaComRelogioQueVolta_naoDeveSerReaproveitado(deleted: String) {
        val tokenId = api.tokenId()
        clock.offset = Duration.ofSeconds(10)
        val ahead = send(tokenId)
        val aheadSeq = seqOf(tokenId, ahead)
        clock.offset = Duration.ZERO
        val path = if (deleted == "uma") "/token/$tokenId/request/$ahead" else "/token/$tokenId/request"
        api.send("DELETE", path, headers = JSON_CLIENT)

        val next = send(tokenId)

        assertThat(seqOf(tokenId, next)).isGreaterThan(aheadSeq)
    }
}
