package anzol.cli

import java.time.Duration
import java.time.Instant
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.SplittableRandom
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

private val CLOCK_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss")

/** Uma entrega pendente: a mensagem, os sorteios dela e as marcas de caos que as linhas dela levam. */
private data class Delivery(
    val message: CapturedRequest,
    val dice: SplittableRandom,
    val marks: List<String>,
)

/**
 * Entrega as mensagens ao app local, uma de cada vez, com o caos e as retentativas de [chaos], e escreve em [out]
 * uma linha por tentativa: `HH:mm:ss MÉTODO caminho[ attempt n/total] -> resultado[, retrying in …][ [chaos: …]]`.
 * Com `--chaos-reorder`, a leva incompleta sai [releaseAfter] depois da última que chegou, ou no [flush].
 */
class Deliveries(
    private val forwarder: Forwarder,
    private val token: TokenId,
    private val chaos: Chaos,
    private val releaseAfter: Duration? = null,
    private val out: (String) -> Unit,
) {
    private val dice = ChaosDice(chaos.seed)
    private val lock = ReentrantLock()
    private val held = mutableListOf<Delivery>()
    private var holds = 0L
    private val scheduler: ScheduledExecutorService by lazy { Executors.newSingleThreadScheduledExecutor(Thread.ofVirtual().factory()) }

    /** Entregas que terminaram sem resposta do app (erro, prazo ou corte), depois das retentativas. */
    var unanswered = 0
        private set

    fun accept(message: CapturedRequest) {
        lock.withLock {
            val messageDice = dice.nextMessage()
            val fate = chaos.fate(messageDice)
            val original = Delivery(message, messageDice.split(), emptyList())
            val copy = Delivery(message, messageDice.split(), listOf("duplicate"))
            when {
                fate.dropped -> out("${now(message)} -> dropped [chaos: drop]")
                fate.duplicated -> listOf(original, copy).forEach(::dispatch)
                else -> dispatch(original)
            }
        }
    }

    private fun dispatch(delivery: Delivery) = if (chaos.reorder > 0) hold(delivery) else deliver(delivery)

    /** Solta, embaralhadas, as entregas seguras que ainda não completaram uma leva. */
    fun flush() = lock.withLock { release() }

    private fun hold(delivery: Delivery) {
        held += delivery
        out("${now(delivery.message)} -> held ${held.size} of ${chaos.reorder} [chaos: reorder]")
        if (held.size == chaos.reorder) release() else scheduleRelease()
    }

    private fun scheduleRelease() {
        val wait = releaseAfter ?: return
        val mark = ++holds
        scheduler.schedule({ lock.withLock { if (holds == mark) release() } }, wait.toMillis(), TimeUnit.MILLISECONDS)
    }

    private fun release() {
        val batch = held.toList()
        held.clear()
        shuffledOrder(batch.size, dice.order).forEach { index ->
            val delivery = batch[index]
            deliver(delivery.copy(marks = delivery.marks + "reordered (arrived ${index + 1} of ${batch.size})"))
        }
    }

    private fun deliver(delivery: Delivery) {
        val delay = chaos.delay?.let { Duration.ofMillis(delivery.dice.nextLong(it.first, it.last + 1)) }
        delay?.let { Thread.sleep(it) }
        for (number in 1..chaos.attempts) {
            val attempt = forwarder.attempt(token, delivery.message, cut = chaos.abort.drawn(delivery.dice))
            val outcome = attempt.outcome
            val wait =
                if (outcome.retryable() && number < chaos.attempts) {
                    retryWait(number, (outcome as? Outcome.Answered)?.answer?.retryAfter, Instant.now(), delivery.dice)
                } else {
                    null
                }
            val marks =
                delivery.marks + listOfNotNull(delay?.takeIf { number == 1 }?.let { "delay ${it.toMillis()} ms" }) + attempt.injected
            out(line(delivery.message, attempt, number, wait, marks))
            if (wait == null) {
                if (outcome !is Outcome.Answered) unanswered++
                return
            }
            Thread.sleep(wait.delay)
        }
    }

    private fun line(
        message: CapturedRequest,
        attempt: Attempt,
        number: Int,
        wait: Wait?,
        marks: List<String>,
    ): String {
        val counter = if (chaos.retries > 0) " attempt $number/${chaos.attempts}" else ""
        val retry = wait?.let { ", retrying in ${it.delay.toMillis()} ms" + if (it.fromRetryAfter) " (Retry-After)" else "" }.orEmpty()
        val tags = if (marks.isEmpty()) "" else " [chaos: ${marks.joinToString(", ")}]"
        val files = if (attempt.multipart) FILES_NOT_FORWARDED else ""
        val started = attempt.started.format(CLOCK_FORMAT)
        return "$started ${message.method} ${attempt.route}$counter -> ${attempt.outcome.text()}$retry$tags$files"
    }

    private fun now(message: CapturedRequest): String = "${LocalTime.now().format(CLOCK_FORMAT)} ${message.method} ${message.route(token)}"
}
