package anzol.http

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.SseClient
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.json.JsonMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID
import java.util.zip.GZIPInputStream

/** Um corpo de resposta padrão em JSON, acima do piso de 1 kB a partir do qual a API comprime. */
private val BIG_JSON = """{"itens":[${(1..200).joinToString(",") { "\"item-$it\"" }}]}"""

@ApiTest
@DisplayName("Compressão da API de gestão")
class ApiCompressionApiTest(
    @LocalServerPort port: Int,
    private val jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)
    private val http = HttpClient.newHttpClient()

    /** O `ApiClient` lê o corpo como texto; aqui ele vem em bytes, comprimido ou não. */
    private fun bytes(
        method: String,
        path: String,
        coding: String?,
        body: String = "",
    ): HttpResponse<ByteArray> {
        val publisher = if (body.isEmpty()) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body)
        val request = HttpRequest.newBuilder(URI.create(api.base + path)).method(method, publisher)
        JSON_BODY.forEach { (name, value) -> request.header(name, value) }
        coding?.let { request.header("Accept-Encoding", it) }
        return http.send(request.build(), HttpResponse.BodyHandlers.ofByteArray())
    }

    private fun HttpResponse<ByteArray>.coding() = headers().firstValue("Content-Encoding")

    private fun HttpResponse<ByteArray>.length() = headers().firstValue("Content-Length").orElseThrow().toInt()

    private fun HttpResponse<ByteArray>.unzipped() = GZIPInputStream(body().inputStream()).readBytes()

    /** Uma URL com mensagens bastantes para a listagem passar de 1 kB. */
    private fun tokenWithRequests(): String {
        val tokenId = api.tokenId()
        repeat(4) { api.capture(tokenId, "POST", "/pedidos/$it", """{"pedido":$it}""".toByteArray(), JSON_BODY) }
        return tokenId
    }

    @Test
    @DisplayName("Dado um cliente que aceita gzip, quando lista as mensagens, então vem em gzip e, descomprimida, igual à dos outros")
    fun listagem_comGzip_deveVirComprimidaEIgual() {
        val path = "/token/${tokenWithRequests()}/requests?page=1&sorting=newest"

        val plain = bytes("GET", path, coding = null)
        val zipped = bytes("GET", path, coding = "gzip")

        assertThat(plain.statusCode()).isEqualTo(200)
        assertThat(plain.coding()).isEmpty()
        assertThat(plain.headers().allValues("Vary")).doesNotContain("Accept-Encoding")
        assertThat(plain.body().size).isGreaterThan(1024)
        assertThat(zipped.statusCode()).isEqualTo(200)
        assertThat(zipped.coding()).hasValue("gzip")
        assertThat(zipped.headers().allValues("Vary")).contains("Accept-Encoding")
        assertThat(zipped.length()).isEqualTo(zipped.body().size).isLessThan(plain.body().size)
        assertThat(zipped.unzipped()).isEqualTo(plain.body())
        assertThat(zipped.headers().firstValue("Content-Type")).isEqualTo(plain.headers().firstValue("Content-Type"))
        assertThat(zipped.headers().firstValue("Cache-Control")).isEqualTo(plain.headers().firstValue("Cache-Control"))
    }

    @Test
    @DisplayName("Dado um cliente que aceita gzip, quando busca nas mensagens, então vem em gzip e, descomprimida, igual à dos outros")
    fun busca_comGzip_deveVirComprimidaEIgual() {
        val path = "/token/${tokenWithRequests()}/requests/search"

        val plain = bytes("POST", path, coding = null, body = """{"text":"pedidos"}""")
        val zipped = bytes("POST", path, coding = "gzip", body = """{"text":"pedidos"}""")

        assertThat(plain.statusCode()).isEqualTo(200)
        assertThat(plain.coding()).isEmpty()
        assertThat(zipped.coding()).hasValue("gzip")
        assertThat(zipped.length()).isEqualTo(zipped.body().size)
        assertThat(zipped.unzipped()).isEqualTo(plain.body())
    }

    @Test
    @DisplayName("Dado o cabeçalho do navegador (gzip, deflate, br, zstd), quando lista as mensagens, então vem em gzip")
    fun listagem_cabecalhoDoNavegador_deveVirEmGzip() {
        val response = bytes("GET", "/token/${tokenWithRequests()}/requests?page=1", coding = "gzip, deflate, br, zstd")

        assertThat(response.coding()).hasValue("gzip")
    }

    @ParameterizedTest
    @ValueSource(strings = ["br", "identity", "gzip;q=0", "deflate, br"])
    @DisplayName("Dado um cliente que não aceita gzip, quando lista as mensagens, então o corpo vem como hoje")
    fun listagem_semGzip_deveVirComoHoje(coding: String) {
        val response = bytes("GET", "/token/${tokenWithRequests()}/requests?page=1", coding)

        assertThat(response.coding()).isEmpty()
        assertThat(api.tree(response.body().decodeToString())["data"]).hasSize(4)
    }

    @Test
    @DisplayName("Dado um corpo de menos de 1 kB, quando o cliente aceita gzip, então a resposta vem como hoje")
    fun corpoPequeno_comGzip_naoDeveComprimir() {
        val tokenId = api.tokenId()

        val response = bytes("GET", "/token/$tokenId/requests?page=1", coding = "gzip")

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.coding()).isEmpty()
        assertThat(response.headers().allValues("Vary")).doesNotContain("Accept-Encoding")
        assertThat(response.body().size).isLessThan(1024)
        assertThat(api.tree(response.body().decodeToString())["data"]).isEmpty()
    }

    @Test
    @DisplayName("Dado uma URL que responde JSON grande ao webhook, quando o remetente aceita gzip, então a captura não comprime")
    fun captura_comGzip_naoDeveComprimir() {
        val fields = mapOf("default_content_type" to "application/json", "default_content" to BIG_JSON)
        val tokenId = api.tokenId(jsonMapper.writeValueAsString(fields))

        val response = bytes("POST", "/$tokenId/pedidos", coding = "gzip", body = """{"a":1}""")

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.coding()).isEmpty()
        assertThat(response.headers().allValues("Vary")).doesNotContain("Accept-Encoding")
        assertThat(response.body().decodeToString()).isEqualTo(BIG_JSON)
    }

    @ParameterizedTest
    @ValueSource(ints = [204, 304])
    @DisplayName("Dado uma URL que responde sem corpo ao webhook, quando o remetente aceita gzip, então a resposta segue a de hoje")
    fun captura_semCorpo_naoDeveMudar(status: Int) {
        val tokenId = api.tokenId("""{"default_status":$status}""")

        val response = bytes("POST", "/$tokenId", coding = "gzip", body = """{"a":1}""")

        assertThat(response.statusCode()).isEqualTo(status)
        assertThat(response.coding()).isEmpty()
        assertThat(response.body()).isEmpty()
    }

    @Test
    @DisplayName("Dado uma aba que aceita gzip, quando assina o /stream, então os eventos chegam na hora e sem compressão")
    fun stream_comGzip_deveEntregarNaHora() {
        val tokenId = api.tokenId()
        SseClient("${api.base}/token/$tokenId/stream", mapOf("Accept-Encoding" to "gzip")).use { client ->
            assertThat(client.response.headers().firstValue("Content-Encoding")).isEmpty()
            assertThat(
                client.response
                    .headers()
                    .firstValue("Content-Type")
                    .orElse(""),
            ).startsWith("text/event-stream")

            api.send("POST", "/$tokenId", """{"a":1}""".toByteArray(), JSON_BODY)

            await().atMost(Duration.ofSeconds(5)).until { client.created().isNotEmpty() }
        }
    }

    @Test
    @DisplayName("Dado um cliente que aceita gzip, quando apaga a URL, então responde 204 sem corpo e sem Content-Encoding")
    fun semConteudo_comGzip_deveSeguir204() {
        val response = bytes("DELETE", "/token/${api.tokenId()}", coding = "gzip")

        assertThat(response.statusCode()).isEqualTo(204)
        assertThat(response.coding()).isEmpty()
        assertThat(response.body()).isEmpty()
    }

    @Test
    @DisplayName("Dado um cliente que aceita gzip, quando a URL não existe, então responde o 410 de hoje")
    fun urlInexistente_comGzip_deveSeguir410() {
        val path = "/token/${UUID.randomUUID()}/requests"

        val plain = bytes("GET", path, coding = null)
        val accepting = bytes("GET", path, coding = "gzip")

        assertThat(accepting.statusCode()).isEqualTo(410)
        assertThat(accepting.coding()).isEmpty()
        assertThat(accepting.body()).isEqualTo(plain.body())
    }

    @Test
    @DisplayName("Dado um cliente que aceita gzip, quando a busca é inválida, então responde o 422 de hoje")
    fun buscaInvalida_comGzip_deveSeguir422() {
        val path = "/token/${api.tokenId()}/requests/search"

        val plain = bytes("POST", path, coding = null, body = """{"per_page":"muitas"}""")
        val accepting = bytes("POST", path, coding = "gzip", body = """{"per_page":"muitas"}""")

        assertThat(accepting.statusCode()).isEqualTo(422)
        assertThat(accepting.coding()).isEmpty()
        assertThat(accepting.body()).isEqualTo(plain.body())
    }
}
