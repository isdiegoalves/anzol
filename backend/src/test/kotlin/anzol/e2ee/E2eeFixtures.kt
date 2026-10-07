package anzol.e2ee

import com.nimbusds.jose.EncryptionMethod
import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWEAlgorithm
import com.nimbusds.jose.JWEHeader
import com.nimbusds.jose.JWEObject
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.JWSObject
import com.nimbusds.jose.Payload
import com.nimbusds.jose.crypto.ECDHEncrypter
import com.nimbusds.jose.crypto.ECDSASigner
import com.nimbusds.jose.crypto.MACSigner
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.gen.ECKeyGenerator
import com.nimbusds.jose.util.Base64URL
import tools.jackson.databind.json.JsonMapper
import java.time.Instant

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

/** Os claims do laboratório, casando com [envelope] de mesmo [id]. */
fun claims(
    id: String,
    data: Any?,
    iat: Instant = Instant.now(),
): MutableMap<String, Any?> =
    linkedMapOf(
        "iss" to "remetente",
        "aud" to AUDIENCE,
        "jti" to id,
        "iat" to iat.epochSecond,
        "evt" to "PEDIDO_CRIADO",
        "app" to "servico-exemplo",
        "data" to data,
    )

/** JWS compacto com [claims] (JSON), assinado por [signer] com [algorithm] (ES256, ou HS256 com segredo). */
fun sign(
    signer: ECKey,
    claims: Map<String, Any?>,
    algorithm: JWSAlgorithm = JWSAlgorithm.ES256,
): String {
    val header =
        JWSHeader
            .Builder(algorithm)
            .keyID(signer.keyID)
            .type(JOSEObjectType.JWT)
            .build()
    val jws = JWSObject(header, Payload(json(claims)))
    jws.sign(if (algorithm == JWSAlgorithm.HS256) MACSigner(ByteArray(32) { 7 }) else ECDSASigner(signer))
    return jws.serialize()
}

/** JWE compacto (ECDH-ES, A256GCM, `cty=JWT` por padrão) de [content] para a pública de [recipient]. */
fun encrypt(
    recipient: ECKey,
    content: String,
    algorithm: JWEAlgorithm = JWEAlgorithm.ECDH_ES,
    method: EncryptionMethod = EncryptionMethod.A256GCM,
    configure: JWEHeader.Builder.() -> Unit = {},
): String {
    val header =
        JWEHeader
            .Builder(algorithm, method)
            .keyID(recipient.keyID)
            .contentType("JWT")
            .apply(configure)
            .build()
    return JWEObject(header, Payload(content)).also { it.encrypt(ECDHEncrypter(recipient.toECPublicKey())) }.serialize()
}

/** O token compacto com o cabeçalho trocado (os outros pedaços como estão). */
fun withHeader(
    token: String,
    header: Map<String, Any?>,
): String = (listOf(Base64URL.encode(json(header)).toString()) + token.split('.').drop(1)).joinToString(".")

fun header(token: String): MutableMap<String, Any?> {
    @Suppress("UNCHECKED_CAST")
    return mapper.readValue(Base64URL(token.substringBefore('.')).decodeToString(), LinkedHashMap::class.java) as MutableMap<String, Any?>
}

/** O envelope do canal de notificações com [payload] no lugar do evento original. */
fun envelope(
    id: String,
    payload: Any?,
    event: String = "PEDIDO_CRIADO",
    service: String = "SERVICO-EXEMPLO",
): String =
    json(
        linkedMapOf(
            "eventId" to id,
            "tipoEvento" to mapOf("nome" to event),
            "servico" to mapOf("nome" to service),
            "payload" to payload,
        ),
    )
