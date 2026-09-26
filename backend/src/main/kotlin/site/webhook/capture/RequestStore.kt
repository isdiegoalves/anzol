package site.webhook.capture

import org.springframework.core.io.ClassPathResource
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import org.springframework.stereotype.Component
import site.webhook.RedisKeys
import site.webhook.RequestId
import site.webhook.WebhookProperties
import site.webhook.legacy.phpPagePositions
import site.webhook.token.Token
import tools.jackson.databind.json.JsonMapper
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/** Um script de `resources/redis/`, precedido do prelúdio comum (chaves, backfill, lotes). */
private fun <T : Any> requestScript(
    name: String,
    result: Class<T>,
): RedisScript<T> {
    val common = ClassPathResource("redis/requests-common.lua").getContentAsString(UTF_8)
    return RedisScript.of(common + "\n" + ClassPathResource("redis/$name.lua").getContentAsString(UTF_8), result)
}

private val COUNT = requestScript("requests-count", Long::class.javaObjectType)
private val PAGE = requestScript("requests-page", List::class.java)
private val STORE = requestScript("requests-store", List::class.java)
private val TRIM = requestScript("requests-trim", List::class.java)
private val DELETE = requestScript("requests-delete", Long::class.javaObjectType)
private val FIND = requestScript("requests-find", List::class.java)
private val AFTER = requestScript("requests-after", List::class.java)
private val SCAN = requestScript("requests-scan", List::class.java)

/** Itens antes dos pares (JSON, seq) na resposta de `requests-scan.lua`: entradas lidas e o cursor. */
private const val SCAN_HEADER = 3

/** Resultado da gravação: o `seq` que a mensagem recebeu e as que a limpeza tirou. */
data class Stored(
    val seq: Long,
    val removed: List<RequestId>,
)

/** Trecho da listagem incremental; [hasMore] diz se há mensagens depois da última dele. */
data class RequestBatch(
    val messages: List<CapturedRequest>,
    val hasMore: Boolean,
)

/** Ponto da varredura no índice: o `seq` da última entrada lida e quantas com esse `seq` já foram lidas. */
data class ScanCursor(
    val seq: Long,
    val sameSeq: Long,
)

/** Trecho da varredura; [next] é nulo quando o índice acabou. */
data class ScanBatch(
    val messages: List<CapturedRequest>,
    val next: ScanCursor?,
)

/** Pares (JSON, seq) de um script, sem os valores vazios (mensagem fantasma do app antigo). */
private fun List<*>.toMessages(jsonMapper: JsonMapper): List<CapturedRequest> =
    chunked(2)
        .filter { (json, _) -> json is String && json.isNotEmpty() }
        .map { (json, seq) -> jsonMapper.readValue(json.toString(), CapturedRequest::class.java).copy(seq = seq.toString().toLong()) }

private fun List<*>.toRequestIds(): List<RequestId> = filterIsInstance<String>().map { RequestId(UUID.fromString(it)) }

/**
 * Mensagens de um token em duas chaves que os scripts Lua mantêm coerentes: a hash
 * `token:{uuid}:requests` (uuid → JSON, no formato que o app antigo lê e grava) e o índice
 * `token:{uuid}:requests:index` (ZSET uuid → chegada em microssegundos), que dá a ordem, o total
 * e a página sem ler a hash inteira. O score é o `seq` de cada mensagem lida. Hash antiga sem índice ganha o índice na primeira leitura
 * ou gravação (backfill em `requests-common.lua`).
 *
 * Limpeza FIFO: a URL guarda no máximo `auto_cleanup` mensagens, ou `WEBHOOK_MAX_REQUESTS` sem
 * limpeza configurada; o corte roda no mesmo script da gravação (e no PUT que reduz o limite).
 */
