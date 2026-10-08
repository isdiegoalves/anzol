package anzol.e2ee.lab

import anzol.TIMESTAMP_PATTERN
import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonFormat
import com.fasterxml.jackson.annotation.JsonValue
import com.nimbusds.jose.jwk.ECKey
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** Quanto vive uma URL de laboratório, contado da criação; o uso não renova. */
val LAB_LIFETIME: Duration = Duration.ofHours(24)

/** URLs de laboratório ativas no servidor, ao mesmo tempo. */
const val MAX_ACTIVE_LABS = 20

private val TIMESTAMP: DateTimeFormatter = DateTimeFormatter.ofPattern(TIMESTAMP_PATTERN)

/**
 * A marca de uma URL de laboratório E2EE: o remetente de teste (par ES256 com a privada, que assina os cenários
 * gerados no servidor) e o fim da vida dela. Nasce com a URL e nenhuma rota a troca; [toString] não mostra a privada.
 */
data class LabMark(
    val signer: ECKey,
    val expiresAt: LocalDateTime,
) {
    fun view(): LabView = LabView(signer.keyID, expiresAt)

    /** O que falta até [expiresAt], no mínimo um segundo (o TTL das chaves da URL). */
    fun remaining(now: Instant): Duration = Duration.between(now, expiresAt.toInstant(ZoneOffset.UTC)).coerceAtLeast(Duration.ofSeconds(1))

    override fun toString(): String = "LabMark(signer=${signer.keyID}, expiresAt=$expiresAt)"

    @JsonValue
    fun toJson(): Map<String, Any> = linkedMapOf("signer" to signer.toJSONObject(), "expires_at" to TIMESTAMP.format(expiresAt))

    companion object {
        /** Lê o JSON gravado no Redis. */
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun fromJson(value: Map<String, Any?>): LabMark {
            @Suppress("UNCHECKED_CAST")
            val signer = ECKey.parse(value["signer"] as Map<String, Any?>)
            require(signer.isPrivate) { "remetente de teste sem a privada no Redis" }
            return LabMark(signer, LocalDateTime.parse(value["expires_at"].toString(), TIMESTAMP))
        }
    }
}

/** A marca como a API a mostra: o `kid` do remetente de teste e o fim da vida da URL. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class LabView(
    val signerKid: String,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val expiresAt: LocalDateTime,
)
