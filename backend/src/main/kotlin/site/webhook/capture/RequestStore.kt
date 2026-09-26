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

/**
 * Mensagens de um token em duas chaves que os scripts Lua mantêm coerentes: a hash
 * `token:{uuid}:requests` (uuid → JSON, no formato que o app antigo lê e grava) e o índice
 * `token:{uuid}:requests:index` (ZSET uuid → chegada em microssegundos), que dá a ordem, o total
 * e a página sem ler a hash inteira. Hash antiga sem índice ganha o índice na primeira leitura
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

    private fun List<*>.toRequestIds(): List<RequestId> = filterIsInstance<String>().map { RequestId(UUID.fromString(it)) }

    fun find(
        token: Token,
        id: RequestId,
    ): CapturedRequest? {
        val json = redis.opsForHash<String, String>().get(RedisKeys.requests(token.uuid), id.toString())
        if (json.isNullOrEmpty()) return null
        keys(token).forEach { redis.expire(it, properties.expiry) }
        return jsonMapper.readValue(json, CapturedRequest::class.java)
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
        return redis
            .execute(PAGE, keys(token), positions.first.toString(), positions.last.toString(), order)
            .filterIsInstance<String>()
            .filter { it.isNotEmpty() }
            .map { jsonMapper.readValue(it, CapturedRequest::class.java) }
    }

    fun count(token: Token): Long = redis.execute(COUNT, keys(token))

    /** Grava e corta o excedente, atômico; devolve as mensagens que saíram (nunca a gravada). */
    fun store(
        token: Token,
        request: CapturedRequest,
        arrival: Instant,
    ): List<RequestId> =
        redis
            .execute(
                STORE,
                keys(token),
                request.uuid.toString(),
                jsonMapper.writeValueAsString(request),
                ChronoUnit.MICROS.between(Instant.EPOCH, arrival).toString(),
                properties.expiry.seconds.toString(),
                retention(token).toString(),
            ).toRequestIds()

    /** Corta o excedente sobre o limite atual do token (depois de reduzi-lo). */
    fun trim(token: Token): List<RequestId> = redis.execute(TRIM, keys(token), retention(token).toString()).toRequestIds()

    fun delete(
        token: Token,
        request: CapturedRequest,
    ): Boolean = redis.execute(DELETE, keys(token), request.uuid.toString()) > 0

    fun deleteAll(token: Token): Boolean = redis.delete(keys(token)) > 0
}
