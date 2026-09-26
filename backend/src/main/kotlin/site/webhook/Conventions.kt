package site.webhook

import java.util.UUID

/*
 * Formatos herdados do app antigo (Laravel), num lugar só (docs/padroes-kotlin.md §3).
 * Mudar qualquer um deles deixa ilegíveis os tokens e mensagens já gravados no Redis.
 */

/** Regex de `app/Http/routes.php:5-6`: só minúsculas, como o `Uuid::uuid4()->toString()` grava. */
const val UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

/** `Carbon::now()->toDateTimeString()`, sempre em UTC (`config/app.php`). */
const val TIMESTAMP_PATTERN = "yyyy-MM-dd HH:mm:ss"

/** `preg_match('/[1-5][0-9][0-9]/', ...)` sem âncora, como em `RequestController::create`. */
val STATUS_IN_PATH = Regex("[1-5][0-9][0-9]")

@JvmInline
value class TokenId(
    val value: UUID,
) {
    override fun toString(): String = value.toString()
}

@JvmInline
value class RequestId(
    val value: UUID,
) {
    override fun toString(): String = value.toString()
}

/** Chaves de `Storage/Token.php` e `Storage/Request.php`. */
object RedisKeys {
    fun token(id: TokenId): String = "token:$id"

    fun requests(id: TokenId): String = "token:$id:requests"

    /** ZSET uuid da mensagem → chegada em microssegundos: a ordem e a paginação de [requests]. */
    fun requestIndex(id: TokenId): String = "token:$id:requests:index"
}
