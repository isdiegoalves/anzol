package anzol.defense.lab

import anzol.rules.bodyMapper
import anzol.signature.Secret
import anzol.signature.SignatureConfig
import anzol.signature.sign
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import kotlin.random.Random

/** A tolerância de timestamp da assinatura da URL de laboratório. */
const val DEFENSE_TOLERANCE_SECONDS = 300L

/** A conta da loja fictícia nos eventos legítimos. */
const val STORE_ACCOUNT = "acct_store_01"

private const val ORDERS_PER_WAVE = 6
private val LIFECYCLE = listOf("order.created", "payment.paid", "order.shipped")

/** Uma hora além da tolerância: o replay fica fora dela com folga para relógio e espera. */
private const val REPLAY_AGE_SECONDS = DEFENSE_TOLERANCE_SECONDS + 3_600L
private const val WAVE_SALT = 31L
private const val MIN_AMOUNT = 1_000
private const val MAX_AMOUNT = 50_000
private const val MIN_ORDER = 100_000
private const val MAX_ORDER = 1_000_000
private const val TAMPER_FACTOR = 10
private const val HEX = 16

/** Legítimas e ataques saem com os mesmos cabeçalhos: nada além da assinatura os distingue. */
private val BASE_HEADERS = mapOf("Content-Type" to "application/json", "User-Agent" to "Store-Webhooks/1.0")

/** A requisição pronta: o corpo exato e os cabeçalhos. */
data class DefenseRequest(
    val body: String,
    val headers: Map<String, String>,
)

/** Uma requisição da onda; [scenario] nulo é tráfego legítimo. */
data class Planned(
    val scenario: DefenseScenario?,
    val request: DefenseRequest,
)

private data class Order(
    val id: String,
    val amount: Int,
)

/**
 * Monta uma onda da rodada: os pedidos legítimos da loja (cada um com os eventos na ordem do ciclo) e um ataque por
 * cenário, misturados. A mesma [seed] e a mesma onda geram os mesmos vetores, fora os instantes.
 */
class DefenseVectors(
    private val signature: SignatureConfig,
    private val now: Instant,
    seed: Long,
    wave: Int,
) {
    private val random = Random(seed * WAVE_SALT + wave)

    fun wave(): List<Planned> {
        val legitimate = (1..ORDERS_PER_WAVE).flatMap { lifecycle() }
        val attacks = DefenseScenario.entries.map { random.nextDouble() to Planned(it, attack(it)) }
        return (legitimate + attacks).sortedBy { it.first }.map { it.second }
    }

    /** Os eventos de um pedido, com posições sorteadas e em ordem crescente: o ciclo nunca sai invertido. */
    private fun lifecycle(): List<Pair<Double, Planned>> {
        val order = order()
        val positions = LIFECYCLE.map { random.nextDouble() }.sorted()
        return LIFECYCLE.zip(positions).map { (type, position) -> position to Planned(null, signed(event(type, order))) }
    }

    private fun attack(scenario: DefenseScenario): DefenseRequest {
        val order = order()
        return when (scenario) {
            DefenseScenario.I1 -> {
                signed(event(PAID, order), signature.copy(secret = Secret("forged-${hex()}")))
            }

            DefenseScenario.I2 -> {
                val sent = signed(event(PAID, order))
                sent.copy(body = sent.body.replace("\"amount\":${order.amount}", "\"amount\":${order.amount * TAMPER_FACTOR}"))
            }

            DefenseScenario.I3 -> {
                DefenseRequest(event(PAID, order), BASE_HEADERS)
            }

            DefenseScenario.I4 -> {
                val old = now.minusSeconds(REPLAY_AGE_SECONDS)
                signed(event(PAID, order, old), at = old)
            }
        }
    }

    private fun order(): Order = Order("ord_${random.nextInt(MIN_ORDER, MAX_ORDER)}", random.nextInt(MIN_AMOUNT, MAX_AMOUNT))

    private fun hex(): String = random.nextLong().toULong().toString(HEX)

    private fun event(
        type: String,
        order: Order,
        at: Instant = now,
    ): String =
        bodyMapper.writeValueAsString(
            linkedMapOf(
                "id" to "evt_${hex()}",
                "type" to type,
                "created" to at.epochSecond,
                "data" to
                    linkedMapOf(
                        "order_id" to order.id,
                        "amount" to order.amount,
                        "currency" to "BRL",
                        "account" to STORE_ACCOUNT,
                    ),
            ),
        )

    private fun signed(
        body: String,
        config: SignatureConfig = signature,
        at: Instant = now,
    ): DefenseRequest = DefenseRequest(body, BASE_HEADERS + config.sign(body.toByteArray(UTF_8), at))
}

private const val PAID = "payment.paid"
