package anzol.defense.lab

import anzol.RedisKeys
import anzol.RequestId
import anzol.capture.RequestStore
import anzol.countInWindow
import anzol.signature.SignatureConfig
import anzol.token.Token
import org.springframework.core.env.Environment
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Component
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Clock
import java.time.Duration
import java.util.UUID
import kotlin.random.Random

/** Rodadas abertas por URL de laboratório no minuto. */
private const val MAX_ROUNDS_PER_MINUTE = 6
private val SEND_TIMEOUT: Duration = Duration.ofSeconds(10)

/** A semente cabe num número de JSON sem perder precisão (2^53 - 1). */
const val MAX_SEED = 9_007_199_254_740_991L
private const val BLOCKED_FROM = 400
private val PASSED = 200..299

/** O fim de uma operação da rodada: o valor, os erros do pedido (422), 404, 409 ou o limite da URL (429). */
sealed interface RoundOutcome<out T> {
    data class Done<T>(
        val value: T,
    ) : RoundOutcome<T>

    data class Invalid(
        val errors: Map<String, List<String>>,
    ) : RoundOutcome<Nothing>

    data object NotFound : RoundOutcome<Nothing>

    data class Conflict(
        val message: String,
    ) : RoundOutcome<Nothing>

    data class Limited(
        val retryAfterSeconds: Long,
    ) : RoundOutcome<Nothing>
}

/** A rodada aberta: o id dela e quantas requisições a onda 1 entregou. A semente só sai no relatório. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DefenseRoundStarted(
    val roundId: String,
    val catalogVersion: String,
    val requests: Int,
)

/** Quantas requisições da onda 1 já têm veredicto. */
data class DefenseVerdictsRecorded(
    val recorded: Int,
    val requests: Int,
)

/** O que a captura respondeu a uma requisição entregue. */
private data class Delivery(
    val status: Int,
    val requestId: RequestId?,
)

/**
 * Conduz a rodada numa URL de laboratório de defesa: entrega a onda 1 pela captura de verdade (por loopback, com a
 * assinatura, o schema e as regras da URL), guarda o gabarito, recebe os veredictos e, no fim, entrega a onda 2 e
 * mede. O gabarito só sai no relatório.
 */
