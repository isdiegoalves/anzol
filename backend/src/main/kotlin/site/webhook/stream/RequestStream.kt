package site.webhook.stream

import org.slf4j.LoggerFactory
import org.springframework.context.event.ContextClosedEvent
import org.springframework.context.event.EventListener
import org.springframework.http.MediaType
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import site.webhook.TokenId
import site.webhook.capture.CapturedRequest
import tools.jackson.databind.json.JsonMapper
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

private const val EVENT_NAME = "request.created"

/** Sem prazo: a conexão vive enquanto o cliente estiver lá; o heartbeat descobre quem saiu. */
private const val NO_TIMEOUT = 0L

/**
 * Assinantes do SSE por token, em memória (uma instância, uso local). Substitui a fila Redis,
 * o `queue:work` e o laravel-echo-server: quem grava a mensagem avisa as abas abertas.
 */
@Component
class RequestStream(
    private val jsonMapper: JsonMapper,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val subscribers = ConcurrentHashMap<TokenId, Set<SseEmitter>>()

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

    /** Avisa os assinantes do token; `total` só é contado se houver alguém ouvindo. */
    fun publish(
        request: CapturedRequest,
        total: () -> Long,
    ) {
        val emitters = subscribers[request.tokenId].orEmpty()
        if (emitters.isEmpty()) return
        val event = SseEmitter.event().name(EVENT_NAME).data(request.toRequestCreated(total(), jsonMapper), MediaType.APPLICATION_JSON)
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
     * conexões SSE (que não terminam sozinhas) até o prazo acabar. O `EventSource` reconecta.
     */
    @EventListener(ContextClosedEvent::class)
    fun completeAll() {
        subscribers.values.flatten().forEach { it.complete() }
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
