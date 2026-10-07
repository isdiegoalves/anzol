package anzol.e2ee

import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.gen.ECKeyGenerator
import com.nimbusds.jose.util.Base64URL
import tools.jackson.databind.json.JsonMapper

const val READ_SECRET = "segredo-do-lab"
const val AUDIENCE = "anzol-lab"

private val mapper = JsonMapper.builder().build()

fun ecKey(
    kid: String,
    curve: Curve = Curve.P_256,
): ECKey = ECKeyGenerator(curve).keyID(kid).generate()

/** A pública de [key] com o `y` trocado: um ponto fora da curva. */
fun offCurve(key: ECKey): Map<String, Any?> {
    val y = key.y.decode().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
    return key.toPublicJWK().toJSONObject() + ("y" to Base64URL.encode(y).toString())
}

fun json(value: Any?): String = mapper.writeValueAsString(value)

/** O bloco `e2ee` do laboratório (o evento original dentro do envelope do canal de notificações), com [signers] confiáveis. */
fun policy(
    vararg signers: Any,
    required: Boolean = true,
    appIgnoreCase: Boolean = true,
): Map<String, Any?> =
    linkedMapOf(
        "path" to "$.payload",
        "required" to required,
        "audience" to AUDIENCE,
        "bindings" to
            linkedMapOf(
                "jti" to "$.eventId",
                "evt" to "$.tipoEvento.nome",
                "app" to if (appIgnoreCase) linkedMapOf("path" to "$.servico.nome", "ignore_case" to true) else "$.servico.nome",
            ),
        "trusted_signers" to signers.map { if (it is ECKey) it.toPublicJWK().toJSONObject() else it },
    )
