package anzol.e2ee

import anzol.TIMESTAMP_PATTERN
import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonFormat
import com.fasterxml.jackson.annotation.JsonValue
import com.nimbusds.jose.JWEAlgorithm
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.KeyUse
import com.nimbusds.jose.jwk.gen.ECKeyGenerator
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/** Chaves de cifra ativas por URL: a atual e a da rotação. */
const val MAX_E2EE_KEYS = 2

/** Exclusões de chave de cifra que a URL lembra: as mais novas. */
const val MAX_DELETED_E2EE_KEYS = 20

/** `kid` escolhido pelo cliente: o que cabe num cabeçalho JWE sem escapar nada. */
val KID_PATTERN = Regex("[A-Za-z0-9._-]{1,64}")

private val TIMESTAMP: DateTimeFormatter = DateTimeFormatter.ofPattern(TIMESTAMP_PATTERN)

/**
 * Chave de cifra da URL (EC P-256, ECDH-ES): o par inteiro, gravado só no Redis. A API, o MCP e os logs veem
 * [public] ([toString] não mostra a parte privada).
 */
data class E2eeKey(
    val kid: String,
    val jwk: ECKey,
    val createdAt: LocalDateTime,
) {
    /** A pública como o JWKS da URL a publica: `use=enc` e `alg=ECDH-ES`. */
    fun public(): ECKey =
        ECKey
            .Builder(jwk.toPublicJWK())
            .keyUse(KeyUse.ENCRYPTION)
            .algorithm(JWEAlgorithm.ECDH_ES)
            .build()

    fun view(): E2eeKeyView = E2eeKeyView(kid, createdAt, public().toJSONObject())

    override fun toString(): String = "E2eeKey(kid=$kid)"

    @JsonValue
    fun toJson(): Map<String, Any> = linkedMapOf("kid" to kid, "created_at" to TIMESTAMP.format(createdAt), "jwk" to jwk.toJSONObject())

    companion object {
        fun generate(
            kid: String,
            createdAt: LocalDateTime,
        ): E2eeKey = E2eeKey(kid, ECKeyGenerator(Curve.P_256).keyID(kid).generate(), createdAt)

        /** Lê o JSON gravado no Redis. */
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun fromJson(value: Map<String, Any?>): E2eeKey {
            @Suppress("UNCHECKED_CAST")
            val jwk = ECKey.parse(value["jwk"] as Map<String, Any?>)
            require(jwk.isPrivate) { "chave e2ee sem a parte privada no Redis: ${value["kid"]}" }
            return E2eeKey(value["kid"].toString(), jwk, LocalDateTime.parse(value["created_at"].toString(), TIMESTAMP))
        }
    }
}

/** A chave como a API a mostra: só a pública. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class E2eeKeyView(
    val kid: String,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val createdAt: LocalDateTime,
    val jwk: Map<String, Any>,
)

/** Uma chave de cifra apagada da URL: o `kid` e quando. O par saiu do Redis com ela. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DeletedE2eeKey(
    val kid: String,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val deletedAt: LocalDateTime,
)

/** O registro com [kid] apagado em [at]: uma entrada por `kid` (a exclusão mais nova), até [MAX_DELETED_E2EE_KEYS]. */
fun List<DeletedE2eeKey>.recording(
    kid: String,
    at: LocalDateTime,
): List<DeletedE2eeKey> = (filterNot { it.kid == kid } + DeletedE2eeKey(kid, at)).takeLast(MAX_DELETED_E2EE_KEYS)
