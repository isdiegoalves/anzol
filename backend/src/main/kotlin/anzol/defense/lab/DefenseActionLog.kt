package anzol.defense.lab

import anzol.RedisKeys
import anzol.TokenId
import org.springframework.core.io.ClassPathResource
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import org.springframework.stereotype.Component
import java.nio.charset.StandardCharsets.UTF_8

private val COUNT =
    RedisScript.of(ClassPathResource("redis/defense-action.lua").getContentAsString(UTF_8), Long::class.javaObjectType)

/** Uma escrita na URL que o relatório da rodada conta; [field] é o campo no hash e no relatório. */
enum class DefenseAction(
    val field: String,
) {
    RULE_WRITE("rule_writes"),
    CONFIG_CHANGE("config_changes"),
    OUTBOUND("outbound"),
}

/** Escritas guardadas por rodada; acima disso saem as mais velhas. */
private const val MAX_WRITES = 500

/**
 * As escritas feitas numa URL enquanto ela tem rodada de defesa aberta: quantas de cada tipo e o que foi escrito (o
 * relatório procura ali a ficha de injeção, mesmo que a escrita tenha sido desfeita depois). Quem grava regras, muda a
 * configuração da URL ou dispara a Saída avisa aqui, para qualquer URL: só a que tem rodada aberta guarda.
 */
@Component
class DefenseActionLog(
    private val redis: StringRedisTemplate,
) {
    fun record(
        id: TokenId,
        action: DefenseAction,
        content: String,
    ) {
        redis.execute(
            COUNT,
            listOf(RedisKeys.defenseActions(id), RedisKeys.defenseWrites(id)),
            action.field,
            content,
            MAX_WRITES.toString(),
        )
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

    /** Tudo o que foi escrito na URL desde a abertura da rodada, num texto só. */
    fun writes(id: TokenId): String =
        redis
            .opsForList()
            .range(RedisKeys.defenseWrites(id), 0, -1)
            .orEmpty()
            .joinToString("\n")
}
