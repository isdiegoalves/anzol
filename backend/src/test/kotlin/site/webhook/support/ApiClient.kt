package site.webhook.support

import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.test.context.TestConstructor
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

/** Teste de API contra o servidor real (Tomcat) numa porta aleatória, com Redis em container. */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(RedisContainerConfiguration::class)
@TestConstructor(autowireMode = TestConstructor.AutowireMode.ALL)
annotation class ApiTest

val JSON_CLIENT = mapOf("Accept" to "application/json")
val JSON_BODY = mapOf("Accept" to "application/json", "Content-Type" to "application/json")

/** Cliente HTTP de verdade: passa pelo parser do Tomcat, como um cliente externo. */
class ApiClient(
    port: Int,
    private val jsonMapper: JsonMapper,
) {
    val base = "http://localhost:$port"
    private val http = HttpClient.newHttpClient()

    fun send(
        method: String,
        path: String,
        body: ByteArray = ByteArray(0),
        headers: Map<String, String> = emptyMap(),
    ): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI.create(base + path))
        // GET, HEAD e DELETE sem corpo saem sem Content-Length, como num navegador ou no curl.
        when {
            body.isNotEmpty() -> request.method(method, HttpRequest.BodyPublishers.ofByteArray(body))
            method == "GET" -> request.GET()
            method == "HEAD" -> request.HEAD()
            method == "DELETE" -> request.DELETE()
            else -> request.method(method, HttpRequest.BodyPublishers.noBody())
        }
        headers.forEach { (name, value) -> request.header(name, value) }
        return http.send(request.build(), HttpResponse.BodyHandlers.ofString())
    }

    fun json(response: HttpResponse<String>): JsonNode = jsonMapper.readTree(response.body())

    fun tree(json: String): JsonNode = jsonMapper.readTree(json)

    /** `POST /token` com corpo JSON; devolve o token criado. */
    fun createToken(fields: String = "{}"): JsonNode = json(send("POST", "/token", fields.toByteArray(), JSON_BODY))

    fun tokenId(fields: String = "{}"): String = createToken(fields)["uuid"].asString()

    /** Dispara o webhook e devolve a mensagem gravada, buscada pelo `X-Request-Id`. */
    fun capture(
        tokenId: String,
        method: String = "GET",
        suffix: String = "",
        body: ByteArray = ByteArray(0),
        headers: Map<String, String> = emptyMap(),
    ): JsonNode {
        val response = send(method, "/$tokenId$suffix", body, headers)
        val requestId = response.headers().firstValue("X-Request-Id").orElseThrow()
        return json(send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT))
    }
}
