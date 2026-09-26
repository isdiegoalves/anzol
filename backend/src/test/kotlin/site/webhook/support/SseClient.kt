package site.webhook.support

import java.io.InputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.ConcurrentLinkedQueue

/** Um evento SSE já montado (nome e `data:`). */
data class SseEvent(
    val name: String,
    val data: String,
)

/**
 * Cliente de `text/event-stream` para teste: abre a conexão, lê os eventos numa thread virtual
 * e os guarda em [events]. [close] derruba a conexão, como uma aba fechada.
 */
class SseClient(
    url: String,
) : AutoCloseable {
    val response: HttpResponse<InputStream> =
        HttpClient
            .newHttpClient()
            .send(
                HttpRequest.newBuilder(URI.create(url)).header("Accept", "text/event-stream").build(),
                HttpResponse.BodyHandlers.ofInputStream(),
            )
    val events = ConcurrentLinkedQueue<SseEvent>()
    private val reader = Thread.ofVirtual().start { readEvents() }

    private fun readEvents() {
        var name = ""
        val data = StringBuilder()
        runCatching {
            response.body().bufferedReader().lineSequence().forEach { line ->
                when {
                    line.isEmpty() && data.isNotEmpty() -> events.add(SseEvent(name, data.toString())).also { data.clear() }
                    line.startsWith("event:") -> name = line.removePrefix("event:").trim()
                    line.startsWith("data:") -> data.append(line.removePrefix("data:"))
                }
            }
        }
    }

    override fun close() {
        response.body().close()
        reader.interrupt()
    }
}
