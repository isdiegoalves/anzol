package anzol.e2ee

import anzol.rules.Violations
import anzol.rules.bodyMapper
import com.nimbusds.jose.JOSEException
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.crypto.utils.ECChecks
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.KeyUse
import tools.jackson.databind.JsonNode
import java.text.ParseException

/** JWK pública de assinatura de um remetente: EC P-256, com `kid`, sem `d`, ponto na curva, para ES256. */
fun Violations.signer(
    node: JsonNode,
    key: String,
): ECKey? {
    val jwk = publicJwk(node, key) ?: return null
    return when {
        jwk.keyUse != null && jwk.keyUse != KeyUse.SIGNATURE -> fail(key, "The $key use must be sig.")
        jwk.algorithm != null && jwk.algorithm != JWSAlgorithm.ES256 -> fail(key, "The $key must be for ES256 (alg absent or ES256).")
        else -> jwk
    }
}

/** JWK pública EC P-256 com `kid`, sem parte privada e com o ponto na curva. */
private fun Violations.publicJwk(
    node: JsonNode,
    key: String,
): ECKey? {
    val jwk =
        when {
            !node.isObject -> fail(key, "The $key must be a JWK object.")
            node.has("d") -> fail(key, "The $key must be a public key: it has the private part d.")
            else -> ecKey(node, key)
        } ?: return null
    return when {
        jwk.curve != Curve.P_256 -> fail(key, "The $key must use the P-256 curve.")
        !jwk.isOnP256() -> fail(key, "The $key point is not on the P-256 curve.")
        jwk.keyID.isNullOrBlank() -> fail(key, "The $key must have a kid.")
        else -> jwk.toPublicJWK()
    }
}

private fun Violations.ecKey(
    node: JsonNode,
    key: String,
): ECKey? =
    try {
        @Suppress("UNCHECKED_CAST")
        ECKey.parse(bodyMapper.convertValue(node, Map::class.java) as Map<String, Any?>)
    } catch (e: ParseException) {
        fail(key, "The $key is not a valid EC JWK: ${e.message}")
    } catch (e: IllegalArgumentException) {
        fail(key, "The $key is not a valid EC JWK: ${e.message}")
    }

/** O ponto público na P-256; a biblioteca já recusa ponto fora da curva ao ler, e esta é a conferência explícita. */
fun ECKey.isOnP256(): Boolean =
    try {
        ECChecks.isPointOnCurve(toECPublicKey(), Curve.P_256.toECParameterSpec())
    } catch (_: JOSEException) {
        false
    }
