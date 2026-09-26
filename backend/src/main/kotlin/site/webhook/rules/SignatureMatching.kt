package site.webhook.rules

import site.webhook.signature.SignatureResult
import site.webhook.signature.SignatureState

/** `signature: expected valid, got invalid (signature mismatch)`; sem verificação configurada, `got not configured`. */
fun signatureFailure(
    expected: SignatureState,
    actual: SignatureResult?,
): String? {
    val state = actual?.state()
    val got =
        when {
            actual == null -> "not configured"
            actual.reason == null -> actual.state().id
            else -> "${actual.state().id} (${actual.reason})"
        }
    return "signature: expected ${expected.id}, got $got".takeUnless { state == expected }
}
