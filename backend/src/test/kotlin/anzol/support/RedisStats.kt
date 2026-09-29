package anzol.support

import org.springframework.data.redis.core.StringRedisTemplate

/** Comandos que leem a hash inteira de mensagens: nenhum deles pode aparecer numa listagem. */
val WHOLE_HASH_COMMANDS = listOf("hgetall", "hvals", "hkeys", "hscan")

/** Zera o `INFO commandstats` do Redis do teste. */
fun StringRedisTemplate.resetCommandStats() {
    execute { it.serverCommands().resetConfigStats() }
}

/** Quantas vezes cada comando rodou desde o último [resetCommandStats], inclusive dentro de scripts Lua. */
fun StringRedisTemplate.commandCalls(): Map<String, Long> {
    val stats = execute { it.serverCommands().info("commandstats") } ?: return emptyMap()
    return stats.stringPropertyNames().associate { key ->
        key.removePrefix("cmdstat_") to
            stats
                .getProperty(key)
                .substringAfter("calls=")
                .substringBefore(',')
                .toLong()
    }
}
