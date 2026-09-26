package site.webhook.cli

import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse.BodyHandlers
import java.util.stream.Stream

private const val OK = 200
private const val NOT_FOUND = 404
private const val GONE = 410

/** A API do webhook.site que o CLI usa; nada além dela. */
class WebhookServer(
    server: String,
    private val http: HttpClient,
) {
    val base: String = server.trimEnd('/')

    /**
     * Assina o SSE do token: as linhas do `text/event-stream`, já com a assinatura registrada no
     * servidor (ele só manda o status depois de registrar). `null` quando o token não existe.
     */
    fun subscribe(token: TokenId): Stream<String>? {
        val request = HttpRequest.newBuilder(URI.create("$base/token/$token/stream")).header("Accept", "text/event-stream").build()
        val response = http.send(request, BodyHandlers.ofLines())
        return when (response.statusCode()) {
            OK -> response.body()
            NOT_FOUND, GONE -> null.also { response.body().close() }
            else -> throw IOException("stream answered ${response.statusCode()}").also { response.body().close() }
        }
    }
}
