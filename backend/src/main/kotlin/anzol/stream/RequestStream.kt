package anzol.stream

import anzol.RequestId
import anzol.TokenId
import anzol.capture.CapturedRequest
import io.micrometer.core.instrument.Gauge
import io.micrometer.core.instrument.MeterRegistry
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.event.ContextClosedEvent
import org.springframework.context.event.EventListener
import org.springframework.http.MediaType
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import tools.jackson.databind.json.JsonMapper
import java.io.IOException
import java.math.BigDecimal
import java.time.Clock
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

private const val EVENT_NAME = "request.created"
private const val STORAGE = "storage"
private const val PING = "ping"
private const val HEARTBEAT_THREAD = "sse-heartbeat"

/** A volta do armazenamento só é dita depois deste número de intervalos do heartbeat sem recusa. */
private const val QUIET_HEARTBEATS = 2L

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
 * abertas e quem espera por ela. Os dois registros viram gauges (`anzol.sse.subscribers`, `anzol.wait.active`).
 */
@Suppress("TooManyFunctions") // dono do estado: assinar, escutar, avisar, encerrar e contar usam os mesmos mapas
@Component
class RequestStream(
    private val jsonMapper: JsonMapper,
    registry: MeterRegistry,
    private val clock: Clock,
    @Value("\${anzol.stream.heartbeat}") heartbeat: Duration,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** O intervalo do heartbeat em segundos ("15", "0.2"), no `data` do `ping`: o cliente vigia o silêncio por ele. */
    private val interval = BigDecimal.valueOf(heartbeat.toMillis(), 3).stripTrailingZeros().toPlainString()
    private val subscribers = ConcurrentHashMap<TokenId, Set<SseEmitter>>()
    private val listeners = ConcurrentHashMap<TokenId, Set<Arrivals>>()

    /** O armazenamento é do servidor, não da URL: um estado só, dito às abas de todas as URLs. */
    private val storage = StorageWatch(quiet = heartbeat.multipliedBy(QUIET_HEARTBEATS))

    /** Assinantes com o envio do heartbeat anterior ainda em andamento (o cliente não lê): o seguinte os pula. */
    private val beating = ConcurrentHashMap.newKeySet<SseEmitter>()

    /** O aviso `storage` que o assinante ainda não recebeu: foi pulado no heartbeat em que ele saiu. */
    private val owed = ConcurrentHashMap<SseEmitter, StorageState>()

    init {
        Gauge
            .builder("anzol.sse.subscribers", this) { it.subscriberCount().toDouble() }
            .description("Conexões SSE abertas (abas acompanhando uma URL)")
            .register(registry)
        Gauge
            .builder("anzol.wait.active", listeners) { all -> all.values.sumOf { it.size }.toDouble() }
            .description("Esperas do requests/wait em andamento")
            .register(registry)
    }

    /**
     * Registra o assinante e já manda um comentário com o primeiro `ping`: isso despacha o status e os cabeçalhos,
     * então o cliente só vê a conexão aberta depois do registro e nenhuma mensagem se perde. Com o armazenamento
     * cheio (e as outras abas já avisadas), o evento `storage` sai antes desse `ping`: a tela lê um `ping` sem `storage`
     * antes dele como "há espaço".
     */
    fun subscribe(tokenId: TokenId): SseEmitter {
        val emitter = SseEmitter(NO_TIMEOUT)
        subscribers.merge(tokenId, setOf(emitter)) { current, added -> current + added }
        emitter.onCompletion { unsubscribe(tokenId, emitter) }
        emitter.onTimeout { unsubscribe(tokenId, emitter) }
        emitter.onError { unsubscribe(tokenId, emitter) }
        log.info("SSE: assinante entrou no token {} ({} no token, {} no total)", tokenId, subscriberCount(tokenId), subscriberCount())
        storage.announcedFull()?.let { emitter.trySend(tokenId, storageEvent(it)) }
        emitter.trySend(tokenId, ping("conectado"))
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

    /**
     * O acesso à URL mudou (segredo de leitura definido, trocado ou removido): fecha as conexões SSE e encerra as
     * esperas. Quem reconectar passa de novo pelo controle de acesso.
     */
    fun disconnect(tokenId: TokenId) {
        end(tokenId)
        subscribers.remove(tokenId).orEmpty().forEach { it.complete() }
    }

    fun listenerCount(tokenId: TokenId): Int = listeners[tokenId].orEmpty().size

    /** Uma gravação foi recusada por falta de espaço (o 507). Só anota: quem avisa as abas é o [heartbeat]. */
    fun storageRefused() = storage.refused(clock.instant())

    /** Avisa as escutas e os assinantes do token; `total` só é contado se houver assinante do SSE. */
    fun publish(
        request: CapturedRequest,
        removed: List<RequestId>,
        total: () -> Long,
    ) {
        storage.stored(request.createdAt)
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

    /**
     * Comentário e `ping` periódicos: mantêm proxies abertos e revelam conexões mortas. O comentário segue para quem
     * já lia o heartbeat assim; o `EventSource` só entrega ao JavaScript o evento com `data`.
     *
     * É também aqui, e não no pedido que encheu ou voltou a gravar, que as abas de todas as URLs ouvem o evento
     * `storage`: no máximo um por intervalo, antes do `ping`.
     *
     * Cada assinante recebe o envio numa thread virtual própria: o cliente que não lê prende só a dele, até o envio
     * falhar e ele sair do registro, e enquanto isso é pulado, para não acumular uma thread por intervalo.
     */
    @Scheduled(fixedRateString = "\${anzol.stream.heartbeat}")
    fun heartbeat() {
        val announcement = storage.due(clock.instant())
        subscribers.forEach { (tokenId, emitters) ->
            emitters.forEach { emitter ->
                if (announcement != null) owed[emitter] = announcement
                if (beating.add(emitter)) Thread.ofVirtual().name(HEARTBEAT_THREAD).start { beat(tokenId, emitter) }
            }
        }
    }

    private fun beat(
        tokenId: TokenId,
        emitter: SseEmitter,
    ) {
        try {
            owed.remove(emitter)?.let { emitter.trySend(tokenId, storageEvent(it)) }
            emitter.trySend(tokenId, ping("heartbeat"))
        } finally {
            beating.remove(emitter)
        }
    }

    private fun storageEvent(state: StorageState): SseEmitter.SseEventBuilder =
        SseEmitter.event().name(STORAGE).data(state, MediaType.APPLICATION_JSON)

    private fun ping(comment: String): SseEmitter.SseEventBuilder =
        SseEmitter
            .event()
            .comment(comment)
            .name(PING)
            .data(interval)

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
        owed.remove(emitter)
        if (removed) {
            log.info("SSE: assinante saiu do token {} ({} no token, {} no total)", tokenId, subscriberCount(tokenId), subscriberCount())
        }
    }
}
