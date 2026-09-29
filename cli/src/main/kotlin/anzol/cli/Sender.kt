package anzol.cli

import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpRequest.BodyPublishers
import java.net.http.HttpResponse.BodyHandlers
import java.time.Clock
import java.time.Duration
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.UUID

private val CLOCK_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss")
private const val NANOS_PER_MILLI = 1_000_000

/** O que cada envio do `send` manda; os templates são resolvidos uma vez por envio. */
data class Outgoing(
    val target: URI,
    val method: String,
    val headers: List<Pair<String, Template>>,
    val body: Template?,
    val signer: Signer?,
    val timeout: Duration,
)

/**
 * Um envio do `send`: resolve os placeholders uma vez (a retentativa é o MESMO evento), e a cada
 * tentativa reassina (timestamp novo, como o Stripe) e manda; retenta pela [policy]. Uma linha por
 * tentativa e uma de resumo em [out].
 *
 * @param sleep a espera entre tentativas (nos testes, sem esperar de verdade).
 */
class Sender(
    private val http: HttpClient,
    private val outgoing: Outgoing,
    private val policy: RetryPolicy,
    private val clock: Clock,
    private val sleep: (Duration) -> Unit,
    private val out: (String) -> Unit,
) {
    /** Envia o evento de número [seq] (1..); `true` quando o receptor respondeu 2xx. */
    fun send(seq: Int): Boolean {
        val event = Event(seq, clock.instant(), UUID.randomUUID())
        val headers = outgoing.headers.map { (name, value) -> name to value.render(event) }
        val body =
            outgoing.body
                ?.render(event)
                .orEmpty()
                .toByteArray(Charsets.UTF_8)
        for (attempt in 1..policy.attempts) {
            val started = System.nanoTime()
            val answer = attempt(headers, body)
            val prefix = "${LocalTime.now(clock).format(CLOCK_FORMAT)} #$seq attempt $attempt/${policy.attempts} -> "
            val result =
                when (answer) {
                    is Answer.Status -> "${answer.code} (${(System.nanoTime() - started) / NANOS_PER_MILLI} ms)"
                    is Answer.Failure -> "error: ${answer.reason}"
                }
            if (!answer.retryable() || attempt == policy.attempts) {
                out(prefix + result)
                return summary(seq, attempt, answer.delivered())
            }
            val retryAfter = (answer as? Answer.Status)?.retryAfter
            val wait = policy.wait(attempt, retryAfter, clock.instant())
            out(prefix + result + ", retrying in ${wait.delay.toMillis()} ms" + if (wait.fromRetryAfter) " (Retry-After)" else "")
            sleep(wait.delay)
        }
        error("policy.attempts is at least 1")
    }

    private fun summary(
        seq: Int,
        attempts: Int,
        delivered: Boolean,
    ): Boolean {
        out("#$seq ${if (delivered) "delivered" else "gave up"} after $attempts attempt(s)")
        return delivered
    }

    /** Uma tentativa, assinada agora; os headers da assinatura substituem os do usuário com o mesmo nome. */
    private fun attempt(
        headers: List<Pair<String, String>>,
        body: ByteArray,
    ): Answer {
        val signature = outgoing.signer?.headers(body, clock.instant()).orEmpty()
        val request =
            HttpRequest
                .newBuilder(outgoing.target)
                .timeout(outgoing.timeout)
                .method(outgoing.method, if (body.isEmpty()) BodyPublishers.noBody() else BodyPublishers.ofByteArray(body))
        headers
            .filter { (name, _) -> signature.keys.none { it.equals(name, ignoreCase = true) } }
            .forEach { (name, value) -> request.header(name, value) }
        signature.forEach { (name, value) -> request.header(name, value) }
        return try {
            val response = http.send(request.build(), BodyHandlers.discarding())
            Answer.Status(response.statusCode(), parseRetryAfter(response.headers().firstValue("Retry-After").orElse(null)))
        } catch (e: IOException) {
            Answer.Failure(e.reason())
        }
    }
}