@Component
class RequestStore(
    private val redis: StringRedisTemplate,
    private val jsonMapper: JsonMapper,
    private val properties: WebhookProperties,
) {
    private fun keys(token: Token) = listOf(RedisKeys.requests(token.uuid), RedisKeys.requestIndex(token.uuid))

    private fun retention(token: Token): Long = token.autoCleanup?.limit ?: properties.maxRequests

    fun find(
        token: Token,
        id: RequestId,
    ): CapturedRequest? {
        val message = redis.execute(FIND, keys(token), id.toString()).toMessages(jsonMapper).firstOrNull() ?: return null
        keys(token).forEach { redis.expire(it, properties.expiry) }
        return message
    }

    /**
     * Página com a aritmética do `Collection::forPage` do app antigo sobre o total do índice.
     * Valores vazios na hash (mensagem fantasma do app antigo) contam no total e não aparecem.
     */
    fun page(
        token: Token,
        page: Long,
        perPage: Long,
        sorting: Sorting,
    ): List<CapturedRequest> {
        val positions = phpPagePositions(count(token), page, perPage)
        if (positions.isEmpty()) return emptyList()
        val order = if (sorting == Sorting.NEWEST) "newest" else "oldest"
        return redis.execute(PAGE, keys(token), positions.first.toString(), positions.last.toString(), order).toMessages(jsonMapper)
    }

    /** Até [limit] mensagens com `seq` maior que [after], da mais antiga para a mais nova, só pelo índice. */
    fun after(
        token: Token,
        after: Long,
        limit: Long,
    ): RequestBatch {
        val reply = redis.execute(AFTER, keys(token), after.toString(), limit.toString())
        return RequestBatch(messages = reply.drop(1).toMessages(jsonMapper), hasMore = reply.first().toString().toLong() > 0)
    }

    /**
     * Até [limit] entradas do índice depois de [from] (nulo: do começo), na ordem [sorting]. A mensagem
     * fantasma não vem em [ScanBatch.messages], mas avança o cursor: a varredura segue até o fim do índice.
     */
    fun scan(
        token: Token,
        sorting: Sorting,
        from: ScanCursor?,
        limit: Long,
    ): ScanBatch {
        val order = if (sorting == Sorting.NEWEST) "newest" else "oldest"
        val reply =
            redis.execute(SCAN, keys(token), order, from?.seq?.toString().orEmpty(), (from?.sameSeq ?: 0).toString(), limit.toString())
        val (read, seq, sameSeq) = reply.take(SCAN_HEADER).map { it.toString() }
        // Trecho incompleto: o índice acabou (e, vazio, nem há cursor a ler).
        val next = if (read.toLong() < limit) null else ScanCursor(seq = seq.toLong(), sameSeq = sameSeq.toLong())
        return ScanBatch(messages = reply.drop(SCAN_HEADER).toMessages(jsonMapper), next = next)
    }

    fun count(token: Token): Long = redis.execute(COUNT, keys(token))

    /** Grava e corta o excedente, atômico; devolve o `seq` dado à mensagem e as que saíram (nunca a gravada). */
    fun store(
        token: Token,
        request: CapturedRequest,
        arrival: Instant,
    ): Stored {
        val reply =
            redis.execute(
                STORE,
                keys(token) + RedisKeys.requestSeq(token.uuid),
                request.uuid.toString(),
                jsonMapper.writeValueAsString(request),
                ChronoUnit.MICROS.between(Instant.EPOCH, arrival).toString(),
                properties.expiry.seconds.toString(),
                retention(token).toString(),
            )
        return Stored(seq = reply.first().toString().toLong(), removed = reply.drop(1).toRequestIds())
    }

    /** Corta o excedente sobre o limite atual do token (depois de reduzi-lo). */
    fun trim(token: Token): List<RequestId> = redis.execute(TRIM, keys(token), retention(token).toString()).toRequestIds()

    fun delete(
        token: Token,
        request: CapturedRequest,
    ): Boolean = redis.execute(DELETE, keys(token), request.uuid.toString()) > 0

    fun deleteAll(token: Token): Boolean = redis.delete(keys(token)) > 0
}
