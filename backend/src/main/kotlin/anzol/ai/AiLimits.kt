package anzol.ai

import anzol.RedisKeys
import anzol.TokenId
import anzol.countInWindow
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Component
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap

/** Chamadas de IA por URL a cada [AI_RATE_WINDOW]. */
const val MAX_AI_CALLS_PER_WINDOW = 10
val AI_RATE_WINDOW: Duration = Duration.ofMinutes(1)

/** `Retry-After` de quem chega com outra chamada de IA da mesma URL em andamento. */
private const val BUSY_RETRY_SECONDS = 5L

/** Chamada de IA recusada: 429 com [retryAfterSeconds] no `Retry-After` e [message] no corpo. */
data class AiRefusal(
    val retryAfterSeconds: Long,
    val message: String,
)

/**
 * Os dois limites das rotas de IA, por URL: uma chamada por vez (nesta instância: o LLM é local e o app roda sozinho)
 * e [MAX_AI_CALLS_PER_WINDOW] por minuto, contadas em `token:{uuid}:ai:rate`. A chamada recusada por estar ocupada
 * não conta na janela.
 */
@Component
class AiLimits(
    private val redis: StringRedisTemplate,
) {
    private val running = ConcurrentHashMap.newKeySet<TokenId>()

    /** Ocupa a vez da URL; nulo quando pode chamar, e então [release] precisa vir depois. */
    fun acquire(id: TokenId): AiRefusal? {
        if (!running.add(id)) {
            return AiRefusal(BUSY_RETRY_SECONDS, "Another AI call is running for this URL; try again when it finishes.")
        }
        val limited = redis.countInWindow(RedisKeys.aiRate(id), AI_RATE_WINDOW, MAX_AI_CALLS_PER_WINDOW)
        if (limited != null) running.remove(id)
        return limited?.let { AiRefusal(it.retryAfterSeconds, "Too many AI calls for this URL; try again in ${it.retryAfterSeconds} s.") }
    }

    fun release(id: TokenId) {
        running.remove(id)
    }
}
