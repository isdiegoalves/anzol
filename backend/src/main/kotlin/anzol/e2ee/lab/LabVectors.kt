package anzol.e2ee.lab

import anzol.e2ee.E2eeKey
import anzol.e2ee.E2eePolicy
import anzol.rules.bodyMapper
import anzol.share.newShareId
import anzol.signature.Secret
import anzol.signature.SignatureConfig
import anzol.signature.sign
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.gen.ECKeyGenerator
import com.nimbusds.jose.util.Base64URL
import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.ObjectNode
import tools.jackson.databind.node.StringNode
import java.math.BigDecimal
import java.math.BigInteger
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.util.UUID

const val APP = "SERVICO-EXEMPLO"
const val EVT = "PEDIDO_CRIADO"

/** Uma hora a mais que a janela: o `iat` fora dela com folga para relógio e espera. */
private const val OUTSIDE_WINDOW_SECONDS = 3_600L

/** Acima do teto de 256 KiB do JWE, depois do base64 e da cifra. */
private const val OVERSIZED_CHARS = 200 * 1024

val DEFAULT_DATA: JsonNode = bodyMapper.readTree("""{"text":"lab","n":1}""")
val ACCENTS: JsonNode = bodyMapper.readTree("""{"text":"Olá, ação concluída 🎉 — ç ã é ü"}""")

/** Números que um `double` não guarda: o inteiro além de 2^63 e a fração com 34 dígitos. */
val BIG_NUMBERS: JsonNode =
    bodyMapper.createObjectNode().apply {
        put("big", BigInteger("123456789012345678901234567890"))
        put("precise", BigDecimal("0.1000000000000000055511151231257827"))
        put("negative", BigInteger("-9007199254740993"))
    }

/** Um `data` que deixa o JWE acima do teto. */
fun oversized(): JsonNode = bodyMapper.createObjectNode().put("text", "x".repeat(OVERSIZED_CHARS))

/** Como o cenário mexe no HMAC da URL. */
enum class Hmac {
    VALID,
    OTHER_SECRET,
    BODY_CHANGED,
}

/** O atributo montado ([payload]: o JWE em texto, ou o objeto em claro), o `data` que ele carrega e o HMAC pedido. */
data class Vector(
    val payload: JsonNode,
    val data: JsonNode? = null,
    val hmac: Hmac = Hmac.VALID,
)

/** A requisição pronta: o corpo exato e os cabeçalhos (o HMAC da URL e o `Content-Type`). */
data class LabRequest(
    val body: String,
    val headers: Map<String, String>,
    val data: JsonNode?,
)

/**
 * Monta os vetores de uma URL de laboratório com a política, as chaves de cifra e o remetente de teste dela. O intruso
 * e a chave que a URL não tem nascem aqui, a cada geração, e nunca ficam gravados.
 */
class LabVectors(
    private val policy: E2eePolicy,
    keys: List<E2eeKey>,
    val signer: ECKey,
    private val signature: SignatureConfig?,
    private val now: Instant,
) {
    val intruder: ECKey = ECKeyGenerator(Curve.P_256).keyID("intruder-sig-1").generate()
    val stranger: ECKey = ECKeyGenerator(Curve.P_256).keyID("enc-v9").generate().toPublicJWK()
    val newest: ECKey = keys.lastOrNull()?.jwk?.toPublicJWK() ?: stranger
    val oldest: ECKey = keys.firstOrNull()?.jwk?.toPublicJWK() ?: stranger

    fun request(scenario: LabScenario): LabRequest {
        val id = UUID.randomUUID().toString()
        val vector = scenario.build(this, id)
        val body = bodyMapper.writeValueAsString(envelope(id, vector.payload))
        val sent = if (vector.hmac == Hmac.BODY_CHANGED) "$body\n" else body
        return LabRequest(sent, hmacHeaders(body, vector.hmac) + ("Content-Type" to "application/json"), vector.data)
    }

    /** Os claims do laboratório, casando com o envelope de [id]; cada cenário troca o que precisa. */
    fun claims(
        id: String,
        data: JsonNode? = DEFAULT_DATA,
        app: String = APP,
        evt: String = EVT,
        aud: String = policy.audience,
    ): ObjectNode =
        bodyMapper.createObjectNode().apply {
            put("iss", "lab")
            put("aud", aud)
            put("jti", id)
            put("iat", now.epochSecond)
            put("evt", evt)
            put("app", app)
            if (data != null) set("data", data.deepCopy())
        }

    /** O JWE do laboratório: o JWS do remetente de teste com [claims], cifrado para [to]. */
    fun sealed(
        id: String,
        claims: ObjectNode = claims(id),
        to: ECKey = newest,
    ): Vector = Vector(StringNode.valueOf(encrypt(to, signEs256(signer, claims))), claims.get("data"))

    fun jwe(
        content: String,
        to: ECKey = newest,
        shape: JweShape = JweShape(),
    ): Vector = Vector(StringNode.valueOf(encrypt(to, content, shape)))

    fun plainJwe(): Vector = jwe(bodyMapper.writeValueAsString(DEFAULT_DATA))

    fun plaintext(): Vector = Vector(DEFAULT_DATA.deepCopy())

    /** O JWE válido de [id] com o `y` do `epk` trocado num bit: um ponto fora da curva. */
    fun offCurve(id: String): Vector {
        val token = sealed(id).payload.stringValue()
        val header = headerOf(token)
        val epk = header.get("epk") as ObjectNode
        val y = Base64URL(epk.get("y").stringValue()).decode().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
        epk.put("y", Base64URL.encode(y).toString())
        return Vector(StringNode.valueOf(withHeader(token, header)))
    }

    /** O JWE válido de [id] sem o campo [name] no cabeçalho. */
    fun withoutHeader(
        id: String,
        name: String,
    ): Vector {
        val token = sealed(id).payload.stringValue()
        return Vector(StringNode.valueOf(withHeader(token, headerOf(token).apply { remove(name) })))
    }

    fun expiredIat(): Long = now.epochSecond - policy.maxAgeSeconds - OUTSIDE_WINDOW_SECONDS

    /** O envelope em claro: o atributo no caminho da política e o que os vínculos conferem. */
    private fun envelope(
        id: String,
        payload: JsonNode,
    ): ObjectNode =
        bodyMapper.createObjectNode().apply {
            putPath(policy.bindings.jti.path, StringNode.valueOf(id))
            putPath(policy.bindings.evt.path, StringNode.valueOf(EVT))
            putPath(policy.bindings.app.path, StringNode.valueOf(APP))
            putPath(policy.path, payload)
        }

    /** O cabeçalho do HMAC da URL sobre [body]; com [Hmac.OTHER_SECRET], com um segredo que não é o dela. */
    private fun hmacHeaders(
        body: String,
        hmac: Hmac,
    ): Map<String, String> {
        val config = signature ?: return emptyMap()
        val signing = if (hmac == Hmac.OTHER_SECRET) config.copy(secret = Secret(newShareId())) else config
        return signing.sign(body.toByteArray(UTF_8), now)
    }
}
