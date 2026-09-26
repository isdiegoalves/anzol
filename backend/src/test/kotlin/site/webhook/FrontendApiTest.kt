package site.webhook

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.json.JsonMapper

/** Os arquivos de `src/test/resources/static/` fazem o papel do build do Angular. */
@ApiTest
@DisplayName("Tela servida pelo backend")
class FrontendApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName("Dado o build na imagem, quando pede /, então responde o index.html como página")
    fun raiz_deveResponderIndex() {
        val response = api.send("GET", "/")

        assertThat(response.statusCode()).isEqualTo(200)
        val contentType = response.headers().firstValue("Content-Type").orElseThrow()
        assertThat(contentType.replace(" ", "")).isEqualToIgnoringCase("text/html;charset=UTF-8")
        assertThat(response.body()).contains("index do teste")
    }

    @Test
    @DisplayName("Dado um arquivo com hash na raiz, quando pede o .js e o .css, então responde com o tipo de cada um")
    fun arquivoDoBuild_deveResponderComTipo() {
        val script = api.send("GET", "/main-TESTE123.js")
        val style = api.send("GET", "/styles-TESTE123.css")

        assertThat(script.statusCode()).isEqualTo(200)
        assertThat(script.headers().firstValue("Content-Type").orElseThrow()).startsWith("text/javascript")
        assertThat(script.body()).contains("main do teste")
        assertThat(style.statusCode()).isEqualTo(200)
        assertThat(style.headers().firstValue("Content-Type").orElseThrow()).startsWith("text/css")
    }

    @Test
    @DisplayName("Dado um arquivo que não existe, quando pede, então responde o 404 de rota com mensagem vazia")
    fun arquivoInexistente_deveResponder404DeRota() {
        val response = api.send("GET", "/main-NAOEXISTE.js", headers = JSON_CLIENT)

        assertThat(response.statusCode()).isEqualTo(404)
        assertThat(api.json(response)["error"]["message"].asString()).isEmpty()
    }
}
