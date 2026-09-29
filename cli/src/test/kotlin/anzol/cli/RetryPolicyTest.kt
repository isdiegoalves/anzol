package anzol.cli

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import java.time.Duration
import java.time.Instant

private val NOW: Instant = Instant.parse("2026-09-26T14:00:00Z")

private fun policy(
    backoff: RetryBackoff = RetryBackoff.EXPONENTIAL,
    initialMs: Long = 1000,
    maxMs: Long = 30_000,
) = RetryPolicy(retries = 10, backoff = backoff, initialDelay = Duration.ofMillis(initialMs), maxDelay = Duration.ofMillis(maxMs))

@DisplayName("Política de retentativa do send")
class RetryPolicyTest {
    @Nested
    @DisplayName("Backoff")
    inner class Backoff {
        @ParameterizedTest(name = "depois da tentativa {0}: {1} ms")
        @CsvSource("1, 1000", "2, 2000", "3, 4000", "5, 16000", "6, 30000", "10, 30000")
        @DisplayName("Dado o exponencial, quando calcula a espera, então é initial × 2^(n-1) até o teto")
        fun wait_exponencial_deveDobrarAteOTeto(
            attempt: Int,
            expectedMs: Long,
        ) {
            assertThat(
                policy().wait(attempt, retryAfter = null, now = NOW),
            ).isEqualTo(Wait(Duration.ofMillis(expectedMs), fromRetryAfter = false))
        }

        @ParameterizedTest(name = "depois da tentativa {0}")
        @ValueSource(ints = [1, 4, 10])
        @DisplayName("Dado o fixo, quando calcula a espera, então é sempre a inicial")
        fun wait_fixo_deveSerSempreAInicial(attempt: Int) {
            assertThat(policy(RetryBackoff.FIXED, initialMs = 250).wait(attempt, null, NOW).delay).isEqualTo(Duration.ofMillis(250))
        }

        @Test
        @DisplayName("Dado a espera inicial acima do teto, quando calcula, então fica no teto")
        fun wait_inicialAcimaDoTeto_deveFicarNoTeto() {
            assertThat(policy(RetryBackoff.FIXED, initialMs = 5000, maxMs = 1000).wait(1, null, NOW).delay).isEqualTo(Duration.ofSeconds(1))
        }
    }

    @Nested
    @DisplayName("Retry-After")
    inner class RetryAfterHeader {
        @Test
        @DisplayName("Dado Retry-After em segundos, quando calcula a espera, então usa ele no lugar do backoff")
        fun wait_retryAfterEmSegundos_deveUsarOHeader() {
            val wait = policy().wait(1, parseRetryAfter("3"), NOW)

            assertThat(wait).isEqualTo(Wait(Duration.ofSeconds(3), fromRetryAfter = true))
        }

        @Test
        @DisplayName("Dado Retry-After acima do teto, quando calcula a espera, então fica no --max-delay")
        fun wait_retryAfterAcimaDoTeto_deveFicarNoTeto() {
            val wait = policy(maxMs = 2000).wait(1, parseRetryAfter("120"), NOW)

            assertThat(wait).isEqualTo(Wait(Duration.ofSeconds(2), fromRetryAfter = true))
        }

        @Test
        @DisplayName("Dado Retry-After em data HTTP, quando calcula a espera, então espera até ela")
        fun wait_retryAfterEmData_deveEsperarAteAData() {
            val wait = policy().wait(1, parseRetryAfter("Sat, 26 Sep 2026 14:00:05 GMT"), NOW)

            assertThat(wait).isEqualTo(Wait(Duration.ofSeconds(5), fromRetryAfter = true))
        }

        @Test
        @DisplayName("Dado Retry-After com data no passado, quando calcula a espera, então não espera")
        fun wait_retryAfterNoPassado_deveSerZero() {
            val wait = policy().wait(1, parseRetryAfter("Sat, 26 Sep 2026 13:59:00 GMT"), NOW)

            assertThat(wait).isEqualTo(Wait(Duration.ZERO, fromRetryAfter = true))
        }

        @ParameterizedTest(name = "''{0}''")
        @ValueSource(strings = ["", "-1", "1.5", "amanhã", "999999999999999999999"])
        @DisplayName("Dado Retry-After malformado, quando lê, então é ignorado (vale o backoff)")
        fun parseRetryAfter_malformado_deveSerNulo(value: String) {
            assertThat(parseRetryAfter(value)).isNull()
        }

        @Test
        @DisplayName("Dado nenhum Retry-After, quando lê, então é nulo")
        fun parseRetryAfter_ausente_deveSerNulo() {
            assertThat(parseRetryAfter(null)).isNull()
        }
    }

    @Nested
    @DisplayName("O que retenta")
    inner class Retryable {
        @ParameterizedTest(name = "{0} → retenta={1}, entregue={2}")
        @CsvSource(
            "200, false, true",
            "204, false, true",
            "301, false, false",
            "400, false, false",
            "404, false, false",
            "422, false, false",
            "429, true, false",
            "500, true, false",
            "503, true, false",
        )
        @DisplayName("Dado o status da resposta, quando decide, então retenta só em 5xx e 429 e entrega só em 2xx")
        fun answer_status_deveDecidirRetentativaEEntrega(
            status: Int,
            retryable: Boolean,
            delivered: Boolean,
        ) {
            val answer = Answer.Status(status, retryAfter = null)

            assertThat(answer.retryable()).isEqualTo(retryable)
            assertThat(answer.delivered()).isEqualTo(delivered)
        }

        @Test
        @DisplayName("Dado erro de rede, quando decide, então retenta e não entrega")
        fun answer_falhaDeRede_deveRetentar() {
            val answer = Answer.Failure("connection refused")

            assertThat(answer.retryable()).isTrue()
            assertThat(answer.delivered()).isFalse()
        }
    }
}
