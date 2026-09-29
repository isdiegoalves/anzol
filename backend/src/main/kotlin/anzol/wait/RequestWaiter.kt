package anzol.wait

import anzol.capture.CapturedRequest
import anzol.capture.RequestStore
import anzol.rules.TestMiss
import anzol.rules.conditions
import anzol.rules.failures
import anzol.rules.toMatchInput
import anzol.stream.Arrival
import anzol.stream.RequestStream
import anzol.token.Token
import org.springframework.stereotype.Component
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.time.Duration
import java.util.TreeMap

/** Quantas mensagens do histórico cada leitura do índice traz. */
private const val HISTORY_BATCH = 100L

/**
 * Resposta do `requests/wait`: as [count] mensagens que casaram, de menor `seq`, em ordem crescente;
 * sem sucesso, [nearMiss] é a mais próxima entre as avaliadas (nula se nenhuma foi).
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class WaitResult(
    val matched: Boolean,
    val count: Int,
    val requests: List<CapturedRequest>,
    val nearMiss: TestMiss?,
)

/**
 * Long-poll sobre as mensagens da URL. Primeiro escuta as novas, depois lê o histórico: a mensagem
 * gravada entre as duas coisas chega pela escuta (e pode vir também no histórico; o `seq` deduplica).
 * Na ordem inversa, ela ficaria fora das duas.
 */
@Component
class RequestWaiter(
    private val requests: RequestStore,
    private val stream: RequestStream,
) {
    /** Responde quando houver `count` mensagens que casam, quando o prazo acabar ou quando a URL for apagada. */
    fun wait(
        token: Token,
        wait: WaitRequest,
    ): WaitResult {
        val deadline = System.nanoTime() + wait.timeout.toNanos()
        val evaluation = Evaluation(wait)
        stream.listen(token.uuid).use { arrivals ->
            readHistory(token, evaluation)
            while (!evaluation.done()) {
                // Prazo vencido não bloqueia: só esvazia o que já chegou.
                val arrival = arrivals.next(Duration.ofNanos(deadline - System.nanoTime()))
                if (arrival !is Arrival.Created) break
                evaluation.add(arrival.request)
            }
        }
        return evaluation.result()
    }

    /** As mensagens com `seq` maior que `after`, da mais antiga para a mais nova, até bastar. */
    private fun readHistory(
        token: Token,
        evaluation: Evaluation,
    ) {
        var cursor = evaluation.after
        do {
            val batch = requests.after(token, after = cursor, limit = HISTORY_BATCH)
            batch.messages.forEach(evaluation::add)
            cursor = batch.messages.lastOrNull()?.seq ?: cursor
            // Lote só de mensagens fantasma (valor vazio do app antigo) não avança o cursor: para ali.
        } while (batch.hasMore && batch.messages.isNotEmpty() && !evaluation.done())
    }
}

/**
 * O que a espera já avaliou: as que casaram, por `seq` (a mesma mensagem vinda do histórico e da
 * escuta conta uma vez), e a mais próxima entre as que não casaram.
 */
private class Evaluation(
    private val wait: WaitRequest,
) {
    private val conditions = wait.match.conditions()
    private val matches = TreeMap<Long, CapturedRequest>()
    private var closest: TestMiss? = null

    val after: Long get() = wait.after

    fun add(message: CapturedRequest) {
        val seq = checkNotNull(message.seq)
        if (seq <= wait.after) return
        val input = message.toMatchInput()
        val failed = conditions.failures(input)
        if (failed.isEmpty()) {
            matches[seq] = message
        } else {
            val miss = TestMiss(message.uuid, seq, failed.map { it.phrase }, failed.map { it.condition })
            closest = listOfNotNull(closest, miss).minWith(CLOSEST_FIRST)
        }
    }

    fun done(): Boolean = matches.size >= wait.count

    fun result(): WaitResult {
        val found = matches.values.take(wait.count)
        val matched = found.size == wait.count
        return WaitResult(matched = matched, count = found.size, requests = found, nearMiss = closest.takeUnless { matched })
    }

    private companion object {
        /** Menos condições falhando; no empate, a mais nova. */
        val CLOSEST_FIRST = compareBy<TestMiss> { it.failed.size }.thenByDescending { it.seq }
    }
}
