package anzol.rules

import com.fasterxml.jackson.annotation.JsonValue
import java.math.BigDecimal
import java.util.concurrent.ThreadLocalRandom
import kotlin.math.exp

/** Teto de todo atraso e da duração do dribble (Anexo B). */
const val MAX_DELAY_MS = 60_000

/**
 * Atraso antes de responder; no JSON, `{fixed: ms}`, `{uniform: {min, max}}` ou
 * `{lognormal: {median, sigma}}` (ms; a mediana e o sigma da distribuição log-normal).
 */
sealed interface Delay {
    data class Fixed(
        val ms: Int,
    ) : Delay

    data class Uniform(
        val min: Int,
        val max: Int,
    ) : Delay

    data class LogNormal(
        val median: BigDecimal,
        val sigma: BigDecimal,
    ) : Delay

    @JsonValue
    fun toJson(): Map<String, Any> =
        when (this) {
            is Fixed -> mapOf("fixed" to ms)
            is Uniform -> mapOf("uniform" to mapOf("min" to min, "max" to max))
            is LogNormal -> mapOf("lognormal" to mapOf("median" to median, "sigma" to sigma))
        }

    /** Um sorteio do atraso, em ms; o log-normal é cortado em [MAX_DELAY_MS]. */
    fun millis(): Long {
        val random = ThreadLocalRandom.current()
        return when (this) {
            is Fixed -> ms.toLong()
            is Uniform -> random.nextLong(min.toLong(), max.toLong() + 1)
            is LogNormal -> (median.toDouble() * exp(sigma.toDouble() * random.nextGaussian())).toLong().coerceIn(0L, MAX_DELAY_MS.toLong())
        }
    }
}

/** Corpo em [chunks] pedaços, mandados em intervalos iguais ao longo de [durationMs]. */
data class Dribble(
    val chunks: Int,
    val durationMs: Int,
)

/**
 * Falha de rede no lugar da resposta; no JSON, o nome em minúsculas. [holds]: a conexão fica presa até o cliente
 * desistir ou o teto (conta no limite de conexões presas). [startsResponse]: manda o status e os cabeçalhos da regra
 * antes de falhar, com o `Content-Length` do corpo, e por isso exige corpo.
 */
enum class Fault(
    @get:JsonValue val value: String,
    val holds: Boolean = false,
    val startsResponse: Boolean = false,
) {
    CONNECTION_RESET("connection_reset"),
    EMPTY_RESPONSE("empty_response"),
    MALFORMED_CHUNK("malformed_chunk"),
    RANDOM_DATA_THEN_CLOSE("random_data_then_close"),
    HANG("hang", holds = true),
    STALL_AFTER_HEADERS("stall_after_headers", holds = true, startsResponse = true),
    TRUNCATED_BODY("truncated_body", startsResponse = true),
    ;

    companion object {
        fun of(value: String): Fault? = entries.firstOrNull { it.value == value }
    }
}

/** O corpo em [chunks] pedaços de tamanhos que diferem no máximo em 1 byte (os maiores primeiro). */
fun dribblePieces(
    body: ByteArray,
    chunks: Int,
): List<ByteArray> {
    val base = body.size / chunks
    val bigger = body.size % chunks
    return List(chunks) { index ->
        val start = index * base + minOf(index, bigger)
        body.copyOfRange(start, start + base + if (index < bigger) 1 else 0)
    }
}
