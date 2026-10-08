package anzol.e2ee.lab

import anzol.rules.bodyMapper
import com.nimbusds.jose.CompressionAlgorithm
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
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.util.Base64URL
import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.ObjectNode
import java.security.SecureRandom

private const val HS256_SECRET_BYTES = 32
private val random = SecureRandom()

/** Como o gerador monta o JWE: o algoritmo, a cifra, e se comprime. */
data class JweShape(
    val algorithm: JWEAlgorithm = JWEAlgorithm.ECDH_ES,
    val method: EncryptionMethod = EncryptionMethod.A256GCM,
    val zip: Boolean = false,
)

/** JWS compacto ES256 de [claims] (JSON exato, números inclusive), assinado por [signer] com o `kid` [kid]. */
fun signEs256(
    signer: ECKey,
    claims: ObjectNode,
    kid: String = signer.keyID,
): String {
    val header =
        JWSHeader
            .Builder(JWSAlgorithm.ES256)
            .keyID(kid)
            .type(JOSEObjectType.JWT)
            .build()
    return JWSObject(header, Payload(bodyMapper.writeValueAsString(claims))).also { it.sign(ECDSASigner(signer)) }.serialize()
}

/** JWS HS256 com um segredo aleatório: a forma que um JWS ES256 nunca pode ter. */
fun signHs256(
    claims: ObjectNode,
    kid: String,
): String {
    val header =
        JWSHeader
            .Builder(JWSAlgorithm.HS256)
            .keyID(kid)
            .type(JOSEObjectType.JWT)
            .build()
    val secret = ByteArray(HS256_SECRET_BYTES).also(random::nextBytes)
    return JWSObject(header, Payload(bodyMapper.writeValueAsString(claims))).also { it.sign(MACSigner(secret)) }.serialize()
}

/** JWS sem assinatura (`alg=none`), montado à mão como um atacante o montaria. */
fun unsigned(
    claims: ObjectNode,
    kid: String,
): String = part(mapOf("alg" to "none", "kid" to kid, "typ" to "JWT")) + "." + part(claims) + "."

/** JWE compacto de [content] para a pública [recipient], com `cty=JWT`. */
fun encrypt(
    recipient: ECKey,
    content: String,
    shape: JweShape = JweShape(),
): String {
    val header =
        JWEHeader
            .Builder(shape.algorithm, shape.method)
            .keyID(recipient.keyID)
            .contentType("JWT")
            .apply { if (shape.zip) compressionAlgorithm(CompressionAlgorithm.DEF) }
            .build()
    return JWEObject(header, Payload(content)).also { it.encrypt(ECDHEncrypter(recipient.toECPublicKey())) }.serialize()
}

/** O cabeçalho do token compacto, como objeto, para trocar campos. */
fun headerOf(token: String): ObjectNode = bodyMapper.readTree(Base64URL(token.substringBefore('.')).decodeToString()) as ObjectNode

/** O token com o cabeçalho trocado e os outros pedaços como estão (o cabeçalho deixa de bater com a tag). */
fun withHeader(
    token: String,
    header: JsonNode,
): String = (listOf(part(header)) + token.split('.').drop(1)).joinToString(".")

/** Grava [value] em [path] (`$.a.b`), criando os objetos do caminho. */
fun ObjectNode.putPath(
    path: String,
    value: JsonNode,
) {
    val names = path.removePrefix("$.").split('.')
    val parent = names.dropLast(1).fold(this) { node, name -> node.get(name) as? ObjectNode ?: node.putObject(name) }
    parent.set(names.last(), value)
}

private fun part(value: Any): String = Base64URL.encode(bodyMapper.writeValueAsBytes(value)).toString()
