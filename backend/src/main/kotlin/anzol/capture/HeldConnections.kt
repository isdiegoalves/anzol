package anzol.capture

import anzol.TokenId
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.convert.DurationUnit
import org.springframework.stereotype.Component
import java.time.Duration
import java.time.temporal.ChronoUnit
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

const val MAX_HELD_PER_URL = 16
const val MAX_HELD = 128
private const val DEFAULT_HOLD_MAX_SECONDS = 300L

/** `ANZOL_FAULT_HOLD_MAX`: por quanto tempo, no máximo, `hang` e `stall_after_headers` prendem a conexão (padrão 300 s). */
@ConfigurationProperties("anzol.fault")
data class FaultProperties(
    @param:DurationUnit(ChronoUnit.SECONDS)
    val holdMax: Duration = Duration.ofSeconds(DEFAULT_HOLD_MAX_SECONDS),
)

/** O teto que barrou uma conexão presa, com o texto do cabeçalho `X-Fault-Limit`. */
enum class HoldLimit(
    val reason: String,
) {
    URL("$MAX_HELD_PER_URL held connections on this URL"),
    SERVER("$MAX_HELD held connections on this server"),
}

/** A vaga de uma conexão presa, ou o teto que a barrou ([refused]); fechar devolve a vaga reservada. */
class HoldSlot(
    val refused: HoldLimit?,
    private val release: () -> Unit,
) : AutoCloseable {
    override fun close() = release()

    companion object {
        /** Sem vaga a reservar: a falha não prende a conexão. */
        val NONE = HoldSlot(refused = null) {}
    }
}

/**
 * Conexões presas por `hang` e `stall_after_headers` neste processo, da gravação da mensagem até a conexão fechar:
 * no máximo [MAX_HELD_PER_URL] por URL e [MAX_HELD] no total, conferida a URL primeiro. Cada uma é uma thread virtual
 * parada, sem thread de plataforma; o teto protege memória e descritores.
 */
@Component
class HeldConnections(
    properties: FaultProperties,
) {
    val holdMax: Duration = properties.holdMax
    private val perUrl = ConcurrentHashMap<TokenId, Int>()
    private val total = AtomicInteger()

    fun reserve(token: TokenId): HoldSlot {
        var refused: HoldLimit? = null
        perUrl.compute(token) { _, held ->
            val count = held ?: 0
            refused =
                when {
                    count >= MAX_HELD_PER_URL -> HoldLimit.URL
                    total.getAndUpdate { if (it < MAX_HELD) it + 1 else it } >= MAX_HELD -> HoldLimit.SERVER
                    else -> null
                }
            if (refused == null) count + 1 else held
        }
        return if (refused == null) HoldSlot(refused = null) { release(token) } else HoldSlot(refused) {}
    }

    /** Quantas conexões estão presas agora, somadas todas as URLs. */
    fun held(): Int = total.get()

    private fun release(token: TokenId) {
        perUrl.computeIfPresent(token) { _, held -> (held - 1).takeIf { it > 0 } }
        total.decrementAndGet()
    }
}
