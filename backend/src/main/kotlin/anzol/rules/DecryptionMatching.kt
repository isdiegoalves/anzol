package anzol.rules

import anzol.e2ee.DecryptionResult
import anzol.e2ee.DecryptionState

/** `decryption: expected valid, got unknown_kid`; com o motivo quando há, e `got not configured` sem `e2ee` na URL. */
fun decryptionFailure(
    expected: DecryptionState,
    actual: DecryptionResult?,
): String? {
    val got =
        when {
            actual == null -> "not configured"
            actual.reason == null -> actual.state.id
            else -> "${actual.state.id} (${actual.reason})"
        }
    return "decryption: expected ${expected.id}, got $got".takeUnless { actual?.state == expected }
}
