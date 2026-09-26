package site.webhook.cli

import kotlinx.serialization.Serializable
import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpRequest.BodyPublishers
import java.net.http.HttpResponse
import java.net.http.HttpResponse.BodyHandlers
import java.util.stream.Stream

private const val OK = 200
private const val CREATED = 201
private const val NOT_FOUND = 404
private const val GONE = 410

@Serializable
private data class NewToken(
    val uuid: TokenId,
)

/** A API do webhook.site que o CLI usa; nada além dela. */
class WebhookServer(
    server: String,
    private val http: HttpClient,
) {
    val base: String = server.trimEnd('/')

    /** `POST /token`: uma URL nova, com a resposta padrão. */
    fun createToken(): TokenId {
        val response = send("POST", "/token")
        if (response.statusCode() != CREATED) throw unexpected(response)
        return apiJson.decodeFromString<NewToken>(response.body()).uuid
    }

    /** `GET /token/{id}`: 410 quando não existe (404 quando o id nem é uuid). */
    fun exists(token: TokenId): Boolean = found(send("GET", "/token/$token")) != null

    /** `GET /token/{id}/request/{rid}`: a mensagem inteira; `null` quando ela ou o token não existem. */
    fun find(
        token: TokenId,
        id: RequestId,
    ): CapturedRequest? = found(send("GET", "/token/$token/request/$id"))?.let { apiJson.decodeFromString<CapturedRequest>(it) }

    /**
     * Assina o SSE do token: as linhas do `text/event-stream`, já com a assinatura registrada no
     * servidor (ele só manda o status depois de registrar). `null` quando o token não existe.
     */
    fun subscribe(token: TokenId): Stream<String>? {
        val request = HttpRequest.newBuilder(URI.create("$base/token/$token/stream")).header("Accept", "text/event-stream").build()
        val response = http.send(request, BodyHandlers.ofLines())
        if (response.statusCode() == OK) return response.body()
        response.body().close()
        if (response.statusCode() in setOf(NOT_FOUND, GONE)) return null
        throw unexpected(response)
    }

    private fun send(
        method: String,
        path: String,
    ): HttpResponse<String> =
        http.send(HttpRequest.newBuilder(URI.create(base + path)).method(method, BodyPublishers.noBody()).build(), BodyHandlers.ofString())

    /** Corpo do 200; `null` no 404/410 (não existe); qualquer outro status é falha do servidor. */
    private fun found(response: HttpResponse<String>): String? =
        when (response.statusCode()) {
            OK -> response.body()
            NOT_FOUND, GONE -> null
            else -> throw unexpected(response)
        }

    private fun unexpected(response: HttpResponse<*>) = IOException("${response.uri()} answered ${response.statusCode()}")
}
