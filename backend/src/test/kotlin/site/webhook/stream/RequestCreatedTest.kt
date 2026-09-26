package site.webhook.stream

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import site.webhook.RequestId
import site.webhook.TokenId
import site.webhook.capture.CapturedRequest
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.kotlinModule
import java.time.LocalDateTime
import java.util.UUID

@DisplayName("Evento request.created")
class RequestCreatedTest {
    private val jsonMapper = JsonMapper.builder().addModule(kotlinModule()).build()

    private fun message(content: String) =
        CapturedRequest(
            uuid = RequestId(UUID.randomUUID()),
            tokenId = TokenId(UUID.randomUUID()),
            ip = "10.0.0.1",
            hostname = "localhost",
            method = "POST",
            userAgent = "teste",
            content = content,
            query = null,
            headers = mapOf("content-type" to listOf("text/plain")),
            url = "http://localhost/x",
            createdAt = LocalDateTime.of(2026, 9, 26, 0, 0),
            updatedAt = LocalDateTime.of(2026, 9, 26, 0, 0),
        )

    @Nested
    @DisplayName("phpJsonLength")
    inner class PhpJsonLength {
        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado um JSON, quando mede como o json_encode do PHP, então conta \\/ e \\uXXXX")
        @CsvSource("'\"a\"', 3", "'\"/\"', 4", "'\"ç\"', 8", "'\"😀\"', 14", "'\"\"', 2")
        fun phpJsonLength_caracteresEscapados_deveContarComoOPhp(
            json: String,
            expected: Long,
        ) {
            assertThat(phpJsonLength(json)).isEqualTo(expected)
        }
    }

    @Nested
    @DisplayName("toRequestCreated")
    inner class ToRequestCreated {
        @Test
        @DisplayName("Dado 990.000 letras, quando monta o evento, então não corta e manda a mensagem inteira")
        fun toRequestCreated_abaixoDoLimite_deveMandarTudo() {
            val event = message("a".repeat(990_000)).toRequestCreated(total = 1, jsonMapper = jsonMapper)

            assertThat(event.truncated).isFalse()
            assertThat(event.request["content"].asString()).hasSize(990_000)
            assertThat(event.request.has("headers")).isTrue()
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um corpo que o PHP escaparia além de 1.000.000 caracteres, quando monta o evento, então corta")
        @CsvSource("/, 600000", "ç, 200000")
        fun toRequestCreated_acimaDoLimitePhp_deveCortarCorpo(
            char: String,
            count: Int,
        ) {
            val captured = message(char.repeat(count))

            val event = captured.toRequestCreated(total = 7, jsonMapper = jsonMapper)

            assertThat(event.truncated).isTrue()
            assertThat(event.total).isEqualTo(7)
            assertThat(event.request.has("content")).isFalse()
            assertThat(event.request.has("headers")).isFalse()
            assertThat(event.request.has("user_agent")).isFalse()
            assertThat(event.request["uuid"].asString()).isEqualTo(captured.uuid.toString())
        }
    }
}
