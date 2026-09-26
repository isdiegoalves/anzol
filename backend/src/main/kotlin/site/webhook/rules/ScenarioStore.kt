package site.webhook.rules

import org.springframework.core.io.ClassPathResource
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import org.springframework.stereotype.Component
import site.webhook.RedisKeys
import site.webhook.TokenId
import site.webhook.WebhookProperties
import java.nio.charset.StandardCharsets.UTF_8

private val TRANSITION =
    RedisScript.of(ClassPathResource("redis/scenarios-transition.lua").getContentAsString(UTF_8), Long::class.javaObjectType)

/**
 * Cada tentativa perdida é uma transição que outra requisição fez; num cenário de N passos isso passa
 * de N só com transições em ciclo sob carga contínua. Esgotar é erro (500), nunca resposta sem transição.
 */
private const val MAX_ATTEMPTS = 100

/**
 * `token:{uuid}:scenarios`: hash nome do cenário → estado (ausente = [STARTED]), com o TTL da URL e
 * apagado junto com ela no `TokenStore.delete`.
 */
@Component
class ScenarioStore(
    private val redis: StringRedisTemplate,
    private val properties: WebhookProperties,
) {
    fun states(id: TokenId): Map<String, String> = redis.opsForHash<String, String>().entries(RedisKeys.scenarios(id))

    /**
     * Escolha da regra e transição do cenário, atômicas por URL mesmo entre instâncias: lê os estados
     * dos cenários de que a escolha depende, decide, e grava a transição num compare-and-set
     * (`scenarios-transition.lua`) que só vale se nenhum desses estados mudou desde a leitura; se mudou,
     * relê e decide de novo. Sem regra ativa com cenário, não toca no Redis.
     */
    fun decide(
        id: TokenId,
        rules: List<Rule>,
        input: MatchInput,
    ): Decision {
        val names = rules.activeScenarios()
        if (names.isEmpty()) return rules.decide(input)
        repeat(MAX_ATTEMPTS) {
            val read = redis.opsForHash<String, String>().multiGet(RedisKeys.scenarios(id), names)
            val states = names.zip(read).associate { (name, state) -> name to (state ?: STARTED) }
            val decision = rules.decide(input, states)
            if (compareAndSet(id, states, decision.transition())) return decision
        }
        error("scenarios of ${RedisKeys.scenarios(id)} changed on $MAX_ATTEMPTS attempts in a row")
    }

    fun set(
        id: TokenId,
        name: String,
        state: String,
    ) {
        redis.opsForHash<String, String>().put(RedisKeys.scenarios(id), name, state)
        redis.expire(RedisKeys.scenarios(id), properties.expiry)
    }

    /** Todos voltam a [STARTED]. */
    fun reset(id: TokenId) {
        redis.delete(RedisKeys.scenarios(id))
    }

    private fun compareAndSet(
        id: TokenId,
        expected: Map<String, String>,
        transition: RuleScenario?,
    ): Boolean {
        val reply =
            redis.execute(
                TRANSITION,
                listOf(RedisKeys.scenarios(id)),
                properties.expiry.seconds.toString(),
                STARTED,
                transition?.name.orEmpty(),
                transition?.newState.orEmpty(),
                bodyMapper.writeValueAsString(expected),
            )
        return reply == 1L
    }
}

/** O cenário que a regra escolhida muda, se ela tem `newState`. */
private fun Decision.transition(): RuleScenario? =
    when (this) {
        is Decision.Matched -> rule.scenario?.takeIf { it.newState != null }
        is Decision.Unmatched -> null
    }
