package site.webhook.cli

import java.time.Duration
import java.time.Instant
import java.util.Collections
import java.util.SplittableRandom

private const val HUNDRED = 100.0
private const val MILLIS_DIGITS = 3
private const val TICKS_PER_SECOND = 10
private const val NANOS_PER_SECOND = 1_000_000_000L
private const val MAX_CHUNK = 65_536L
private val AMOUNT = Regex("""(\d+(?:\.\d+)?)(ms|s)?""")
private val RETRY_FIRST: Duration = Duration.ofSeconds(1)
private val RETRY_LAST: Duration = Duration.ofSeconds(30)

@JvmInline
value class Percent(
    val value: Double,
) {
    fun drawn(dice: SplittableRandom): Boolean = dice.nextDouble() * HUNDRED < value

    override fun toString(): String = "${value.toBigDecimal().stripTrailingZeros().toPlainString()}%"

    companion object {
        val NEVER = Percent(0.0)
    }
}

/** As opções `--chaos-*` e `--retries` de `listen` e `replay`; [reorder] 0 é "não segura". */
data class Chaos(
    val drop: Percent = Percent.NEVER,
    val duplicate: Percent = Percent.NEVER,
    val delay: LongRange? = null,
    val reorder: Int = 0,
    val abort: Percent = Percent.NEVER,
    val slow: Long? = null,
    val timeout: Duration? = null,
    val retries: Int = 0,
    val seed: Long = 0,
) {
    val attempts: Int get() = retries + 1

    /** `Chaos: drop 20%, …; seed 7`, ou `null` sem nenhuma opção. */
    fun summary(): String? {
        val parts =
            listOfNotNull(
                "drop $drop".takeIf { drop != Percent.NEVER },
                "duplicate $duplicate".takeIf { duplicate != Percent.NEVER },
                delay?.let { "delay ${it.first}..${it.last} ms" },
                "reorder $reorder".takeIf { reorder > 0 },
                "abort $abort".takeIf { abort != Percent.NEVER },
                slow?.let { "slow $it B/s" },
                timeout?.let { "timeout ${it.toMillis()} ms" },
                "retries $retries".takeIf { retries > 0 },
            )
        return if (parts.isEmpty()) null else "Chaos: ${parts.joinToString(", ")}; seed $seed"
    }
}

/** O que o caos decide para uma mensagem assim que ela chega. */
data class Fate(
    val dropped: Boolean,
    val duplicated: Boolean,
)

fun Chaos.fate(dice: SplittableRandom): Fate = Fate(dropped = drop.drawn(dice), duplicated = duplicate.drawn(dice))

/**
 * Um fluxo de sorteios por mensagem, na ordem de chegada: com a mesma semente, a n-ésima mensagem sorteia o mesmo
 * seja qual for o número de tentativas das anteriores.
 */
class ChaosDice(
    seed: Long,
) {
    private val root = SplittableRandom(seed)
    val order: SplittableRandom = root.split()

    fun nextMessage(): SplittableRandom = root.split()
}

/** Porcentagem de 0 a 100, com ou sem `%`. */
fun parsePercent(text: String): Percent? =
    text
        .removeSuffix("%")
        .toDoubleOrNull()
        ?.takeIf { it in 0.0..HUNDRED }
        ?.let(::Percent)

/** `500` e `500ms` são ms; `2s` e `1.5s`, segundos. Só número inteiro de ms. */
fun parseMillis(text: String): Long? {
    val (number, unit) = AMOUNT.matchEntire(text)?.destructured ?: return null
    val amount = number.toBigDecimal().let { if (unit == "s") it.movePointRight(MILLIS_DIGITS) else it }
    return try {
        amount.longValueExact()
    } catch (_: ArithmeticException) {
        null
    }
}

/** `MIN..MAX`, ou um valor só (atraso fixo). */
fun parseDelay(text: String): LongRange? {
    val bounds = text.split("..")
    val millis = bounds.mapNotNull(::parseMillis)
    return if (bounds.size <= 2 && millis.size == bounds.size && millis.first() <= millis.last()) millis.first()..millis.last() else null
}

/**
 * Espera antes da tentativa [attempt] + 1: o `Retry-After` do app, ou o backoff exponencial a partir de 1 s com jitter
 * (entre a metade e o teto da vez); os dois até 30 s.
 */
fun retryWait(
    attempt: Int,
    retryAfter: RetryAfter?,
    now: Instant,
    dice: SplittableRandom,
): Wait {
    if (retryAfter != null) return Wait(minOf(retryAfter.delay(now), RETRY_LAST), fromRetryAfter = true)
    val ceiling = minOf(RETRY_FIRST.multipliedBy(1L shl (attempt - 1)), RETRY_LAST).toMillis()
    val floor = ceiling / 2
    return Wait(Duration.ofMillis(floor + dice.nextLong(ceiling - floor + 1)), fromRetryAfter = false)
}

/** A ordem de entrega de uma leva segura, por índice de chegada: com duas ou mais, nunca a própria ordem de chegada. */
fun shuffledOrder(
    size: Int,
    dice: SplittableRandom,
): List<Int> {
    val arrival = List(size) { it }
    return generateSequence { arrival.shuffledBy(dice) }.first { size < 2 || it != arrival }
}

private fun List<Int>.shuffledBy(dice: SplittableRandom): List<Int> {
    val order = toMutableList()
    for (i in order.lastIndex downTo 1) Collections.swap(order, i, dice.nextInt(i + 1))
    return order
}

/** Corpo a [bytesPerSecond]: um pedaço a cada décimo de segundo, de 1 byte a 64 KiB. */
data class Drip(
    val bytesPerSecond: Long,
) {
    val chunk: Int get() = (bytesPerSecond / TICKS_PER_SECOND).coerceIn(1, MAX_CHUNK).toInt()

    fun pause(bytes: Int): Duration = Duration.ofNanos(bytes * NANOS_PER_SECOND / bytesPerSecond)
}
