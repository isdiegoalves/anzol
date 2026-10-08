package anzol.e2ee

import anzol.RequestId
import anzol.rules.jsonDocument
import anzol.rules.readJson
import anzol.signature.SignatureResult
import com.fasterxml.jackson.annotation.JsonValue
import com.jayway.jsonpath.JsonPathException
import com.nimbusds.jose.JOSEException
import com.nimbusds.jose.JWEObject
import com.nimbusds.jose.JWSObject
import com.nimbusds.jose.crypto.ECDHDecrypter
import com.nimbusds.jose.crypto.ECDSAVerifier
import com.nimbusds.jose.util.Base64URL
import tools.jackson.databind.JsonNode
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.text.ParseException
import java.time.Instant
import java.util.Locale

/** Teto do JWE (em caracteres), conferido antes de qualquer leitura dele. */
const val MAX_JWE_LENGTH = 256 * 1024

/** O quanto o `iat` pode estar no futuro: relógios de máquinas diferentes. */
const val FUTURE_SKEW_SECONDS = 300L

private const val JWE_PARTS = 5
private const val JWS_PARTS = 3

/** O que a condição `match.decryption` das regras compara. */
enum class DecryptionState(
    @get:JsonValue val id: String,
) {
    VALID("valid"),
    INVALID("invalid"),
    UNKNOWN_KID("unknown_kid"),
    ABSENT("absent"),
}

/**
 * `decryption` da mensagem: [state], o `kid` da chave de cifra ([kid]) e da de assinatura ([signatureKid]) quando
 * lidos, o motivo da falha ([reason], `null` quando válida ou ausente), o `jti` assinado e, numa reentrega, a primeira
 * mensagem com o mesmo `jti` ([duplicateOf]).
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DecryptionResult(
    val state: DecryptionState,
    val kid: String? = null,
    val signatureKid: String? = null,
    val reason: String? = null,
    val jti: String? = null,
    val duplicateOf: RequestId? = null,
)

/** O resultado e, quando válido, o claim `data` (o atributo aberto). */
data class Opening(
    val result: DecryptionResult,
    val data: JsonNode? = null,
)

/** Um passo da abertura: segue com o valor, ou para com o resultado. */
private sealed interface Step<out T> {
    data class Next<T>(
        val value: T,
    ) : Step<T>

    data class Stop(
        val opening: Opening,
    ) : Step<Nothing>
}

private inline fun <T, R> Step<T>.then(next: (T) -> Step<R>): Step<R> =
    when (this) {
        is Step.Next -> next(value)
        is Step.Stop -> this
    }

private fun stop(
    state: DecryptionState,
    reason: String? = null,
    kid: String? = null,
    signatureKid: String? = null,
    jti: String? = null,
): Step<Nothing> = Step.Stop(Opening(DecryptionResult(state, kid, signatureKid, reason, jti)))

private fun invalid(
    reason: String,
    kid: String? = null,
    signatureKid: String? = null,
    jti: String? = null,
): Step<Nothing> = stop(DecryptionState.INVALID, reason, kid, signatureKid, jti)

/** O envelope lido (a forma que o JSONPath percorre) e o atributo, que tem a forma de um JWE compacto. */
private data class Envelope(
    val document: Any,
    val jwe: String,
)

/** O JWE com o cabeçalho já conferido. */
private data class Sealed(
    val envelope: Envelope,
    val kid: String,
)

/** O JWS verificado: quem assinou e os claims. */
private data class Signed(
    val sealed: Sealed,
    val signatureKid: String,
    val claims: JsonNode,
)

/**
 * Abre o atributo de [content] na ordem do contrato do laboratório: a assinatura HMAC da URL ([signature], quando
 * configurada) tem de ser válida; o atributo tem de ser um JWE (com [E2eePolicy.required], senão é downgrade); o
 * cabeçalho passa pela lista permitida antes de decifrar; a chave é a do `kid` do cabeçalho, entre [keys]; dentro, um
 * JWS ES256 de um dos signatários confiáveis; os claims conferem com o envelope e com [now].
 */
fun E2eePolicy.open(
    content: String,
    signature: SignatureResult?,
    keys: List<E2eeKey>,
    now: Instant,
): Opening {
    val step =
        hmacChecked(signature)
            .then { envelope(content) }
            .then(::sealed)
            .then { sealed -> decrypted(sealed, keys) }
            .then { (sealed, payload) -> signed(sealed, payload) }
            .then { signed -> opened(signed, now) }
    return when (step) {
        is Step.Next -> step.value
        is Step.Stop -> step.opening
    }
}

private fun hmacChecked(signature: SignatureResult?): Step<Unit> =
    if (signature == null || signature.valid) Step.Next(Unit) else invalid("hmac_failed")

