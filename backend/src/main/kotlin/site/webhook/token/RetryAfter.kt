package site.webhook.token

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonValue
import java.math.BigInteger
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.ResolverStyle
import java.util.Locale

private val DIGITS = Regex("[0-9]+")

/** IMF-fixdate da RFC 9110 §5.6.7: `Sun, 06 Nov 1994 08:49:37 GMT`, sem os formatos obsoletos. */
private val IMF_FIXDATE: DateTimeFormatter =
    DateTimeFormatter
        .ofPattern("EEE, dd MMM uuuu HH:mm:ss 'GMT'", Locale.ENGLISH)
        .withResolverStyle(ResolverStyle.STRICT)

/**
 * `retry_after` do token e valor do cabeçalho `Retry-After` (RFC 9110 §10.2.3): segundos ou data
 * HTTP. No JSON os segundos são número e a data é a string como o cliente mandou.
 */
sealed interface RetryAfter {
    @JsonValue
    fun toJson(): Any =
        when (this) {
            is Seconds -> value
            is HttpDate -> value
        }

    data class Seconds(
        val value: Long,
    ) : RetryAfter

    data class HttpDate(
        val value: String,
    ) : RetryAfter

    companion object {
        /** Lê o JSON gravado no Redis. */
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun fromJson(value: Any): RetryAfter = requireNotNull(parse(value)) { "retry_after inválido no Redis: $value" }

        /**
         * Segundos são inteiro ≥ 0 de 64 bits, como número JSON ou string só de dígitos; data é
         * IMF-fixdate que existe no calendário e cujo dia da semana confere. Fora disso, `null`.
         */
        fun parse(value: Any?): RetryAfter? =
            when (value) {
                is Int, is Long -> (value as Number).toLong().takeIf { it >= 0 }?.let(::Seconds)
                is BigInteger -> value.takeIf { it.signum() >= 0 && it.bitLength() < Long.SIZE_BITS }?.let { Seconds(it.toLong()) }
                is String -> parseText(value)
                else -> null
            }

        private fun parseText(value: String): RetryAfter? =
            when {
                DIGITS.matches(value) -> value.toBigInteger().let(::parse)
                isImfFixdate(value) -> HttpDate(value)
                else -> null
            }

        private fun isImfFixdate(value: String): Boolean =
            try {
                IMF_FIXDATE.parse(value)
                true
            } catch (_: DateTimeParseException) {
                false
            }
    }
}

fun RetryAfter.headerValue(): String = toJson().toString()