@Component
class DefenseRunner(
    private val requests: RequestStore,
    private val rounds: DefenseRoundStore,
    private val redis: StringRedisTemplate,
    private val environment: Environment,
    private val clock: Clock,
) {
    private val http: HttpClient = HttpClient.newBuilder().connectTimeout(SEND_TIMEOUT).build()

    /** [seed] nula sorteia. URL que não é de laboratório: 422; rodada já aberta: 409; acima do limite: 429. */
    fun start(
        token: Token,
        seed: Long?,
    ): RoundOutcome<DefenseRoundStarted> {
        val signature = token.signature
        val id = UUID.randomUUID().toString()
        return when {
            token.defenseLab == null -> RoundOutcome.Invalid(NOT_A_DEFENSE_LAB)
            signature == null -> RoundOutcome.Invalid(NO_SIGNATURE)
            else -> limited(token) ?: if (rounds.open(token, id)) started(token, signature, id, seed) else RoundOutcome.Conflict(ROUND_OPEN)
        }
    }

    private fun limited(token: Token): RoundOutcome.Limited? =
        redis
            .countInWindow(RedisKeys.defenseRoundRate(token.uuid), Duration.ofMinutes(1), MAX_ROUNDS_PER_MINUTE)
            ?.let { RoundOutcome.Limited(it.retryAfterSeconds) }

    private fun started(
        token: Token,
        signature: SignatureConfig,
        id: String,
        seed: Long?,
    ): RoundOutcome<DefenseRoundStarted> {
        val chosen = seed ?: Random.nextLong(MAX_SEED + 1)
        val wave1 =
            DefenseVectors(signature, clock.instant(), chosen, wave = 1).wave().map {
                val delivery = deliver(token, it.request)
                Delivered(checkNotNull(delivery.requestId) { "a captura não devolveu o id da requisição" }, it.scenario)
            }
        rounds.clearVerdicts(token)
        rounds.save(token, DefenseRound(id, chosen, wave1, clock.millis()))
        return RoundOutcome.Done(DefenseRoundStarted(id, DEFENSE_CATALOG_VERSION, wave1.size))
    }

    /** Veredictos de requisições da onda 1 da rodada aberta; id de fora dela: 422. */
    fun verdicts(
        token: Token,
        roundId: String,
        verdicts: List<Pair<String, Verdict>>,
    ): RoundOutcome<DefenseVerdictsRecorded> {
        val round = rounds.find(token, roundId) ?: return RoundOutcome.NotFound
        val known = round.wave1.map { it.requestId.toString() }.toSet()
        val unknown = verdicts.withIndex().filter { it.value.first !in known }
        return when {
            round.report != null || !rounds.isOpen(token, roundId) -> {
                RoundOutcome.Conflict(ROUND_CLOSED)
            }

            unknown.isNotEmpty() -> {
                RoundOutcome.Invalid(
                    unknown.associate { "verdicts.${it.index}.request_id" to listOf("The request is not part of this round.") },
                )
            }

            else -> {
                rounds.record(token, verdicts.toMap())
                RoundOutcome.Done(DefenseVerdictsRecorded(rounds.verdicts(token).size, known.size))
            }
        }
    }

    /** Fecha a rodada: entrega a onda 2 contra as regras de agora e devolve o relatório. */
    fun finish(
        token: Token,
        roundId: String,
    ): RoundOutcome<DefenseReport> {
        val round = rounds.find(token, roundId) ?: return RoundOutcome.NotFound
        val signature = token.signature
        return when {
            signature == null -> RoundOutcome.Invalid(NO_SIGNATURE)
            round.report != null || !rounds.close(token, roundId) -> RoundOutcome.Conflict(ROUND_CLOSED)
            else -> RoundOutcome.Done(finished(token, signature, round))
        }
    }

    private fun finished(
        token: Token,
        signature: SignatureConfig,
        round: DefenseRound,
    ): DefenseReport {
        val seconds = Duration.ofMillis(clock.millis() - round.deliveredAtMillis).seconds
        val vectors = DefenseVectors(signature, clock.instant(), round.seed, wave = 2)
        val wave2 = vectors.wave().map { it.scenario to deliver(token, it.request) }
        val report = report(token, round, rounds.verdicts(token), wave2, seconds)
        rounds.save(token, round.copy(report = report))
        rounds.clearVerdicts(token)
        return report
    }

    /** O relatório de uma rodada fechada; aberta: 409. */
    fun report(
        token: Token,
        roundId: String,
    ): RoundOutcome<DefenseReport> {
        val round = rounds.find(token, roundId) ?: return RoundOutcome.NotFound
        return round.report?.let { RoundOutcome.Done(it) } ?: RoundOutcome.Conflict(ROUND_STILL_OPEN)
    }

    private fun report(
        token: Token,
        round: DefenseRound,
        verdicts: Map<String, Verdict>,
        wave2: List<Pair<DefenseScenario?, Delivery>>,
        seconds: Long,
    ): DefenseReport {
        val scenarios =
            round.wave1
                .filter { it.scenario != null }
                .sortedBy { it.scenario }
                .map { scenario(token, it, verdicts[it.requestId.toString()], wave2) }
        val legitimate1 = round.wave1.filter { it.scenario == null }
        val flagged = legitimate1.map { it.requestId }.filter { verdicts[it.toString()]?.verdict == VerdictKind.ATTACK }
        val legitimate2 = wave2.filter { it.first == null }
        return DefenseReport(
            roundId = round.id,
            catalogVersion = DEFENSE_CATALOG_VERSION,
            seed = round.seed,
            containmentSeconds = seconds,
            scenarios = scenarios,
            detection = DetectionTotals(scenarios.size, scenarios.count { it.detection.detected }, legitimate1.size, flagged.size),
            containment =
                ContainmentTotals(
                    attacks = scenarios.size,
                    blocked = scenarios.count { it.containment.blocked },
                    legitimate = legitimate2.size,
                    passed = legitimate2.count { it.second.status in PASSED },
                ),
            falsePositives = flagged,
        )
    }

    /** Requisição sem veredicto conta como legítima. */
    private fun scenario(
        token: Token,
        delivered: Delivered,
        verdict: Verdict?,
        wave2: List<Pair<DefenseScenario?, Delivery>>,
    ): ScenarioResult {
        val scenario = checkNotNull(delivered.scenario)
        val state = requests.find(token, delivered.requestId)?.signature?.state()
        val contained = wave2.first { it.first == scenario }.second
        val kind = verdict?.verdict ?: VerdictKind.LEGITIMATE
        return ScenarioResult(
            code = scenario.name,
            family = scenario.family,
            layer = scenario.layer,
            title = scenario.title,
            floor = FloorResult(scenario.floor, state, ok = state == scenario.floor),
            detection = DetectionResult(delivered.requestId, kind, verdict?.family, detected = kind == VerdictKind.ATTACK),
            containment = ContainmentResult(contained.requestId, contained.status, blocked = contained.status >= BLOCKED_FROM),
        )
    }

    /** A requisição pela porta do próprio servidor, como chegaria de fora. */
    private fun deliver(
        token: Token,
        request: DefenseRequest,
    ): Delivery {
        val port = checkNotNull(environment.getProperty("local.server.port")) { "porta do servidor desconhecida" }
        val builder =
            HttpRequest
                .newBuilder(URI.create("http://127.0.0.1:$port/${token.uuid}"))
                .timeout(SEND_TIMEOUT)
                .POST(HttpRequest.BodyPublishers.ofString(request.body))
        request.headers.forEach { (name, value) -> builder.header(name, value) }
        val response = http.send(builder.build(), HttpResponse.BodyHandlers.discarding())
        val requestId =
            response
                .headers()
                .firstValue("X-Request-Id")
                .map { RequestId(UUID.fromString(it)) }
                .orElse(null)
        return Delivery(response.statusCode(), requestId)
    }
}

private val NOT_A_DEFENSE_LAB = mapOf("defense_lab" to listOf("This is not a defense lab URL: create one with POST /defense-lab."))
private val NO_SIGNATURE = mapOf("signature" to listOf("The defense lab URL has no signature anymore: create a new one."))
private const val ROUND_OPEN = "This URL already has an open round; finish it first"
private const val ROUND_CLOSED = "This round is already finished"
private const val ROUND_STILL_OPEN = "This round is still open; finish it to get the report"
