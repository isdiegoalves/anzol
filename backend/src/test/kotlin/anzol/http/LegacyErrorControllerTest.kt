package anzol.http

import jakarta.servlet.RequestDispatcher
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.mock.web.MockHttpServletRequest

@DisplayName("LegacyErrorController")
class LegacyErrorControllerTest {
    private val controller = LegacyErrorController()

    private fun errorDispatch(status: Int): MockHttpServletRequest =
        MockHttpServletRequest("POST", "/error").apply {
            addHeader("Accept", "application/json")
            setAttribute(RequestDispatcher.ERROR_STATUS_CODE, status)
        }

    @ParameterizedTest(name = "status {0} → \"{1}\"")
    @DisplayName("Dado um erro despachado pelo Tomcat, quando o cliente pede JSON, então responde o envelope com a mensagem do Handler")
    @CsvSource("500, An internal error occurred", "405, ''", "400, ''")
    fun error_despachoDeErro_deveResponderEnvelope(
        status: Int,
        message: String,
    ) {
        val response = controller.error(errorDispatch(status))

        assertThat(response.statusCode.value()).isEqualTo(status)
        assertThat(response.body).isEqualTo(ErrorEnvelope(success = false, error = ErrorDetail(message, id = null)))
    }

    @Test
    @DisplayName("Dado um 413 despachado pelo Tomcat, quando responde, então usa a página do nginx para qualquer cliente")
    fun error_despacho413_deveResponderPaginaDoNginx() {
        val response = controller.error(errorDispatch(413))

        assertThat(response.statusCode.value()).isEqualTo(413)
        assertThat(response.body.toString()).contains("<title>413 Request Entity Too Large</title>")
    }
}
