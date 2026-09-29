package anzol.cli

private const val DEFAULT_EVENT = "message"

data class SseEvent(
    val name: String,
    val data: String,
)

/**
 * Leitor de `text/event-stream`, uma linha por vez: `event:` e `data:` (um espaço opcional após
 * os dois-pontos), comentários `:` (o heartbeat do servidor) ignorados, linha vazia entrega o evento.
 */
class SseParser {
    private var name: String? = null
    private val data = mutableListOf<String>()

    fun feed(line: String): SseEvent? {
        if (line.isEmpty()) return dispatch()
        val field = line.substringBefore(':')
        val value = line.substringAfter(':', missingDelimiterValue = "").removePrefix(" ")
        when (field) {
            "event" -> name = value
            "data" -> data += value
        }
        return null
    }

    private fun dispatch(): SseEvent? {
        val event = if (data.isEmpty()) null else SseEvent(name ?: DEFAULT_EVENT, data.joinToString("\n"))
        name = null
        data.clear()
        return event
    }
}
