package anzol.e2ee

import anzol.rules.readJson
import com.jayway.jsonpath.JsonPathException
import com.nimbusds.jose.JOSEException
import com.nimbusds.jose.JWSObject
import com.nimbusds.jose.crypto.ECDSAVerifier
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.util.Base64URL
import tools.jackson.core.JacksonException
import tools.jackson.core.JsonParser
import tools.jackson.databind.DeserializationContext
import tools.jackson.databind.DeserializationFeature
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ValueDeserializer
import tools.jackson.databind.json.JsonMapper
import java.text.ParseException
import java.util.Locale

/** `epk` EC P-256 com o ponto na curva; `null` quando está certo. */
internal fun epkProblem(epk: JsonNode?): String? {
    val x = epk?.decoded("x")
    val y = epk?.decoded("y")
    return when {
        epk == null || !epk.isObject || epk.text("kty") != "EC" || epk.text("crv") != "P-256" || x == null || y == null -> "epk_invalid"
        !onP256(x, y) -> "epk_off_curve"
        else -> null
    }
}

internal fun verified(
    jws: String,
    signer: ECKey,
): Boolean =
    try {
        JWSObject.parse(jws).verify(ECDSAVerifier(signer))
    } catch (_: ParseException) {
        false
    } catch (_: JOSEException) {
        false
    }

/** `aud` em texto ou lista de textos. */
internal fun JsonNode.audiences(): List<String> {
    val aud = get("aud") ?: return emptyList()
    return if (aud.isArray) {
        aud.filter { it.isString }.map { it.stringValue() }
    } else {
        listOfNotNull(
            aud.takeIf { it.isString }?.stringValue(),
        )
    }
}

/** O valor do envelope em [Binding.path] (texto, número ou booleano, como texto) é o do claim. */
internal fun Binding.matches(
    document: Any,
    claim: String?,
): Boolean {
    val value =
        try {
            compiled.read<Any?>(document)
        } catch (_: JsonPathException) {
            null
        }
    val expected = (value as? String) ?: (value as? Number)?.toString() ?: (value as? Boolean)?.toString()
    return when {
        expected == null || claim == null -> false
        ignoreCase -> expected.lowercase(Locale.ROOT) == claim.lowercase(Locale.ROOT)
        else -> expected == claim
    }
}

/** Texto do campo; `null` quando ausente ou de outro tipo. */
internal fun JsonNode.text(name: String): String? = get(name)?.takeIf { it.isString }?.stringValue()

internal fun JsonNode.decoded(name: String): ByteArray? = text(name)?.let(::base64Url)

internal fun decodedJson(part: String): JsonNode? = base64Url(part)?.let { readJson(String(it, Charsets.UTF_8)) }

/** Lê o JSON sem arredondar: decimal longo vira `BigDecimal`, não `double` (o `data` decifrado tem de sair como entrou). */
val exactMapper: JsonMapper = JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build()

/** Os claims do JWS, com os números exatos ([exactMapper]); `null` quando não é base64url nem JSON. */
internal fun decodedExactJson(part: String): JsonNode? =
    base64Url(part)?.let {
        try {
            exactMapper.readTree(String(it, Charsets.UTF_8))?.takeUnless { node -> node.isMissingNode }
        } catch (_: JacksonException) {
            null
        }
    }

/** `null` quando não é base64url. */
internal fun base64Url(text: String): ByteArray? = if (text.isEmpty() || !BASE64URL.matches(text)) null else Base64URL(text).decode()

private val BASE64URL = Regex("[A-Za-z0-9_-]+")

internal fun E2eePolicy.attribute(document: Any): Any? =
    try {
        compiledPath.read<Any?>(document)
    } catch (_: JsonPathException) {
        null
    }

/** Lê o `decrypted` gravado com o [exactMapper]: o leitor padrão arredondaria o decimal longo ao abrir a mensagem. */
class ExactJsonDeserializer : ValueDeserializer<JsonNode>() {
    override fun deserialize(
        p: JsonParser,
        ctxt: DeserializationContext,
    ): JsonNode = embedded.readValue(p)
}

/** O [exactMapper] lendo um valor no meio de outro documento: o que vem depois dele não é erro. */
private val embedded =
    exactMapper.readerFor(JsonNode::class.java).without(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