/** O atributo em [E2eePolicy.path]; o que não tem a forma de um JWE é ausência, ou downgrade se a URL o exige. */
private fun E2eePolicy.envelope(content: String): Step<Envelope> {
    val document = readJson(content)?.let(::jsonDocument)
    val value = document?.let(::attribute)
    return when {
        document == null -> if (required) invalid("body_not_json") else stop(DecryptionState.ABSENT)
        value == null -> if (required) invalid("attribute_missing") else stop(DecryptionState.ABSENT)
        value !is String || value.split('.').size != JWE_PARTS -> if (required) invalid("downgrade") else stop(DecryptionState.ABSENT)
        else -> Step.Next(Envelope(document, value))
    }
}

/** O cabeçalho JWE antes de decifrar: tamanho, `alg`, `enc`, `zip`, `kid`, `cty` e o `epk` na P-256. */
private fun sealed(envelope: Envelope): Step<Sealed> {
    val header = if (envelope.jwe.length > MAX_JWE_LENGTH) null else decodedJson(envelope.jwe.substringBefore('.'))
    val kid =
        header
            ?.get("kid")
            ?.takeIf { it.isString }
            ?.stringValue()
            ?.takeIf { it.isNotBlank() }
    val reason =
        when {
            envelope.jwe.length > MAX_JWE_LENGTH -> "too_large"
            header == null || !header.isObject -> "malformed_jwe"
            header.text("alg") != "ECDH-ES" -> "alg_not_allowed"
            header.text("enc") != "A256GCM" -> "enc_not_allowed"
            header.has("zip") -> "zip_present"
            kid == null -> "kid_missing"
            !header.text("cty").equals("JWT", ignoreCase = true) -> "cty_not_jwt"
            else -> epkProblem(header["epk"])
        }
    return if (reason == null) Step.Next(Sealed(envelope, checkNotNull(kid))) else invalid(reason, kid)
}

/** Decifra com a chave do `kid`; `kid` que a URL não tem é [DecryptionState.UNKNOWN_KID]. */
private fun decrypted(
    sealed: Sealed,
    keys: List<E2eeKey>,
): Step<Pair<Sealed, String>> {
    val key = keys.firstOrNull { it.kid == sealed.kid }
    return if (key == null) stop(DecryptionState.UNKNOWN_KID, kid = sealed.kid) else decryptedWith(sealed, key)
}

private fun decryptedWith(
    sealed: Sealed,
    key: E2eeKey,
): Step<Pair<Sealed, String>> =
    try {
        Step.Next(
            sealed to
                JWEObject
                    .parse(sealed.envelope.jwe)
                    .also { it.decrypt(ECDHDecrypter(key.jwk)) }
                    .payload
                    .toString(),
        )
    } catch (_: ParseException) {
        invalid("malformed_jwe", sealed.kid)
    } catch (_: JOSEException) {
        invalid("decrypt_failed", sealed.kid)
    }

/** O JWS de dentro: ES256 (nunca `none` nem HMAC), `kid` entre os signatários confiáveis e a assinatura certa. */
private fun E2eePolicy.signed(
    sealed: Sealed,
    payload: String,
): Step<Signed> {
    val parts = payload.split('.')
    val header = if (parts.size == JWS_PARTS) decodedJson(parts[0]) else null
    val signatureKid = header?.text("kid")
    val signer = trustedSigners.firstOrNull { it.keyID == signatureKid }
    val claims = if (parts.size == JWS_PARTS) decodedExactJson(parts[1]) else null
    val reason =
        when {
            header == null || !header.isObject -> "jws_missing"
            header.text("alg") != "ES256" -> "jws_alg_not_allowed"
            signer == null -> "signer_unknown"
            !verified(payload, signer) -> "signature_invalid"
            claims == null || !claims.isObject -> "claims_malformed"
            else -> null
        }
    return if (reason == null) {
        Step.Next(Signed(sealed, checkNotNull(signatureKid), checkNotNull(claims)))
    } else {
        invalid(reason, sealed.kid, signatureKid)
    }
}

/** Os claims contra a URL e o envelope: `aud`, `jti`, `evt`, `app`, a janela do `iat` e o `data`. */
private fun E2eePolicy.opened(
    signed: Signed,
    now: Instant,
): Step<Opening> {
    val claims = signed.claims
    val jti = claims.text("jti")
    val iat = claims["iat"]?.takeIf { it.isNumber }?.longValue()
    val document = signed.sealed.envelope.document
    val reason =
        when {
            !claims.audiences().contains(audience) -> "aud_mismatch"
            !bindings.jti.matches(document, jti) -> "jti_mismatch"
            !bindings.evt.matches(document, claims.text("evt")) -> "evt_mismatch"
            !bindings.app.matches(document, claims.text("app")) -> "app_mismatch"
            iat == null -> "iat_missing"
            iat < now.epochSecond - maxAgeSeconds || iat > now.epochSecond + FUTURE_SKEW_SECONDS -> "iat_outside_window"
            claims["data"] == null || claims["data"].isNull -> "data_missing"
            else -> null
        }
    val kid = signed.sealed.kid
    return if (reason == null) {
        Step.Next(Opening(DecryptionResult(DecryptionState.VALID, kid, signed.signatureKid, jti = jti), claims["data"]))
    } else {
        invalid(reason, kid, signed.signatureKid, jti)
    }
}
