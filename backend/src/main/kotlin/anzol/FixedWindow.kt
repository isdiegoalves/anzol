package anzol

import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import java.time.Duration

/**
 * Janela fixa: conta o uso e, no primeiro da janela, põe o prazo dela; devolve a contagem e os segundos que
 * faltam para a janela acabar. Num script só, para que duas chamadas simultâneas não percam o prazo.
 */
private val COUNT_IN_WINDOW =
    RedisScript.of(
        """
        local count = redis.call('INCR', KEYS[1])
        if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
        return {count, redis.call('TTL', KEYS[1])}
        """.trimIndent(),
        List::class.java,
    )

/** Uso recusado pelo limite da janela: [retryAfterSeconds] até ela acabar. */
data class RateLimited(
    val retryAfterSeconds: Long,
)

/** Conta um uso na janela [window] da chave [key]; nulo quando cabe em [max]. */
fun StringRedisTemplate.countInWindow(
    key: String,
    window: Duration,
    max: Int,
): RateLimited? {
    val reply = execute(COUNT_IN_WINDOW, listOf(key), window.seconds.toString())
    val (count, ttl) = reply.map { it.toString().toLong() }
    return if (count > max) RateLimited(retryAfterSeconds = ttl.coerceIn(1, window.seconds)) else null
}
