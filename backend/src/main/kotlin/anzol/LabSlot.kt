package anzol

import org.springframework.core.io.ClassPathResource
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.time.Instant

/** Quanto uma URL de laboratório segura a vaga, contado da criação e de cada rodada. */
val LAB_SLOT_HOLD: Duration = Duration.ofMinutes(30)

private const val MILLIS_PER_SECOND = 1_000L

private val HOLD_SLOT =
    RedisScript.of(ClassPathResource("redis/e2ee-lab-slot.lua").getContentAsString(UTF_8), Long::class.javaObjectType)

/**
 * Segura a vaga de [id] no índice [index] por [LAB_SLOT_HOLD], sem passar do que resta de vida à URL ([remaining]);
 * nulo quando segurou. Com as [max] vagas tomadas por outras URLs, devolve quanto falta para a primeira vencer.
 */
fun StringRedisTemplate.holdLabSlot(
    index: String,
    id: TokenId,
    now: Instant,
    remaining: Duration,
    max: Int,
): RateLimited? {
    val until = now.plus(minOf(LAB_SLOT_HOLD, remaining))
    val wait: Long =
        execute(HOLD_SLOT, listOf(index), now.toEpochMilli().toString(), until.toEpochMilli().toString(), id.toString(), max.toString())
    return if (wait == 0L) null else RateLimited(retryAfterSeconds = ((wait + MILLIS_PER_SECOND - 1) / MILLIS_PER_SECOND).coerceAtLeast(1))
}
