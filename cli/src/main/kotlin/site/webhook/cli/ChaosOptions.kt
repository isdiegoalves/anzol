package site.webhook.cli

import com.github.ajalt.clikt.core.BaseCliktCommand
import com.github.ajalt.clikt.core.MultiUsageError
import com.github.ajalt.clikt.core.UsageError
import com.github.ajalt.clikt.parameters.groups.OptionGroup
import com.github.ajalt.clikt.parameters.options.OptionCallTransformContext
import com.github.ajalt.clikt.parameters.options.convert
import com.github.ajalt.clikt.parameters.options.default
import com.github.ajalt.clikt.parameters.options.option
import com.github.ajalt.clikt.parameters.types.int
import com.github.ajalt.clikt.parameters.types.long
import com.github.ajalt.clikt.parameters.types.restrictTo
import java.time.Duration
import java.util.concurrent.ThreadLocalRandom

/** Uso inválido de uma opção de caos ou de `--retries` no `listen` e no `replay`. */
const val CHAOS_USAGE_ERROR = 2
private const val CHAOS_PREFIX = "--chaos-"
private const val RETRIES = "--retries"
private const val MAX_RETRIES = 10
private const val MAX_REORDER = 100
private const val SEEDS = 1_000_000L

class ChaosOptions :
    OptionGroup(
        name = "Fault injection",
        help =
            "Faults injected in the deliveries to the local app, to test retries, timeouts and idempotency. " +
                "Each injected fault is shown in the line of the delivery, in [chaos: ...].",
    ) {
    private val drop by option("--chaos-drop", metavar = "PERCENT", help = "Chance (0-100) that a request is not delivered at all")
        .convert { percent(it) }
    private val duplicate by option(
        "--chaos-duplicate",
        metavar = "PERCENT",
        help = "Chance (0-100) that a request is delivered twice, with the same headers and body",
    ).convert { percent(it) }
    private val delay by option(
        "--chaos-delay",
        metavar = "MIN..MAX",
        help = "Random wait before each delivery, in ms or with s: 200..800, 1s..3s, 500",
    ).convert { parseDelay(it) ?: fail("expected MIN..MAX in ms or with s, e.g. 200..800 or 1s..3s (got \"$it\")") }
    private val reorder by option(
        "--chaos-reorder",
        metavar = "N",
        help =
            "Holds N deliveries (2-$MAX_REORDER) and sends them in a shuffled order; fewer go out 2 s after the last one " +
                "(listen) or at the end (replay)",
    ).int().restrictTo(2..MAX_REORDER)
    private val abort by option(
        "--chaos-abort",
        metavar = "PERCENT",
        help = "Chance (0-100) that an attempt sends the headers and half of the body and closes the connection (http:// only)",
    ).convert { percent(it) }
    private val slow by option("--chaos-slow", metavar = "BYTES", help = "Sends the body at this many bytes per second")
        .long()
        .restrictTo(min = 1)
    private val timeout by option(
        "--chaos-timeout",
        metavar = "TIME",
        help = "Gives up waiting for the app's response this long after the body is sent, in ms or with s (default 30s)",
    ).convert { text ->
        parseMillis(text)?.takeIf { it > 0 }?.let(Duration::ofMillis)
            ?: fail("expected a time above 0 in ms or with s, e.g. 500 or 2s (got \"$text\")")
    }
    private val retries by option(
        RETRIES,
        metavar = "N",
        help =
            "Retries after a connection error, timeout, cut, 5xx or 429, 0-$MAX_RETRIES (default 0); waits 1 s, 2 s, 4 s... " +
                "up to 30 s, with jitter, or the app's Retry-After; each retry repeats the same headers and body",
    ).int().restrictTo(0..MAX_RETRIES).default(0)
    private val seed by option(
        "--chaos-seed",
        metavar = "N",
        help = "Seed of the draws: the same seed repeats the same faults on the same requests (without it, one is drawn and printed)",
    ).long()

    fun chaos(): Chaos =
        Chaos(
            drop = drop ?: Percent.NEVER,
            duplicate = duplicate ?: Percent.NEVER,
            delay = delay,
            reorder = reorder ?: 0,
            abort = abort ?: Percent.NEVER,
            slow = slow,
            timeout = timeout,
            retries = retries,
            seed = seed ?: ThreadLocalRandom.current().nextLong(SEEDS),
        )
}

private fun OptionCallTransformContext.percent(text: String): Percent =
    parsePercent(text) ?: fail("expected a percentage from 0 to 100, e.g. 20 (got \"$text\")")

/** O erro de uso é de uma opção de caos ou de `--retries`. */
fun UsageError.concernsChaos(): Boolean {
    val names = (this as? MultiUsageError)?.errors?.map { it.paramName } ?: listOf(paramName)
    return names.any { it == RETRIES || it?.startsWith(CHAOS_PREFIX) == true }
}

/** O corte do `--chaos-abort` é feito no socket, sem TLS: só com alvo `http://`. */
fun BaseCliktCommand<*>.requireCuttable(
    target: String,
    chaos: Chaos,
) {
    if (chaos.abort != Percent.NEVER && !target.startsWith("http://", ignoreCase = true)) {
        fail("--chaos-abort works only with an http:// target", CHAOS_USAGE_ERROR)
    }
}
