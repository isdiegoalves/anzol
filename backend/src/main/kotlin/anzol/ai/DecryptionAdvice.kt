package anzol.ai

import anzol.e2ee.DecryptionResult
import anzol.e2ee.DecryptionState
import com.fasterxml.jackson.annotation.JsonValue

/** Quem corrige uma decifra que falhou: o remetente, a configuração da URL, ou ninguém (a mensagem foi alterada). */
enum class DecryptionFixer(
    @get:JsonValue val id: String,
) {
    SENDER("sender"),
    URL_CONFIGURATION("url_configuration"),
    MESSAGE_ALTERED("message_altered"),
}

/** Quem corrige e o que fazer, o mesmo conselho que a tela dá para o motivo. */
data class DecryptionAdvice(
    val whoFixes: List<DecryptionFixer>,
    val text: String,
)

private fun advice(
    vararg whoFixes: DecryptionFixer,
    text: String,
) = DecryptionAdvice(whoFixes.toList(), text)

private val SENDER = DecryptionFixer.SENDER
private val URL = DecryptionFixer.URL_CONFIGURATION
private val ALTERED = DecryptionFixer.MESSAGE_ALTERED

private val EPK = advice(SENDER, text = "The sender must use a valid P-256 ephemeral key (epk) in the JWE header.")
private val CLAIMS =
    advice(
        ALTERED,
        URL,
        text =
            "The encrypted attribute was cut from another envelope, or the binding set on this URL points at the wrong " +
                "field (if only the letter case differs, turn on Ignore case).",
    )

/** Por motivo gravado em `decryption.reason`, e `unknown_kid` pelo estado. */
private val ADVICE: Map<String, DecryptionAdvice> =
    mapOf(
        "hmac_failed" to
            advice(
                SENDER,
                URL,
                text =
                    "Check the HMAC signature first: decryption only runs after it. The HMAC secret set on this URL " +
                        "must be the one the sender signs with, and the body must not change after it is signed.",
            ),
        "body_not_json" to advice(SENDER, text = "The sender must send a JSON body carrying the encrypted attribute."),
        "attribute_missing" to
            advice(
                SENDER,
                URL,
                text =
                    "The sender did not send the attribute, or the encrypted attribute path set on this URL points at " +
                        "another field: check it against a real message.",
            ),
        "downgrade" to
            advice(
                SENDER,
                URL,
                text =
                    "The sender sent the attribute in plaintext, or the encrypted attribute path set on this URL " +
                        "points at another field.",
            ),
        "too_large" to advice(SENDER, text = "The sender must keep the JWE up to 256 KiB."),
        "malformed_jwe" to advice(SENDER, text = "The sender must send a compact JWE (five parts separated by dots)."),
        "alg_not_allowed" to
            advice(SENDER, text = "The sender must encrypt with alg ECDH-ES (direct key agreement), the only one accepted."),
        "enc_not_allowed" to advice(SENDER, text = "The sender must encrypt with enc A256GCM, the only one accepted."),
        "zip_present" to advice(SENDER, text = "The sender must not compress the JWE (no zip in its header)."),
        "kid_missing" to
            advice(SENDER, text = "The sender must put in the JWE header the kid of an encryption key of this URL."),
        "cty_not_jwt" to advice(SENDER, text = "The sender must put cty: JWT in the JWE header."),
        "epk_invalid" to EPK,
        "epk_off_curve" to EPK,
        "decrypt_failed" to
            advice(
                ALTERED,
                URL,
                SENDER,
                text =
                    "The message was altered, the encryption key was deleted and recreated with the same kid, or the " +
                        "sender encrypted to another URL's key with the same kid (every E2EE lab has enc-v1 and " +
                        "enc-v2). Check which JWKS the sender uses.",
            ),
        "jws_missing" to
            advice(
                SENDER,
                text =
                    "The sender encrypted the data directly, without signing: the format requires an ES256 JWS " +
                        "inside the JWE.",
            ),
        "jws_alg_not_allowed" to advice(SENDER, text = "The sender must sign the JWS with ES256."),
        "signer_unknown" to
            advice(
                URL,
                SENDER,
                text =
                    "The message was signed with a key that is not among this URL's trusted signers. If the sender " +
                        "rotated keys, paste the sender's new public signing key in Checks › Decryption › Trusted " +
                        "signers; if you do not recognize this key, treat it as an unknown sender.",
            ),
        "signature_invalid" to
            advice(
                URL,
                SENDER,
                ALTERED,
                text =
                    "The sender rotated keys and kept the kid, the public signing key pasted on this URL is wrong, or " +
                        "the message is a forgery. Paste the sender's current public signing key again.",
            ),
        "claims_malformed" to advice(SENDER, text = "The sender must sign a JSON object of claims in the JWS."),
        "aud_mismatch" to
            advice(
                SENDER,
                URL,
                text = "The sender must send aud with this URL's audience, or the audience set on this URL is not the agreed one.",
            ),
        "jti_mismatch" to CLAIMS,
        "evt_mismatch" to CLAIMS,
        "app_mismatch" to CLAIMS,
        "iat_missing" to advice(SENDER, text = "The sender must put iat (the signing time) in the JWS claims."),
        "iat_outside_window" to
            advice(
                SENDER,
                URL,
                text =
                    "The window goes from the max age set on this URL into the past up to 5 minutes into the future: " +
                        "a late redelivery or a wrong clock at the sender; or raise the max age on this URL.",
            ),
        "data_missing" to advice(SENDER, text = "The sender must put the data claim (the attribute itself) in the JWS."),
        "unknown_kid" to
            advice(
                SENDER,
                URL,
                text =
                    "If this URL deleted that encryption key, the sender still uses the old JWKS: ask the sender to " +
                        "fetch it again. If the key was never this URL's, the sender encrypted to another recipient.",
            ),
    )

/** O conselho da decifra recusada; `null` quando válida, em claro aceito, ou motivo fora do vocabulário. */
fun DecryptionResult.advice(): DecryptionAdvice? =
    when (state) {
        DecryptionState.INVALID -> reason?.let(ADVICE::get)
        DecryptionState.UNKNOWN_KID -> ADVICE["unknown_kid"]
        DecryptionState.VALID, DecryptionState.ABSENT -> null
    }
