package anzol

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.core.io.ClassPathResource
import tools.jackson.databind.json.JsonMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.zip.GZIPInputStream

private const val IMMUTABLE = "max-age=31536000, public, immutable"
private const val REVALIDATE = "no-cache, private"

/** Os arquivos de `src/test/resources/static/` fazem o papel do build do Angular. */
@ApiTest
@DisplayName("Tela servida pelo backend")
class FrontendApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun encoded(
        path: String,
        coding: String,
    ): HttpResponse<ByteArray> {
        val request = HttpRequest.newBuilder(URI.create(api.base + path)).header("Accept-Encoding", coding).build()
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofByteArray())
    }

    private fun cacheControl(path: String): String =
        api
            .send("GET", path)
            .headers()
            .firstValue("Cache-Control")
            .orElseThrow()

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
    @DisplayName("Dado o .br e o .gz ao lado do index.html, quando o navegador aceita br, então a página vem em br, com Vary")
    fun raiz_comBr_deveResponderBrotli() {
        listOf("br", "gzip, deflate, br, zstd").forEach { coding ->
            val response = encoded("/", coding)

            assertThat(response.statusCode()).describedAs(coding).isEqualTo(200)
            assertThat(response.headers().firstValue("Content-Encoding")).describedAs(coding).hasValue("br")
            assertThat(response.headers().allValues("Vary")).describedAs(coding).contains("Accept-Encoding")
            val page = ClassPathResource("static/index.html.br").contentAsByteArray
            assertThat(response.body()).describedAs(coding).isEqualTo(page)
            val contentType = response.headers().firstValue("Content-Type").orElseThrow()
            assertThat(contentType.replace(" ", "")).describedAs(coding).isEqualToIgnoringCase("text/html;charset=UTF-8")
            assertThat(response.headers().firstValue("Cache-Control").orElseThrow()).describedAs(coding).isEqualTo(REVALIDATE)
        }
    }

    @Test
    @DisplayName("Dado o .gz ao lado do index.html, quando o navegador só aceita gzip, então a página vem em gzip, com Vary")
    fun raiz_comGzip_deveResponderGzip() {
        val response = encoded("/", "gzip")

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.headers().firstValue("Content-Encoding")).hasValue("gzip")
        assertThat(response.headers().allValues("Vary")).contains("Accept-Encoding")
        assertThat(GZIPInputStream(response.body().inputStream()).readBytes().decodeToString()).contains("index do teste")
    }

    @Test
    @DisplayName("Dado um cliente que não aceita br nem gzip, quando pede /, então a página vem inteira, como hoje")
    fun raiz_semCodificacao_deveResponderOriginal() {
        listOf("identity", "deflate", "br;q=0, gzip;q=0").forEach { coding ->
            val response = encoded("/", coding)

            assertThat(response.statusCode()).describedAs(coding).isEqualTo(200)
            assertThat(response.headers().firstValue("Content-Encoding")).describedAs(coding).isEmpty()
            assertThat(response.body().decodeToString()).describedAs(coding).contains("index do teste")
        }
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
    @DisplayName("Dado o .gz ao lado do arquivo, quando o navegador aceita gzip, então responde o .gz com Vary: Accept-Encoding")
    fun arquivoComGz_deveResponderGzip() {
        val response = encoded("/main-TESTE123.js", "gzip")

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.headers().firstValue("Content-Encoding")).hasValue("gzip")
        assertThat(response.headers().allValues("Vary")).contains("Accept-Encoding")
        assertThat(response.headers().firstValue("Content-Type").orElseThrow()).startsWith("text/javascript")
        assertThat(GZIPInputStream(response.body().inputStream()).readBytes().decodeToString()).contains("main do teste")
    }

    @Test
    @DisplayName("Dado o .br ao lado do arquivo, quando o navegador aceita br, então responde o .br com Vary: Accept-Encoding")
    fun arquivoComBr_deveResponderBrotli() {
        val response = encoded("/main-TESTE123.js", "br")

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.headers().firstValue("Content-Encoding")).hasValue("br")
        assertThat(response.headers().allValues("Vary")).contains("Accept-Encoding")
        assertThat(response.headers().firstValue("Content-Type").orElseThrow()).startsWith("text/javascript")
        assertThat(response.body()).isEqualTo(ClassPathResource("static/main-TESTE123.js.br").contentAsByteArray)
    }

    @Test
    @DisplayName("Dado o .br e o .gz ao lado do arquivo, quando o navegador aceita os dois e lista gzip primeiro, então responde o .br")
    fun arquivoComBrEGz_deveResponderBrotliAoNavegador() {
        val response = encoded("/main-TESTE123.js", "gzip, deflate, br, zstd")

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.headers().firstValue("Content-Encoding")).hasValue("br")
        assertThat(response.body()).isEqualTo(ClassPathResource("static/main-TESTE123.js.br").contentAsByteArray)
    }

    @Test
    @DisplayName("Dado um arquivo sem .gz nem .br ao lado, quando o navegador aceita gzip ou br, então responde o original")
    fun arquivoSemComprimido_deveResponderOriginal() {
        listOf("gzip", "br").forEach { coding ->
            val response = encoded("/styles-TESTE123.css", coding)

            assertThat(response.statusCode()).describedAs(coding).isEqualTo(200)
            assertThat(response.headers().firstValue("Content-Encoding")).describedAs(coding).isEmpty()
            assertThat(response.body().decodeToString()).describedAs(coding).contains("margin: 0")
        }
    }

    @Test
    @DisplayName("Dado um arquivo com hash no nome (main, chunk, styles), quando pede, então o navegador pode guardar sem revalidar")
    fun nomeComHash_deveResponderImmutable() {
        listOf("/main-TESTE123.js", "/chunk--TESTE_1.js", "/styles-TESTE123.css").forEach { path ->
            assertThat(cacheControl(path)).describedAs(path).isEqualTo(IMMUTABLE)
        }
    }

    @Test
    @DisplayName("Dado o index.html, o favicon e um .js fora dos três nomes com hash, quando pede, então o navegador revalida sempre")
    fun foraDosNomesComHash_deveResponderNoCache() {
        listOf("/", "/favicon.ico", "/polyfills-TESTE123.js").forEach { path ->
            assertThat(cacheControl(path)).describedAs(path).isEqualTo(REVALIDATE)
        }
    }

    @Test
    @DisplayName("Dado um nome com hash que não existe, quando pede, então o 404 não fica guardado no navegador")
    fun nomeComHashInexistente_naoDeveResponderImmutable() {
        val response = api.send("GET", "/chunk-NAOEXISTE.js", headers = JSON_CLIENT)

        assertThat(response.statusCode()).isEqualTo(404)
        assertThat(response.headers().firstValue("Cache-Control").orElseThrow()).isEqualTo(REVALIDATE)
    }

    @Test
    @DisplayName("Dada uma fonte do build, quando pede /fonts/x.woff2, então responde font/woff2 que o navegador revalida")
    fun fonte_deveResponderWoff2ComRevalidacao() {
        val response = api.send("GET", "/fonts/teste.woff2")

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.headers().firstValue("Content-Type").orElseThrow()).isEqualTo("font/woff2")
        assertThat(response.headers().firstValue("Cache-Control").orElseThrow()).isEqualTo("no-cache")
        assertThat(response.body()).contains("fonte do teste")
    }

    @Test
    @DisplayName("Dada uma fonte já baixada, quando o navegador revalida com If-Modified-Since, então responde 304 sem corpo")
    fun fonteRevalidada_deveResponder304() {
        val lastModified =
            api
                .send("GET", "/fonts/teste.woff2")
                .headers()
                .firstValue("Last-Modified")
                .orElseThrow()

        val response = api.send("GET", "/fonts/teste.woff2", headers = mapOf("If-Modified-Since" to lastModified))

        assertThat(response.statusCode()).isEqualTo(304)
        assertThat(response.body()).isEmpty()
    }

    @Test
    @DisplayName("Dado um arquivo em /fonts que não é .woff2, quando pede, então responde o 404 de rota mesmo existindo")
    fun arquivoDeFonteSemWoff2_deveResponder404DeRota() {
        val response = api.send("GET", "/fonts/teste.txt", headers = JSON_CLIENT)

        assertThat(response.statusCode()).isEqualTo(404)
        assertThat(api.json(response)["error"]["message"].asString()).isEmpty()
    }

    @Test
    @DisplayName("Dado um arquivo que não existe, quando pede, então responde o 404 de rota com mensagem vazia")
    fun arquivoInexistente_deveResponder404DeRota() {
        val response = api.send("GET", "/main-NAOEXISTE.js", headers = JSON_CLIENT)

        assertThat(response.statusCode()).isEqualTo(404)
        assertThat(api.json(response)["error"]["message"].asString()).isEmpty()
    }
}
