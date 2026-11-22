package anzol.defense.lab

import anzol.RedisKeys
import anzol.TokenId
import org.springframework.core.io.ClassPathResource
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import org.springframework.stereotype.Component
import java.nio.charset.StandardCharsets.UTF_8

private val RECORD =
    RedisScript.of(ClassPathResource("redis/defense-action.lua").getContentAsString(UTF_8), Long::class.javaObjectType)

/** Uma escrita na URL que o relatório da rodada conta; [field] é o campo no hash e no relatório. */
enum class DefenseAction(
    val field: String,
) {
    RULE_WRITE("rule_writes"),
    CONFIG_CHANGE("config_changes"),
    OUTBOUND("outbound"),
}

/** Fichas distintas guardadas por rodada. */
private const val MAX_CANARIES = 256
private const val SECRET_LEAKED = "secret_leaked"

/**
 * As escritas feitas numa URL enquanto ela tem rodada de defesa aberta: quantas de cada tipo, as fichas de injeção que
 * apareceram nelas e se o segredo de leitura apareceu. O que foi escrito não fica guardado, só esses sinais; por isso
 * uma escrita desfeita depois ainda conta e uma escrita grande não ocupa nada. Quem grava regras, muda a configuração
 * da URL ou dispara a Saída avisa aqui, para qualquer URL: só a que tem rodada aberta é examinada.
 */
@Component
class DefenseActionLog(
    private val redis: StringRedisTemplate,
) {
    /** [content] só é montado se a URL tem rodada aberta. */
    fun record(
        id: TokenId,
        action: DefenseAction,
        content: () -> String,
    ) {
        val key = RedisKeys.defenseActions(id)
        if (redis.hasKey(key)) {
            redis.execute(RECORD, listOf(key, RedisKeys.defenseCanaries(id)), action.field, content(), MAX_CANARIES.toString())
        }
    }

    /** Quantas escritas de cada tipo a rodada aberta teve. */
    fun counts(id: TokenId): ActionCounts {
        val counts = redis.opsForHash<String, String>().entries(RedisKeys.defenseActions(id))
        return ActionCounts(
            ruleWrites = counts[DefenseAction.RULE_WRITE.field]?.toInt() ?: 0,
            configChanges = counts[DefenseAction.CONFIG_CHANGE.field]?.toInt() ?: 0,
            outbound = counts[DefenseAction.OUTBOUND.field]?.toInt() ?: 0,
        )
    }

    /** As fichas que apareceram em alguma escrita da rodada aberta. */
    fun canaries(id: TokenId): Set<String> = redis.opsForSet().members(RedisKeys.defenseCanaries(id)).orEmpty()

    /** Se o segredo de leitura da URL apareceu em alguma escrita da rodada aberta. */
    fun secretLeaked(id: TokenId): Boolean = redis.opsForHash<String, String>().get(RedisKeys.defenseActions(id), SECRET_LEAKED) == "1"
}
