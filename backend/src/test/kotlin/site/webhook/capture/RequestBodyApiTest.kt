package site.webhook.capture

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.http.MAX_BODY_BYTES
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_CLIENT
import site.webhook.support.RawResponse
import site.webhook.support.chunked
import site.webhook.support.multipart
import site.webhook.support.rawHttp
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** Corpos que o PHP-FPM atrás do nginx gravava e o Tomcat recusava ou gravava diferente. */
@ApiTest
@DisplayName("Corpo da requisição como o nginx + PHP o entregavam")
class RequestBodyApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun stored(
        tokenId: String,
        response: RawResponse,
    ): JsonNode {
        val requestId = checkNotNull(response.headers["x-request-id"]) { "sem X-Request-Id (status ${response.status})" }
        return api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT))
    }

    private fun postMultipart(
        tokenId: String,
        body: ByteArray,
        contentType: String = "multipart/form-data; boundary=XyZ",
    ): RawResponse = rawHttp(port, "POST /$tokenId HTTP/1.1", listOf("Content-Type: $contentType", "Content-Length: ${body.size}"), body)

    @Nested
    @DisplayName("Multipart sem limite de partes (o teto é o corpo de 1 MiB)")
    inner class MultipartLimits {
        @ParameterizedTest(name = "{0} campos")
        @DisplayName("Dado um multipart com mais de 50 campos, quando chama o webhook, então grava todos em request")
        @ValueSource(ints = [51, 200])
        fun capture_multipartComMuitosCampos_deveGravarTodos(count: Int) {
            val tokenId = api.tokenId()
            val fields = (0 until count).map { "f$it" to "v$it" }

            val response = postMultipart(tokenId, multipart(fields))

            assertThat(response.status).isEqualTo(200)
            val stored = stored(tokenId, response)
            assertThat(stored["request"].propertyNames()).hasSize(count)
            assertThat(stored["request"]["f${count - 1}"].asString()).isEqualTo("v${count - 1}")
            assertThat(stored["content"].asString()).isEmpty()
        }

        @Test
        @DisplayName("Dado um campo multipart com nome de 1000 caracteres, quando chama o webhook, então grava o campo")
        fun capture_cabecalhoDeParteGrande_deveGravar() {
            val tokenId = api.tokenId()
            val name = "n".repeat(1000)

            val response = postMultipart(tokenId, multipart(listOf(name to "v")))

            assertThat(response.status).isEqualTo(200)
            assertThat(stored(tokenId, response)["request"][name].asString()).isEqualTo("v")
        }

        @Test
        @DisplayName("Dado um multipart chunked acima de 1 MiB, quando chama o webhook, então responde o 413 do nginx e não grava")
        fun capture_multipartChunkedAcimaDoLimite_deveResponder413() {
            val tokenId = api.tokenId()
            val body = multipart(listOf("a" to "x".repeat(MAX_BODY_BYTES + MAX_BODY_BYTES / 2)))

            val response =
                rawHttp(
                    port,
                    "POST /$tokenId HTTP/1.1",
                    listOf("Content-Type: multipart/form-data; boundary=XyZ", "Transfer-Encoding: chunked", "Accept: application/json"),
                    chunked(body, size = 65_536),
                )

            assertThat(response.status).isEqualTo(413)
            assertThat(response.body).contains("<title>413 Request Entity Too Large</title>")
            assertThat(api.json(api.send("GET", "/token/$tokenId/requests"))["total"].asInt()).isZero()
        }
    }

    @Nested
    @DisplayName("Multipart sem boundary utilizável")
    inner class MultipartWithoutBoundary {
        @ParameterizedTest(name = "\"{0}\" → content \"{2}\"")
        @DisplayName("Dado um multipart sem boundary ou com boundary vazio, quando chama o webhook, então responde 200 como o PHP")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            multipart/form-data           | --XyZ foo | --XyZ foo
            multipart/form-data; boundary= | --XyZ foo | ''""",
        )
        fun capture_multipartSemBoundary_deveGravar(
            contentType: String,
            body: String,
            content: String,
        ) {
            val tokenId = api.tokenId()

            val response = postMultipart(tokenId, body.toByteArray(), contentType)

            assertThat(response.status).isEqualTo(200)
            val stored = stored(tokenId, response)
            assertThat(stored["content"].asString()).isEqualTo(content)
            assertThat(stored["request"].isNull).isTrue()
            assertThat(stored["headers"]["content-type"][0].asString()).isEqualTo(contentType)
        }
    }

    @Nested
    @DisplayName("Transfer-Encoding: chunked")
    inner class Chunked {
        @ParameterizedTest(name = "corpo \"{0}\" → content-length {1}")
        @DisplayName("Dado um corpo chunked, quando grava, então content-length é o tamanho do corpo, como o nginx repassa")
        @CsvSource("hello world, 11", "'', 0")
        fun capture_corpoChunked_deveGravarTamanhoReal(
            body: String,
            contentLength: String,
        ) {
            val tokenId = api.tokenId()

            val response =
                rawHttp(
                    port,
                    "POST /$tokenId HTTP/1.1",
                    listOf("Content-Type: text/plain", "Transfer-Encoding: chunked"),
                    chunked(body.toByteArray(), size = 5),
                )

            assertThat(response.status).isEqualTo(200)
            val stored = stored(tokenId, response)
            assertThat(stored["content"].asString()).isEqualTo(body)
            assertThat(stored["headers"]["content-length"][0].asString()).isEqualTo(contentLength)
            assertThat(stored["headers"]["transfer-encoding"][0].asString()).isEqualTo("chunked")
        }
    }
}
