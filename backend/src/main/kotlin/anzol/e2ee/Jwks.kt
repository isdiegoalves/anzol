package anzol.e2ee

import anzol.rules.Violations
import anzol.rules.bodyMapper
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.KeyUse
import tools.jackson.databind.JsonNode
import java.math.BigInteger
import java.security.spec.ECFieldFp
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

/** O ponto público de [this] na P-256 ([onP256]). */
fun ECKey.isOnP256(): Boolean = onP256(x.decode(), y.decode())

/**
 * `y² = x³ + ax + b (mod p)` com os parâmetros da P-256, e coordenadas de 32 bytes menores que `p`: sem esta
 * conferência, um ponto de outra curva no `epk` vaza a chave privada aos poucos (ataque de curva inválida). O tamanho
 * vem antes da conta: um `epk` com coordenadas enormes não pode custar CPU.
 */
fun onP256(
    x: ByteArray,
    y: ByteArray,
): Boolean {
    if (x.size != COORDINATE_BYTES || y.size != COORDINATE_BYTES) return false
    val curve = P256.curve
    val p = (curve.field as ECFieldFp).p
    val px = BigInteger(1, x)
    val py = BigInteger(1, y)
    val right =
        px
            .pow(CUBE)
            .add(curve.a.multiply(px))
            .add(curve.b)
            .mod(p)
    return px < p && py < p && py.pow(SQUARE).mod(p) == right
}

private val P256 = Curve.P_256.toECParameterSpec()
private const val COORDINATE_BYTES = 32
private const val SQUARE = 2
private const val CUBE = 3
