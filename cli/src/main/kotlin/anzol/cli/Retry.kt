package anzol.cli

import java.time.Duration
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

private const val TOO_MANY_REQUESTS = 429
private val SERVER_ERROR = 500..599
private val SUCCESS = 200..299

/** Segundos do `Retry-After` curtos o bastante para caber num `Duration` em ms. */
private val DELAY_SECONDS = Regex("[0-9]{1,15}")

/** Como a espera cresce entre as tentativas; [id] é o valor de `--backoff`. */
enum class RetryBackoff(
    val id: String,
) {
    FIXED("fixed"),
    EXPONENTIAL("exponential"),
}

/** O `Retry-After` de uma resposta: segundos ou data HTTP (RFC 9110 §10.2.3). */
sealed interface RetryAfter {
    data class Seconds(
        val seconds: Long,
    ) : RetryAfter

    data class HttpDate(
        val at: Instant,
    ) : RetryAfter

    /** Quanto falta a partir de [now]; data no passado é zero. */
    fun delay(now: Instant): Duration =
        when (this) {
            is Seconds -> Duration.ofSeconds(seconds)
            is HttpDate -> maxOf(Duration.between(now, at), Duration.ZERO)
        }
}

/** `null` quando ausente ou malformado: vale o backoff. */
fun parseRetryAfter(value: String?): RetryAfter? {
    val text = value?.trim().orEmpty()
    return if (DELAY_SECONDS.matches(text)) RetryAfter.Seconds(text.toLong()) else httpDate(text)
}

private fun httpDate(text: String): RetryAfter.HttpDate? =
    try {
        RetryAfter.HttpDate(ZonedDateTime.parse(text, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant())
    } catch (_: DateTimeParseException) {
        null
    }

/** A espera antes da próxima tentativa; [fromRetryAfter] quando veio do header e não do backoff. */
data class Wait(
    val delay: Duration,
    val fromRetryAfter: Boolean,
)

/** `--retries`, `--backoff`, `--initial-delay` e `--max-delay`. */
data class RetryPolicy(
    val retries: Int,
    val backoff: RetryBackoff,
    val initialDelay: Duration,
    val maxDelay: Duration,
) {
    val attempts: Int get() = retries + 1

    /** A espera depois da tentativa [attempt] (1..) que falhou: o [retryAfter] ou o backoff, nunca acima do teto. */
    fun wait(
        attempt: Int,
        retryAfter: RetryAfter?,
        now: Instant,
    ): Wait {
        val wanted =
            retryAfter?.delay(now) ?: when (backoff) {
                RetryBackoff.FIXED -> initialDelay
                RetryBackoff.EXPONENTIAL -> initialDelay.multipliedBy(1L shl (attempt - 1))
            }
        return Wait(minOf(wanted, maxDelay), fromRetryAfter = retryAfter != null)
    }
}

/** O que uma tentativa obteve do receptor. */
sealed interface Answer {
    data class Status(
        val code: Int,
        val retryAfter: RetryAfter?,
    ) : Answer

    /** Sem resposta: conexão recusada, timeout, erro de rede; [reason] em inglês, curto. */
    data class Failure(
        val reason: String,
    ) : Answer

    /** Erro de conexão, timeout, 5xx e 429; nunca 2xx, 3xx e os outros 4xx. */
    fun retryable(): Boolean =
        when (this) {
            is Status -> code in SERVER_ERROR || code == TOO_MANY_REQUESTS
            is Failure -> true
        }

    fun delivered(): Boolean = this is Status && code in SUCCESS
}
