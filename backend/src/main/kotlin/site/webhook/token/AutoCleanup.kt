package site.webhook.token

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonValue

/**
 * `auto_cleanup` do token: quantas mensagens a URL guarda; ao passar, as mais antigas saem. No JSON
 * é o número. Sem limpeza (`null`), vale o teto global `WEBHOOK_MAX_REQUESTS`.
 */
@Suppress("MagicNumber") // os números são os próprios valores da regra, sem nome melhor que eles
enum class AutoCleanup(
    val limit: Long,
) {
    KEEP_500(500),
    KEEP_1000(1000),
    KEEP_5000(5000),
    KEEP_10000(10000),
    ;

    @JsonValue
    fun toJson(): Long = limit

    companion object {
        /** Lê o JSON gravado no Redis. */
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun fromJson(value: Long): AutoCleanup =
            requireNotNull(entries.firstOrNull { it.limit == value }) { "auto_cleanup inválido no Redis: $value" }

        /** Regra `in:500,1000,5000,10000` do Laravel: número JSON inteiro ou a string exata. Fora disso, `null`. */
        fun parse(value: Any?): AutoCleanup? =
            entries.firstOrNull {
                when (value) {
                    is Int, is Long -> (value as Number).toLong() == it.limit
                    is String -> value == it.limit.toString()
                    else -> false
                }
            }
    }
}
