package site.webhook.cli

private const val REQUEST_CREATED = "request.created"

/**
 * O laço do `listen`: assina o SSE do token e reenvia cada `request.created`, um de cada vez,
 * na ordem de chegada. [onListening] roda quando a assinatura está registrada no servidor.
 */
class Listener(
    private val site: WebhookServer,
    private val token: TokenId,
    private val forwarder: Forwarder,
    private val out: (String) -> Unit,
) {
    /** Volta quando o token deixa de existir. */
    fun run(onListening: () -> Unit) {
        val lines = site.subscribe(token) ?: return
        onListening()
        val parser = SseParser()
        lines.use { stream ->
            stream.forEach { line ->
                val event = parser.feed(line)
                if (event?.name == REQUEST_CREATED) {
                    val created = apiJson.decodeFromString<RequestCreated>(event.data)
                    out(forwarder.forward(token, created.request).line)
                }
            }
        }
    }
}
