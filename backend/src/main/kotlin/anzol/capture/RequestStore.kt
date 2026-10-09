package anzol.capture

import anzol.AnzolProperties
import anzol.RedisKeys
import anzol.RequestId
import anzol.legacy.phpPagePositions
import anzol.token.Token
import org.springframework.core.io.ClassPathResource
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import org.springframework.stereotype.Component
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
private val REPLACE = requestScript("requests-replace", Long::class.javaObjectType)
private val FIND = requestScript("requests-find", List::class.java)
private val AFTER = requestScript("requests-after", List::class.java)
private val SCAN = requestScript("requests-scan", List::class.java)

/** Itens antes dos pares (JSON, seq) na resposta de `requests-scan.lua`: entradas lidas e o cursor. */
private const val SCAN_HEADER = 3

/** Quantas entradas do índice cada leitura de [anyDecrypted] traz. */
private const val DECRYPTED_SCAN_BATCH = 100L

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

/** O JSON da mensagem sem `decrypted`, que os scripts gravam numa URL sem segredo; vazio se ela não tem o atributo. */
private fun JsonMapper.withoutDecrypted(request: CapturedRequest): String =
    if (request.decrypted == null) "" else writeValueAsString(request.copy(decrypted = null))

/** As duas chaves das mensagens do token: a hash e o índice. */
private fun Token.requestKeys() = listOf(RedisKeys.requests(uuid), RedisKeys.requestIndex(uuid))

/**
 * Mensagens de um token em duas chaves que os scripts Lua mantêm coerentes: a hash
 * `token:{uuid}:requests` (uuid → JSON, no formato que o app antigo lê e grava) e o índice
 * `token:{uuid}:requests:index` (ZSET uuid → chegada em microssegundos), que dá a ordem, o total
 * e a página sem ler a hash inteira. O score é o `seq` de cada mensagem lida. Hash antiga sem índice ganha o índice na primeira leitura
 * ou gravação (backfill em `requests-common.lua`).
 *
 * Limpeza FIFO: a URL guarda no máximo `auto_cleanup` mensagens, ou `ANZOL_MAX_REQUESTS` sem
 * limpeza configurada; o corte roda no mesmo script da gravação (e no PUT que reduz o limite).
 */
@Component
class RequestStore(
    private val redis: StringRedisTemplate,
    private val jsonMapper: JsonMapper,
    private val properties: AnzolProperties,
) {
    private fun retention(token: Token): Long = token.autoCleanup?.limit ?: properties.maxRequests

    fun find(
        token: Token,
        id: RequestId,
    ): CapturedRequest? {
        val message = redis.execute(FIND, token.requestKeys(), id.toString()).toMessages(jsonMapper).firstOrNull() ?: return null
        token.requestKeys().forEach { redis.expire(it, properties.expiry) }
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
        return redis.execute(PAGE, token.requestKeys(), positions.first.toString(), positions.last.toString(), order).toMessages(jsonMapper)
    }

    /** Até [limit] mensagens com `seq` maior que [after], da mais antiga para a mais nova, só pelo índice. */
    fun after(
        token: Token,
        after: Long,
        limit: Long,
    ): RequestBatch {
        val reply = redis.execute(AFTER, token.requestKeys(), after.toString(), limit.toString())
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
            redis.execute(
                SCAN,
                token.requestKeys(),
                order,
                from?.seq?.toString().orEmpty(),
                (from?.sameSeq ?: 0).toString(),
                limit.toString(),
            )
        val (read, seq, sameSeq) = reply.take(SCAN_HEADER).map { it.toString() }
        // Trecho incompleto: o índice acabou (e, vazio, nem há cursor a ler).
        val next = if (read.toLong() < limit) null else ScanCursor(seq = seq.toLong(), sameSeq = sameSeq.toLong())
        return ScanBatch(messages = reply.drop(SCAN_HEADER).toMessages(jsonMapper), next = next)
    }

    fun count(token: Token): Long = redis.execute(COUNT, token.requestKeys())

    /**
     * Grava e corta o excedente, atômico; devolve o `seq` dado à mensagem e as que saíram (nunca a gravada). O
     * `decrypted` só é gravado se o token, lido no Redis no mesmo passo, ainda tem segredo de leitura.
     */
    fun store(
        token: Token,
        request: CapturedRequest,
        arrival: Instant,
    ): Stored {
        val reply =
            redis.execute(
                STORE,
                token.requestKeys() + RedisKeys.requestSeq(token.uuid) + RedisKeys.token(token.uuid),
                request.uuid.toString(),
                jsonMapper.writeValueAsString(request),
                ChronoUnit.MICROS.between(Instant.EPOCH, arrival).toString(),
                properties.expiry.seconds.toString(),
                retention(token).toString(),
                jsonMapper.withoutDecrypted(request),
            )
        return Stored(seq = reply.first().toString().toLong(), removed = reply.drop(1).toRequestIds())
    }

    /**
     * Regrava a mensagem já gravada [request] (sem o `seq`, que não vai à hash), se ela ainda está lá; o índice não
     * muda. Devolve se regravou.
     */
    fun replace(
        token: Token,
        request: CapturedRequest,
    ): Boolean {
        val stored = request.copy(seq = null)
        val json = jsonMapper.writeValueAsString(stored)
        val keys = token.requestKeys() + RedisKeys.token(token.uuid)
        return redis.execute(REPLACE, keys, request.uuid.toString(), json, jsonMapper.withoutDecrypted(stored)) > 0
    }

    /** Corta o excedente sobre o limite atual do token (depois de reduzi-lo). */
    fun trim(token: Token): List<RequestId> = redis.execute(TRIM, token.requestKeys(), retention(token).toString()).toRequestIds()

    fun delete(
        token: Token,
        request: CapturedRequest,
    ): Boolean = redis.execute(DELETE, token.requestKeys(), request.uuid.toString()) > 0

    fun deleteAll(token: Token): Boolean = redis.delete(token.requestKeys()) > 0
}

/** Se alguma mensagem retida guarda o atributo decifrado (`decrypted`); varre o índice em trechos e para na primeira. */
fun RequestStore.anyDecrypted(token: Token): Boolean =
    generateSequence(scan(token, Sorting.NEWEST, from = null, limit = DECRYPTED_SCAN_BATCH)) { previous ->
        previous.next?.let { scan(token, Sorting.NEWEST, from = it, limit = DECRYPTED_SCAN_BATCH) }
    }.any { batch -> batch.messages.any { it.decrypted != null } }

/** O maior `seq` (score) do índice agora; 0 com o índice vazio. */
fun RequestStore.highestSeq(token: Token): Long = scan(token, Sorting.NEWEST, from = null, limit = 1).next?.seq ?: 0
