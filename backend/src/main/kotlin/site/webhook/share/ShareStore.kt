package site.webhook.share

import com.fasterxml.jackson.annotation.JsonFormat
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import org.springframework.stereotype.Component
import site.webhook.RedisKeys
import site.webhook.RequestId
import site.webhook.TIMESTAMP_PATTERN
import site.webhook.TokenId
import site.webhook.token.toLegacyDateTime
import tools.jackson.core.JacksonException
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import tools.jackson.databind.json.JsonMapper
import java.math.BigInteger
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.time.LocalDateTime

/** Links só-leitura ativos por URL; acima disto o `POST .../share` responde 422. */
const val MAX_ACTIVE_SHARES = 50

private const val BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
private const val ID_BYTES = 16

/** 62^22 > 2^128: todo id de 128 bits cabe em 22 caracteres (completados com `0` à esquerda). */
private const val ID_LENGTH = 22
private val SHARE_ID = Regex("[0-9A-Za-z]{$ID_LENGTH}")

private val random = SecureRandom()

/**
 * Cria o link se couber: tira do índice os expirados (score = expiração em ms), confere o limite, grava
 * `share:{id}` com TTL e o põe no índice, cujo TTL cresce até o do link mais longo. Tudo num script, para que dois
 * pedidos simultâneos não passem do limite. Devolve 1 (criado) ou 0 (limite).
 */
private val CREATE =
    RedisScript.of(
        """
        redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
        if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[6]) then return 0 end
        redis.call('SET', KEYS[2], ARGV[4], 'PX', ARGV[5])
        redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
        if redis.call('PTTL', KEYS[1]) < tonumber(ARGV[5]) then redis.call('PEXPIRE', KEYS[1], ARGV[5]) end
        return 1
        """.trimIndent(),
        Long::class.java,
    )

/** Revoga só se o link for da URL (está no índice dela): 1 revogado, 0 não achado. */
private val REVOKE =
    RedisScript.of(
        """
        if redis.call('ZREM', KEYS[1], ARGV[1]) == 0 then return 0 end
        redis.call('DEL', KEYS[2])
        return 1
        """.trimIndent(),
        Long::class.java,
    )

/**
 * Revoga todos os links da URL: cada `share:{id}` do índice (ARGV[1] é o prefixo da chave) e o índice, num script só,
 * para que um link criado ao mesmo tempo não escape. Devolve quantos havia no índice.
 */
private val REVOKE_ALL =
    RedisScript.of(
        """
        local ids = redis.call('ZRANGE', KEYS[1], 0, -1)
        for _, id in ipairs(ids) do redis.call('DEL', ARGV[1] .. id) end
        redis.call('DEL', KEYS[1])
        return #ids
        """.trimIndent(),
        Long::class.java,
    )

/** Expirações aceitas no `expires_in`. */
@Suppress("MagicNumber") // os números são os próprios valores da regra, sem nome melhor que eles
enum class ShareExpiry(
    val id: String,
    val duration: Duration,
) {
    HOUR("1h", Duration.ofHours(1)),
    DAY("1d", Duration.ofDays(1)),
    WEEK("7d", Duration.ofDays(7)),
    MONTH("30d", Duration.ofDays(30)),
    ;

    companion object {
        fun of(value: Any?): ShareExpiry? = entries.firstOrNull { it.id == value }
    }
}

/** `share:{id}`: qual mensagem de qual URL, com ou sem máscara, até quando. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class Share(
    val id: String,
    val tokenId: TokenId,
    val requestId: RequestId,
    val redact: Boolean,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val createdAt: LocalDateTime,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val expiresAt: LocalDateTime,
)

/**
 * Links só-leitura no Redis: `share:{id}` (TTL = expiração) e o índice `token:{uuid}:shares` (ZSET id → expiração em
 * ms), que o `DELETE /token/{id}` apaga junto com cada link. O id são 128 bits aleatórios em base62.
 */
@Component
class ShareStore(
    private val redis: StringRedisTemplate,
    private val jsonMapper: JsonMapper,
    private val clock: Clock,
) {
    /** O link novo; nulo quando a URL já tem [MAX_ACTIVE_SHARES] ativos. */
    fun create(
        tokenId: TokenId,
        requestId: RequestId,
        expiry: ShareExpiry,
        redact: Boolean,
    ): Share? {
        val now = clock.instant()
        val expires = now.plus(expiry.duration)
        val share =
            Share(
                id = newShareId(),
                tokenId = tokenId,
                requestId = requestId,
                redact = redact,
                createdAt = now.toLegacyDateTime(),
                expiresAt = expires.toLegacyDateTime(),
            )
        val created =
            redis.execute(
                CREATE,
                listOf(RedisKeys.shares(tokenId), RedisKeys.share(share.id)),
                now.toEpochMilli().toString(),
                expires.toEpochMilli().toString(),
                share.id,
                jsonMapper.writeValueAsString(share),
                expiry.duration.toMillis().toString(),
                MAX_ACTIVE_SHARES.toString(),
            )
        return share.takeIf { created == 1L }
    }

    /** Os links ativos da URL, o mais novo primeiro. */
    fun active(tokenId: TokenId): List<Share> {
        val index = RedisKeys.shares(tokenId)
        redis.opsForZSet().removeRangeByScore(index, 0.0, clock.millis().toDouble())
        val ids =
            redis
                .opsForZSet()
                .range(index, 0, -1)
                .orEmpty()
                .toList()
        if (ids.isEmpty()) return emptyList()
        return redis
            .opsForValue()
            .multiGet(ids.map(RedisKeys::share))
            .orEmpty()
            .mapNotNull { it?.let(::read) }
            .filter { it.tokenId == tokenId }
            .sortedWith(compareByDescending<Share> { it.createdAt }.thenBy { it.id })
    }

    fun revoke(
        tokenId: TokenId,
        id: String,
    ): Boolean = SHARE_ID.matches(id) && redis.execute(REVOKE, listOf(RedisKeys.shares(tokenId), RedisKeys.share(id)), id) == 1L

    /** Revoga todos os links da URL (a troca do segredo de leitura o pede): o público passa a ver o 404 de sempre. */
    fun revokeAll(tokenId: TokenId) {
        redis.execute(REVOKE_ALL, listOf(RedisKeys.shares(tokenId)), RedisKeys.share(""))
    }

    /** O link; nulo quando o id não tem o formato, expirou ou foi revogado. */
    fun find(id: String): Share? {
        if (!SHARE_ID.matches(id)) return null
        return redis.opsForValue().get(RedisKeys.share(id))?.let(::read)
    }

    private fun read(json: String): Share? =
        try {
            jsonMapper.readValue(json, Share::class.java)
        } catch (_: JacksonException) {
            null
        }
}

/** 128 bits de [SecureRandom] em base62, sempre com [ID_LENGTH] caracteres. */
fun newShareId(): String {
    val base = BASE62.length.toBigInteger()
    var value = BigInteger(1, ByteArray(ID_BYTES).also(random::nextBytes))
    val digits = StringBuilder()
    repeat(ID_LENGTH) {
        val (quotient, remainder) = value.divideAndRemainder(base)
        digits.append(BASE62[remainder.toInt()])
        value = quotient
    }
    return digits.reverse().toString()
}
