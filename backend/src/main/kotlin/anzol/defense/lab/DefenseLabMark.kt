package anzol.defense.lab

import anzol.TIMESTAMP_PATTERN
import com.fasterxml.jackson.annotation.JsonFormat
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

/** Quanto vive uma URL de laboratório de defesa, contado da criação; o uso não renova. */
val DEFENSE_LAB_LIFETIME: Duration = Duration.ofHours(24)

/** URLs de laboratório de defesa ativas no servidor, ao mesmo tempo. */
const val MAX_ACTIVE_DEFENSE_LABS = 20

/** A marca de uma URL de laboratório de defesa: o fim da vida dela. Nasce com a URL e nenhuma rota a troca. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DefenseLabMark(
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val expiresAt: LocalDateTime,
) {
    /** O que falta até [expiresAt], no mínimo um segundo (o TTL das chaves da URL). */
    fun remaining(now: Instant): Duration = Duration.between(now, expiresAt.toInstant(ZoneOffset.UTC)).coerceAtLeast(Duration.ofSeconds(1))
}
