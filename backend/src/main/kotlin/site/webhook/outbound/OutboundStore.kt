package site.webhook.outbound

import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import org.springframework.stereotype.Component
import site.webhook.RedisKeys
import site.webhook.TokenId
import site.webhook.WebhookProperties
import tools.jackson.databind.json.JsonMapper
import java.time.Duration

/** Resultados guardados por URL: os mais novos. */
const val MAX_HISTORY = 50

/** Disparos (replay + send) por URL a cada [RATE_WINDOW]. */
const val MAX_DISPATCHES_PER_WINDOW = 30
val RATE_WINDOW: Duration = Duration.ofMinutes(1)

/**
 * Janela fixa: conta o disparo e, no primeiro da janela, põe o prazo dela; devolve a contagem e os segundos que
 * faltam para a janela acabar. Num script só, para que duas chamadas simultâneas não percam o prazo.
 */
private val COUNT_DISPATCH =
    RedisScript.of(
        """
        local count = redis.call('INCR', KEYS[1])
        if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
        return {count, redis.call('TTL', KEYS[1])}
        """.trimIndent(),
        List::class.java,
    )

/** Disparo recusado pelo limite: [retryAfterSeconds] até a janela acabar. */
data class RateLimited(
    val retryAfterSeconds: Long,
)

/**
 * `token:{uuid}:outbound` (lista com os [MAX_HISTORY] resultados mais novos, em JSON, o mais novo à esquerda) e
 * `token:{uuid}:outbound:rate` (contagem da janela). As duas saem junto com a URL no `TokenStore.delete`; o
 * histórico tem o TTL da URL, renovado a cada gravação e leitura.
 */
@Component
class OutboundStore(
    private val redis: StringRedisTemplate,
    private val jsonMapper: JsonMapper,
    private val properties: WebhookProperties,
) {
    /** Conta o disparo; nulo quando cabe na janela. */
    fun countDispatch(id: TokenId): RateLimited? {
        val reply = redis.execute(COUNT_DISPATCH, listOf(RedisKeys.outboundRate(id)), RATE_WINDOW.seconds.toString())
        val (count, ttl) = reply.map { it.toString().toLong() }
        return if (count > MAX_DISPATCHES_PER_WINDOW) RateLimited(retryAfterSeconds = ttl.coerceIn(1, RATE_WINDOW.seconds)) else null
    }

    fun record(
        id: TokenId,
        result: OutboundResult,
    ) {
        val key = RedisKeys.outbound(id)
        redis.executePipelined { connection ->
            val raw = key.toByteArray()
            connection.listCommands().lPush(raw, jsonMapper.writeValueAsBytes(result))
            connection.listCommands().lTrim(raw, 0, MAX_HISTORY - 1L)
            connection.keyCommands().expire(raw, properties.expiry.seconds)
            null
        }
    }

    /** O histórico, o mais novo primeiro. */
    fun history(id: TokenId): List<OutboundResult> {
        val key = RedisKeys.outbound(id)
        val items = redis.opsForList().range(key, 0, MAX_HISTORY - 1L).orEmpty()
        if (items.isNotEmpty()) redis.expire(key, properties.expiry)
        return items.map { jsonMapper.readValue(it, OutboundResult::class.java) }
    }
}
