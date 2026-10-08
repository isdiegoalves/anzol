package anzol.e2ee.lab

import anzol.e2ee.DecryptionState
import anzol.e2ee.E2eePolicy
import com.fasterxml.jackson.annotation.JsonValue
import com.nimbusds.jose.EncryptionMethod
import com.nimbusds.jose.JWEAlgorithm
import java.util.UUID

/** O que o cenário espera da URL de laboratório: o status, o estado e o motivo da decifra e, quando importa, o `kid`. */
data class Expected(
    val status: Int,
    val state: DecryptionState,
    val reason: String? = null,
    val kid: String? = null,
)

private const val ACCEPTED = 202
private const val BAD_REQUEST = 400
private const val UNAUTHORIZED = 401
private const val SERVER_ERROR = 500

private fun valid(kid: String? = null) = Expected(ACCEPTED, DecryptionState.VALID, kid = kid)

private fun invalid(reason: String) = Expected(BAD_REQUEST, DecryptionState.INVALID, reason)

private val HMAC_FAILED = Expected(UNAUTHORIZED, DecryptionState.INVALID, "hmac_failed")

/**
 * Os cenários do contrato E2EE, com os códigos do cliente de referência (P positivos, N negativos, X vínculos e
 * limites). Cada um diz o que espera com a política da URL ([expect]) e como montar o atributo ([build], com o id da
 * mensagem). [description] é o que o relatório mostra.
 */
enum class LabScenario(
    @get:JsonValue val code: String,
    val description: String,
    private val expect: (E2eePolicy) -> Expected,
    val build: LabVectors.(String) -> Vector,
) {
    P1("P1", "Round trip", { valid() }, { sealed(it) }),
    P2("P2", "Rotation: encrypted to enc-v1 while enc-v2 is active", { valid(kid = "enc-v1") }, { sealed(it, to = oldest) }),
    P3("P3", "Accents and emoji in the data", { valid() }, { sealed(it, claims(it, data = ACCENTS)) }),
    P3B("P3b", "Large and precise numbers in the data", { valid() }, { sealed(it, claims(it, data = BIG_NUMBERS)) }),
    P5(
        "P5",
        "app in a different case from the envelope",
        { if (it.bindings.app.ignoreCase) valid() else invalid("app_mismatch") },
        { sealed(it, claims(it, app = APP.lowercase())) },
    ),
    N1A("N1a", "JWE without a JWS inside (the channel forging with the public key)", { invalid("jws_missing") }, { plainJwe() }),
    N1B("N1b", "JWS from a signer that is not trusted", { invalid("signer_unknown") }, { jwe(signEs256(intruder, claims(it))) }),
    N1C(
        "N1c",
        "JWS with the trusted kid but signed by another key",
        { invalid("signature_invalid") },
        { jwe(signEs256(intruder, claims(it), kid = signer.keyID)) },
    ),
    N2("N2", "Ciphertext of one message in the envelope of another", { invalid("jti_mismatch") }, { sealed(UUID.randomUUID().toString()) }),
    N3("N3", "Plaintext object where the JWE should be (downgrade)", { invalid("downgrade") }, { plaintext() }),
    N4(
        "N4",
        "JWE for a key the URL does not have",
        { Expected(SERVER_ERROR, DecryptionState.UNKNOWN_KID) },
        { jwe(signEs256(signer, claims(it)), to = stranger) },
    ),
    N5A(
        "N5a",
        "alg ECDH-ES+A256KW",
        { invalid("alg_not_allowed") },
        { jwe(signEs256(signer, claims(it)), shape = JweShape(algorithm = JWEAlgorithm.ECDH_ES_A256KW)) },
    ),
    N5B(
        "N5b",
        "enc A128CBC-HS256",
        { invalid("enc_not_allowed") },
        { jwe(signEs256(signer, claims(it)), shape = JweShape(method = EncryptionMethod.A128CBC_HS256)) },
    ),
    N5C("N5c", "zip DEF", { invalid("zip_present") }, { jwe(signEs256(signer, claims(it)), shape = JweShape(zip = true)) }),
    N6("N6", "epk point off the P-256 curve", { invalid("epk_off_curve") }, { offCurve(it) }),
    N7A("N7a", "HMAC computed with another secret", { HMAC_FAILED }, { sealed(it).copy(hmac = Hmac.OTHER_SECRET) }),
    N7B("N7b", "Body changed after the HMAC", { HMAC_FAILED }, { sealed(it).copy(hmac = Hmac.BODY_CHANGED) }),
    N11A("N11a", "JWS with alg none", { invalid("jws_alg_not_allowed") }, { jwe(unsigned(claims(it), signer.keyID)) }),
    N11B("N11b", "JWS with alg HS256", { invalid("jws_alg_not_allowed") }, { jwe(signHs256(claims(it), signer.keyID)) }),
    XA("Xa", "app different from the envelope", { invalid("app_mismatch") }, { sealed(it, claims(it, app = "OTHER-SERVICE")) }),
    XB("Xb", "aud of another recipient", { invalid("aud_mismatch") }, { sealed(it, claims(it, aud = "another-recipient")) }),
    XC("Xc", "JWE header without cty", { invalid("cty_not_jwt") }, { withoutHeader(it, "cty") }),
    XD("Xd", "JWS without data", { invalid("data_missing") }, { sealed(it, claims(it).apply { remove("data") }) }),
    XE(
        "Xe",
        "evt in a different case from the envelope",
        { if (it.bindings.evt.ignoreCase) valid() else invalid("evt_mismatch") },
        { sealed(it, claims(it, evt = EVT.lowercase())) },
    ),
    XF("Xf", "iat older than the window", { invalid("iat_outside_window") }, { sealed(it, claims(it).apply { put("iat", expiredIat()) }) }),
    XG("Xg", "JWE header without kid", { invalid("kid_missing") }, { withoutHeader(it, "kid") }),
    XH("Xh", "JWE larger than 256 KiB", { invalid("too_large") }, { sealed(it, claims(it, data = oversized())) }),
    ;

    /** O esperado com a política de agora: P5 e Xe dependem de o vínculo comparar com ou sem caixa. */
    fun expected(policy: E2eePolicy): Expected = expect(policy)

    companion object {
        /** O cenário do código (sem caixa); `null` quando não há. */
        fun of(code: String): LabScenario? = entries.firstOrNull { it.code.equals(code, ignoreCase = true) }
    }
}
