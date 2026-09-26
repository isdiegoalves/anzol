package site.webhook.stream

import org.slf4j.LoggerFactory
import org.springframework.context.event.ContextClosedEvent
import org.springframework.context.event.EventListener
import org.springframework.http.MediaType
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import site.webhook.RequestId
import site.webhook.TokenId
import site.webhook.capture.CapturedRequest
import tools.jackson.databind.json.JsonMapper
import java.io.IOException
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

private const val EVENT_NAME = "request.created"

/** Sem prazo: a conexão vive enquanto o cliente estiver lá; o heartbeat descobre quem saiu. */
private const val NO_TIMEOUT = 0L

/** O que chega a quem escuta um token sem SSE. */
sealed interface Arrival {
    data class Created(
        val request: CapturedRequest,
    ) : Arrival

    /** A URL foi apagada ou o app está parando: nada mais vai chegar. */
    data object Ended : Arrival
}

/** Escuta das mensagens novas de um token (o `requests/wait`); fechar tira a escuta do registro. */
class Arrivals(
    private val onClose: (Arrivals) -> Unit,
) : AutoCloseable {
    private val queue = LinkedBlockingQueue<Arrival>()

    fun offer(arrival: Arrival) {
        queue.offer(arrival)
    }

    /** A próxima chegada, bloqueando a thread (virtual) até [timeout]; `null` quando o prazo acaba antes. */
    fun next(timeout: Duration): Arrival? = queue.poll(timeout.toNanos(), TimeUnit.NANOSECONDS)

    override fun close() = onClose(this)
}

/**
 * Assinantes do SSE e escutas do `requests/wait` por token, em memória (uma instância, uso local).
 * Substitui a fila Redis, o `queue:work` e o laravel-echo-server: quem grava a mensagem avisa as abas
 * abertas e quem espera por ela.
 */
@Component
class RequestStream(
    private val jsonMapper: JsonMapper,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val subscribers = ConcurrentHashMap<TokenId, Set<SseEmitter>>()
    private val listeners = ConcurrentHashMap<TokenId, Set<Arrivals>>()

    /**
     * Registra o assinante e já manda um comentário: isso despacha o status e os cabeçalhos,
     * então o cliente só vê a conexão aberta depois do registro e nenhuma mensagem se perde.
     */
    fun subscribe(tokenId: TokenId): SseEmitter {
        val emitter = SseEmitter(NO_TIMEOUT)
        subscribers.merge(tokenId, setOf(emitter)) { current, added -> current + added }
        emitter.onCompletion { unsubscribe(tokenId, emitter) }
        emitter.onTimeout { unsubscribe(tokenId, emitter) }
        emitter.onError { unsubscribe(tokenId, emitter) }
        log.info("SSE: assinante entrou no token {} ({} no token, {} no total)", tokenId, subscriberCount(tokenId), subscriberCount())
        emitter.trySend(tokenId, SseEmitter.event().comment("conectado"))
        return emitter
    }

    /**
     * Escuta as mensagens que o token gravar daqui em diante. Registrada antes de o chamador ler o
     * histórico, nenhuma mensagem gravada entre as duas coisas se perde (pode vir nas duas: o `seq` deduplica).
     */
    fun listen(tokenId: TokenId): Arrivals {
        val arrivals =
            Arrivals { closed ->
                listeners.computeIfPresent(tokenId) { _, current -> (current - closed).ifEmpty { null } }
            }
        listeners.merge(tokenId, setOf(arrivals)) { current, added -> current + added }
        return arrivals
    }

    /** A URL foi apagada: encerra quem a escuta. */
    fun end(tokenId: TokenId) {
        listeners[tokenId].orEmpty().forEach { it.offer(Arrival.Ended) }
    }

    fun listenerCount(tokenId: TokenId): Int = listeners[tokenId].orEmpty().size

    /** Avisa as escutas e os assinantes do token; `total` só é contado se houver assinante do SSE. */
    fun publish(
        request: CapturedRequest,
        removed: List<RequestId>,
        total: () -> Long,
    ) {
        listeners[request.tokenId].orEmpty().forEach { it.offer(Arrival.Created(request)) }
        val emitters = subscribers[request.tokenId].orEmpty()
        if (emitters.isEmpty()) return
        val event =
            SseEmitter
                .event()
                .name(
                    EVENT_NAME,
                ).data(request.toRequestCreated(total(), removed, jsonMapper), MediaType.APPLICATION_JSON)
        emitters.forEach { it.trySend(request.tokenId, event) }
    }

    /** Comentário periódico: mantém proxies abertos e revela conexões mortas. */
    @Scheduled(fixedRateString = "\${webhook.stream.heartbeat}")
    fun heartbeat() {
        subscribers.forEach { (tokenId, emitters) ->
            emitters.forEach { it.trySend(tokenId, SseEmitter.event().comment("heartbeat")) }
        }
    }

    /**
     * Fecha os streams quando o app começa a parar: sem isso o desligamento gracioso espera as
     * conexões SSE (que não terminam sozinhas) até o prazo acabar. O `EventSource` reconecta. As
     * esperas do `requests/wait` respondem com o que tiverem.
     */
    @EventListener(ContextClosedEvent::class)
    fun completeAll() {
        subscribers.values.flatten().forEach { it.complete() }
        listeners.values.flatten().forEach { it.offer(Arrival.Ended) }
    }

    fun subscriberCount(tokenId: TokenId): Int = subscribers[tokenId].orEmpty().size

    fun subscriberCount(): Int = subscribers.values.sumOf { it.size }

    private fun SseEmitter.trySend(
        tokenId: TokenId,
        event: SseEmitter.SseEventBuilder,
    ) {
        try {
            send(event)
        } catch (_: IOException) {
            unsubscribe(tokenId, this)
        } catch (_: IllegalStateException) {
            unsubscribe(tokenId, this)
        }
    }

    private fun unsubscribe(
        tokenId: TokenId,
        emitter: SseEmitter,
    ) {
        var removed = false
        subscribers.computeIfPresent(tokenId) { _, current ->
            removed = emitter in current
            (current - emitter).ifEmpty { null }
        }
        if (removed) {
            log.info("SSE: assinante saiu do token {} ({} no token, {} no total)", tokenId, subscriberCount(tokenId), subscriberCount())
        }
    }
}
