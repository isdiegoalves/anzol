package site.webhook.cli

import java.io.IOException
import java.io.UncheckedIOException
import java.time.Duration
import java.util.stream.Stream

private const val REQUEST_CREATED = "request.created"
private val FIRST_RETRY: Duration = Duration.ofSeconds(1)
private val LAST_RETRY: Duration = Duration.ofSeconds(30)

/** Três heartbeats do servidor (15 s) sem nenhuma linha: a conexão está morta sem ter fechado. */
private val IDLE_LIMIT: Duration = Duration.ofSeconds(45)
private const val IDLE_CHECKS = 5L

/** Espera entre tentativas de reconexão: 1 s, 2 s, 4 s… até 30 s; volta a 1 s ao conectar. */
class Backoff {
    private var next = FIRST_RETRY

    fun next(): Duration = next.also { next = minOf(next.multipliedBy(2), LAST_RETRY) }

    fun reset() {
        next = FIRST_RETRY
    }
}

/**
 * Chama [onIdle] quando passa [limit] sem [touch]. Pega a conexão meia-aberta (rede que caiu sem
 * FIN nem RST), em que a leitura bloquearia para sempre: fechar o stream a desbloqueia.
 */
private class IdleWatchdog(
    limit: Duration,
    onIdle: () -> Unit,
) : AutoCloseable {
    @Volatile private var lastTouch = System.nanoTime()
    private val thread =
        Thread.ofVirtual().start {
            try {
                while (System.nanoTime() - lastTouch < limit.toNanos()) Thread.sleep(limit.dividedBy(IDLE_CHECKS))
                onIdle()
            } catch (_: InterruptedException) {
                // A conexão terminou antes do limite.
            }
        }

    fun touch() {
        lastTouch = System.nanoTime()
    }

    override fun close() = thread.interrupt()
}

/**
 * O laço do `listen`: assina o SSE do token e reenvia cada `request.created`, um de cada vez,
 * na ordem de chegada. Em cada (re)conexão, depois de assinar, percorre a listagem `newest` até
 * a última mensagem tratada ([cursor]) e reenvia as que faltaram; o conjunto [forwarded] evita
 * repetir uma mensagem que chega pelas duas vias (listagem e SSE).
 *
 * @param cursor a mensagem mais nova do token quando o `listen` começou (nada antes dela é reenviado).
 */
class Listener(
    private val site: WebhookServer,
    private val token: TokenId,
    private val forwarder: Forwarder,
    private var cursor: CapturedRequest?,
    private val idleLimit: Duration = IDLE_LIMIT,
    private val out: (String) -> Unit,
) {
    private val forwarded = HashSet<RequestId>()
    private val backoff = Backoff()

    /** [onListening] roda quando a primeira assinatura está registrada; volta quando o token deixa de existir. */
    fun run(onListening: () -> Unit) {
        var announced = false
        while (true) {
            try {
                val lines = site.subscribe(token) ?: return
                lines.use { stream ->
                    backoff.reset()
                    val missed = missed()
                    if (announced) out("Reconnected; forwarding ${missed.size} missed request(s)") else onListening()
                    announced = true
                    missed.forEach(::process)
                    follow(stream)
                }
            } catch (_: IOException) {
                // Queda da conexão (ou servidor fora do ar): tenta de novo depois da espera.
            } catch (_: UncheckedIOException) {
                // A mesma queda, lançada de dentro do Stream de linhas.
            }
            Thread.sleep(backoff.next())
        }
    }

    /** Lê o SSE até a conexão cair; sem linha nenhuma por [idleLimit], fecha o stream e o laço reconecta. */
    private fun follow(stream: Stream<String>) {
        val parser = SseParser()
        IdleWatchdog(idleLimit, stream::close).use { watchdog ->
            stream.forEach { line ->
                watchdog.touch()
                parser.feed(line)?.let(::handle)
            }
        }
    }

    private fun handle(event: SseEvent) {
        if (event.name != REQUEST_CREATED) return
        val created = apiJson.decodeFromString<RequestCreated>(event.data)
        if (created.request.uuid in forwarded) return
        val message = if (created.truncated) site.find(token, created.request.uuid) else created.request
        if (message != null) process(message)
    }

    private fun process(message: CapturedRequest) {
        if (!forwarded.add(message.uuid)) return
        out(forwarder.forward(token, message).line)
        cursor = message
    }

    /**
     * Mensagens gravadas depois do [cursor], em ordem de chegada. Se o cursor saiu da listagem
     * (limpeza automática, DELETE), para na primeira mensagem com `created_at` anterior ao dele.
     */
    private fun missed(): List<CapturedRequest> {
        val newer = mutableListOf<CapturedRequest>()
        var page = 0
        do {
            page++
            val listing = site.newest(token, page) ?: break
            val stop = listing.data.indexOfFirst { it.isAtOrBefore(cursor) }
            newer += if (stop < 0) listing.data else listing.data.take(stop)
        } while (stop < 0 && !listing.isLastPage && listing.data.isNotEmpty())
        return newer.asReversed().distinctBy { it.uuid }.filterNot { it.uuid in forwarded }
    }

    private fun CapturedRequest.isAtOrBefore(cursor: CapturedRequest?): Boolean =
        cursor != null && (uuid == cursor.uuid || createdAt < cursor.createdAt)
}
