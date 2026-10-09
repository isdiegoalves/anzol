package anzol.stats

import anzol.e2ee.DecryptionState
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming

/** Por `decryption.state`; `unchecked` é `decryption: null` (a URL não decifrava). [reasons] vem das inválidas. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DecryptionStats(
    val valid: Int,
    val invalid: Int,
    val unknownKid: Int,
    val absent: Int,
    val unchecked: Int,
    val reasons: List<ReasonCount>,
)

/** A decifra das amostras, por estado, e os motivos das inválidas. */
fun List<StatsSample>.decryptionStats(): DecryptionStats {
    val states = groupingBy { it.decryptionState }.eachCount()
    val reasons =
        filter { it.decryptionState == DecryptionState.INVALID }
            .mapNotNull { it.decryptionReason }
            .ranked()
            .map { (reason, count) -> ReasonCount(reason, count) }
    return DecryptionStats(
        valid = states[DecryptionState.VALID] ?: 0,
        invalid = states[DecryptionState.INVALID] ?: 0,
        unknownKid = states[DecryptionState.UNKNOWN_KID] ?: 0,
        absent = states[DecryptionState.ABSENT] ?: 0,
        unchecked = states[null] ?: 0,
        reasons = reasons,
    )
}
