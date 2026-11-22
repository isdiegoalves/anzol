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

/**
 * As escritas feitas numa URL enquanto ela tem rodada de defesa aberta. Quem grava regras, muda a configuração da URL
 * ou dispara a Saída avisa aqui, para qualquer URL: só a que tem rodada aberta conta.
 */
@Component
class DefenseActionLog(
    private val redis: StringRedisTemplate,
) {
    fun record(
        id: TokenId,
        action: DefenseAction,
    ) {
        redis.execute(COUNT, listOf(RedisKeys.defenseActions(id)), action.field)
    }
}
