package site.webhook.capture

import jakarta.servlet.http.HttpServletResponse
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.mock.web.MockHttpServletRequest

@DisplayName("Regras da resposta e da captura do webhook")
class WebhookRulesTest {
    @Nested
    @DisplayName("responseStatus")
    inner class ResponseStatus {
        @ParameterizedTest(name = "segmento {0}, padrão {1} → {2}")
        @DisplayName("Dado o segundo segmento e o padrão do token, quando escolhe o status, então usa o do caminho só se for válido")
        @CsvSource(
            nullValues = ["null"],
            value = [
                "404, 202, 404", "201abc, 202, 201", "0201, 202, 201", "600, 202, 202", "20, 202, 202",
                "null, 202, 202", "12345, 202, 202", "a201b, 202, 202", "2010, 202, 202", "101, 202, 202",
                "null, 999, 200", "12345, 0, 200", "599, 999, 599",
            ],
        )
        fun responseStatus_segmentoEPadrao_deveEscolherStatusValido(
            segment: String?,
            defaultStatus: Long,
            expected: Int,
        ) {
            assertThat(responseStatus(segment, defaultStatus)).isEqualTo(expected)
        }
    }

    @Nested
    @DisplayName("responseContentType")
    inner class ResponseContentType {
        @ParameterizedTest(name = "\"{0}\" → \"{1}\"")
        @DisplayName("Dado o Content-Type do token, quando responde, então aplica o charset do Symfony e do nginx")
        @CsvSource(
            delimiter = '|',
            value = [
                "text/plain | text/plain; charset=UTF-8", "TEXT/PLAIN | TEXT/PLAIN; charset=UTF-8",
                "text/csv;foo=bar | text/csv;foo=bar; charset=UTF-8",
                "text/plain; charset=iso-8859-1 | text/plain; charset=iso-8859-1",
                "application/json | application/json", "application/javascript | application/javascript; charset=utf-8",
                "application/rss+xml | application/rss+xml; charset=utf-8", "lixo | lixo",
            ],
        )
        fun responseContentType_tipoConfigurado_deveAplicarCharset(
            configured: String,
            expected: String,
        ) {
            assertThat(responseContentType(configured, status = 200)).isEqualTo(expected)
        }

        @ParameterizedTest(name = "\"{0}\" com status {1} → sem Content-Type")
        @DisplayName("Dado tipo vazio ou status 304, quando responde, então não manda Content-Type")
        @CsvSource("'', 200", "text/plain, 304", "'', 304")
        fun responseContentType_vazioOu304_deveOmitir(
            configured: String,
            status: Int,
        ) {
            assertThat(responseContentType(configured, status)).isNull()
        }

        @Test
        @DisplayName("Dado status 204, quando responde, então manda o Content-Type padrão do PHP-FPM")
        fun responseContentType_status204_deveUsarPadraoDoPhp() {
            assertThat(responseContentType("application/json", HttpServletResponse.SC_NO_CONTENT)).isEqualTo("text/html; charset=UTF-8")
        }
    }

    @Nested
    @DisplayName("legacyHeaders")
    inner class LegacyHeaders {
        @Test
        @DisplayName(
            "Dado cabeçalhos repetidos e com underscore, quando grava, então fica o último, em minúsculas com hífen, em ordem inversa",
        )
        fun legacyHeaders_repetidoEUnderscore_deveGravarComoOPhp() {
            val request = MockHttpServletRequest()
            request.addHeader("Host", "localhost:8085")
            request.addHeader("My_Header", "v1")
            request.addHeader("X-Dup", "1")
            request.addHeader("X-Dup", "2")

            val headers = request.legacyHeaders(bodySize = 0)

            assertThat(headers).containsExactly(
                java.util.Map.entry("x-dup", listOf("2")),
                java.util.Map.entry("my-header", listOf("v1")),
                java.util.Map.entry("host", listOf("localhost:8085")),
                java.util.Map.entry("content-length", listOf("")),
                java.util.Map.entry("content-type", listOf("")),
            )
        }

        @Test
        @DisplayName("Dado Basic Auth, quando grava, então acrescenta php-auth-user e php-auth-pw no fim")
        fun legacyHeaders_basicAuth_deveAcrescentarUsuarioESenha() {
            val request = MockHttpServletRequest()
            request.addHeader("Authorization", "Basic dXMgZXI6cDp3")

            val headers = request.legacyHeaders(bodySize = 0)

            assertThat(headers.keys).endsWith("php-auth-user", "php-auth-pw")
            assertThat(headers["php-auth-user"]).containsExactly("us er")
            assertThat(headers["php-auth-pw"]).containsExactly("p:w")
        }

        @Test
        @DisplayName("Dado Basic Auth malformado, quando grava, então não acrescenta credenciais")
        fun legacyHeaders_basicMalformado_naoDeveAcrescentarCredenciais() {
            val request = MockHttpServletRequest()
            request.addHeader("Authorization", "Basic semdoispontos")

            assertThat(request.legacyHeaders(bodySize = 0)).doesNotContainKeys("php-auth-user", "php-auth-pw")
        }
    }
}
