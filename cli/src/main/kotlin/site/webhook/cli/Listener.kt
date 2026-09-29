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

/** Mensagens por página na busca `after`: cada uma vem inteira, até ~1 MB. */
private const val PAGE_SIZE = 20

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
 * O laço do `listen`: assina o SSE do token e reenvia as mensagens na ordem do índice do servidor
 * (`seq`), um de cada vez. O SSE é só o aviso de que há mensagem nova: gravações simultâneas publicam
 * fora da ordem do índice, então cada aviso (e cada (re)conexão, depois de assinar) busca na listagem
 * `after=<cursor>` tudo o que veio depois da última mensagem tratada, em ordem, até a última página.
 *
 * @param cursor `seq` da mensagem mais nova quando o `listen` começou (nada até ela é reenviado).
 */
class Listener(
    private val site: WebhookServer,
    private val token: TokenId,
    private val deliveries: Deliveries,
    private var cursor: Long,
    private val idleLimit: Duration = IDLE_LIMIT,
    private val out: (String) -> Unit,
) {
    private val backoff = Backoff()

    /** [onListening] roda quando a primeira assinatura está registrada; volta quando o token deixa de existir. */
    fun run(onListening: () -> Unit) {
        var announced = false
        while (true) {
            try {
                val lines = site.subscribe(token) ?: return
                lines.use { stream ->
                    backoff.reset()
                    val missed = newer()
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

    /** Evento de mensagem que o [cursor] já passou (reenviada por um aviso anterior) não busca nada. */
    private fun handle(event: SseEvent) {
        if (event.name != REQUEST_CREATED) return
        if (apiJson.decodeFromString<RequestCreated>(event.data).request.seq > cursor) newer().forEach(::process)
    }

    /** Reenvia e avança o cursor, também quando o app local não respondeu (a linha diz `error:`). */
    private fun process(message: CapturedRequest) {
        deliveries.accept(message)
        cursor = message.seq
    }

    /**
     * Mensagens com `seq` maior que o [cursor], na ordem do índice, página a página até a última.
     * A listagem traz a mensagem inteira, inclusive a que o evento trouxe truncada.
     */
    private fun newer(): List<CapturedRequest> {
        val newer = mutableListOf<CapturedRequest>()
        do {
            val listing = site.after(token, newer.lastOrNull()?.seq ?: cursor, PAGE_SIZE) ?: break
            newer += listing.data
        } while (!listing.isLastPage && listing.data.isNotEmpty())
        return newer
    }
}
