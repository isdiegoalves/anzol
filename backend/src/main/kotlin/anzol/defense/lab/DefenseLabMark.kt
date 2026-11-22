package anzol.defense.lab

import anzol.TIMESTAMP_PATTERN
import anzol.schema.SchemaConfig
import anzol.signature.SignatureConfig
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

/**
 * A marca de uma URL de laboratório de defesa: o fim da vida dela e o estado de criação ([signature], com o segredo, e
 * [schema]). As ondas são assinadas com [signature], a do provedor, mesmo que a URL troque a dela; a diferença entre
 * o estado de criação e o de agora é o afrouxamento. Nasce com a URL e nenhuma rota a troca.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DefenseLabMark(
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val expiresAt: LocalDateTime,
    val signature: SignatureConfig,
    val schema: SchemaConfig,
) {
    fun view(): DefenseLabView = DefenseLabView(expiresAt)

    /** O que falta até [expiresAt], no mínimo um segundo (o TTL das chaves da URL). */
    fun remaining(now: Instant): Duration = Duration.between(now, expiresAt.toInstant(ZoneOffset.UTC)).coerceAtLeast(Duration.ofSeconds(1))
}

/** A marca como a API a mostra: só o fim da vida da URL. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DefenseLabView(
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val expiresAt: LocalDateTime,
)
