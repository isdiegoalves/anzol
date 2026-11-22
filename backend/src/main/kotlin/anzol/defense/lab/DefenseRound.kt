package anzol.defense.lab

import anzol.RedisKeys
import anzol.RequestId
import anzol.signature.SignatureState
import anzol.token.Token
import com.fasterxml.jackson.annotation.JsonValue
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Component
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import tools.jackson.databind.json.JsonMapper
import java.time.Clock
import java.time.Duration

enum class VerdictKind(
    @get:JsonValue val id: String,
) {
    LEGITIMATE("legitimate"),
    ATTACK("attack"),
    ;

    companion object {
        fun of(id: String): VerdictKind? = entries.firstOrNull { it.id == id }
    }
}

/** O que o agente disse de uma requisição da onda 1. */
data class Verdict(
    val verdict: VerdictKind,
    val family: DefenseFamily? = null,
)

/** Uma requisição entregue na onda 1 com o rótulo dela ([scenario] nulo é legítima): uma linha do gabarito. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class Delivered(
    val requestId: RequestId,
    val scenario: DefenseScenario?,
)

/** A rodada gravada: a semente, o gabarito da onda 1, quando ela terminou de chegar e, depois do fim, o relatório. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DefenseRound(
    val id: String,
    val seed: Long,
    val wave1: List<Delivered>,
    val deliveredAtMillis: Long,
    val report: DefenseReport? = null,
)

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class FloorResult(
    val expected: SignatureState,
    val actual: SignatureState?,
    val ok: Boolean,
)

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DetectionResult(
    val requestId: RequestId,
    val verdict: VerdictKind,
    val family: DefenseFamily?,
    val detected: Boolean,
)

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class ContainmentResult(
    val requestId: RequestId?,
    val status: Int,
    val blocked: Boolean,
)

/** Um cenário no relatório: o piso e a detecção na onda 1, a contenção na onda 2. */
data class ScenarioResult(
    val code: String,
    val family: DefenseFamily,
    val layer: DefenseLayer,
    val title: String,
    val floor: FloorResult,
    val detection: DetectionResult,
    val containment: ContainmentResult,
)

/** Onda 1: ataques e quantos o agente marcou; legítimas e quantas ele marcou como ataque. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DetectionTotals(
    val attacks: Int,
    val detected: Int,
    val legitimate: Int,
    val falsePositives: Int,
)

/** Onda 2: ataques e quantos foram barrados (status 400 ou mais); legítimas e quantas passaram (2xx). */
data class ContainmentTotals(
    val attacks: Int,
    val blocked: Int,
    val legitimate: Int,
    val passed: Int,
)

/** O relatório da rodada fechada; é o único lugar por onde o gabarito sai. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DefenseReport(
    val roundId: String,
    val catalogVersion: String,
    val seed: Long,
    val containmentSeconds: Long,
    val scenarios: List<ScenarioResult>,
    val detection: DetectionTotals,
    val containment: ContainmentTotals,
    val falsePositives: List<RequestId>,
)

/**
 * As rodadas de uma URL de laboratório de defesa no Redis: o hash das rodadas, os veredictos da rodada aberta e o
 * ponteiro dela (só uma por URL). Tudo com o TTL da URL.
 */
@Component
class DefenseRoundStore(
    private val redis: StringRedisTemplate,
    private val jsonMapper: JsonMapper,
    private val clock: Clock,
) {
    /** Abre a rodada [id] se a URL não tem outra aberta. */
    fun open(
        token: Token,
        id: String,
    ): Boolean = redis.opsForValue().setIfAbsent(RedisKeys.defenseOpenRound(token.uuid), id, ttl(token)) == true

    fun isOpen(
        token: Token,
        id: String,
    ): Boolean = redis.opsForValue().get(RedisKeys.defenseOpenRound(token.uuid)) == id

    /** Fecha a rodada [id]; falso se ela já não era a aberta. Atômico: de dois fechamentos, só um passa. */
    fun close(
        token: Token,
        id: String,
    ): Boolean = redis.opsForValue().getAndDelete(RedisKeys.defenseOpenRound(token.uuid)) == id

    fun save(
        token: Token,
        round: DefenseRound,
    ) {
        val key = RedisKeys.defenseRounds(token.uuid)
        redis.opsForHash<String, String>().put(key, round.id, jsonMapper.writeValueAsString(round))
        redis.expire(key, ttl(token))
    }

    fun find(
        token: Token,
        id: String,
    ): DefenseRound? =
        redis.opsForHash<String, String>().get(RedisKeys.defenseRounds(token.uuid), id)?.let {
            jsonMapper.readValue(it, DefenseRound::class.java)
        }

    /** Grava os veredictos da rodada aberta; para o mesmo id de requisição, vale o último. */
    fun record(
        token: Token,
        verdicts: Map<String, Verdict>,
    ) {
        val key = RedisKeys.defenseVerdicts(token.uuid)
        redis.opsForHash<String, String>().putAll(key, verdicts.mapValues { jsonMapper.writeValueAsString(it.value) })
        redis.expire(key, ttl(token))
    }

    fun verdicts(token: Token): Map<String, Verdict> =
        redis
            .opsForHash<String, String>()
            .entries(RedisKeys.defenseVerdicts(token.uuid))
            .mapValues { jsonMapper.readValue(it.value, Verdict::class.java) }

    fun clearVerdicts(token: Token) {
        redis.delete(RedisKeys.defenseVerdicts(token.uuid))
    }

    private fun ttl(token: Token): Duration = token.defenseLab?.remaining(clock.instant()) ?: DEFENSE_LAB_LIFETIME
}
