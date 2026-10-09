package anzol.search

import anzol.capture.CapturedRequest
import anzol.e2ee.DecryptionState
import anzol.rules.Violations
import anzol.rules.given
import anzol.stats.withoutTrailingDetail
import tools.jackson.databind.JsonNode

private const val MAX_REASON = 200
private const val MAX_PATH = 1000
private const val REASON_KEY = "signature_reason"
private const val DECRYPTION_REASON_KEY = "decryption_reason"
private const val PATH_KEY = "schema_path"

/** JSON Pointer (RFC 6901): vazio (a raiz) ou `/…`, com `~` só em `~0` e `~1`. */
private val JSON_POINTER = Regex("(/([^~]|~[01])*)*")

/**
 * `signature_reason`: a mensagem com assinatura que não validou e `reason` igual a [reason] depois de tirar dos dois
 * lados o detalhe entre parênteses do fim, como o `/stats` o mostra em `signature.reasons[].reason`.
 */
fun CapturedRequest.hasSignatureReason(reason: String): Boolean {
    val recorded = signature?.takeUnless { it.valid }?.reason
    return recorded != null && recorded.withoutTrailingDetail() == reason.withoutTrailingDetail()
}

/**
 * `decryption_reason`: a mensagem com decifra `invalid` e `reason` igual a [reason] (`downgrade`, `signature_invalid`…),
 * como o `/stats` o mostra em `decryption.reasons[].reason`.
 */
fun CapturedRequest.hasDecryptionReason(reason: String): Boolean =
    decryption?.takeIf { it.state == DecryptionState.INVALID }?.reason == reason

/** `schema_path`: a mensagem com schema inválido e algum erro no caminho (JSON Pointer) exatamente [path]. */
fun CapturedRequest.hasSchemaPath(path: String): Boolean =
    schema
        ?.takeUnless { it.valid }
        ?.errors
        .orEmpty()
        .any { it.path == path }

private fun String.length(): Int = codePointCount(0, length)

/** `signature_reason`: texto de 1 a [MAX_REASON] caracteres; ausente ou nulo é sem filtro. */
fun Violations.signatureReason(node: JsonNode?): String? {
    val text = node.given()?.let { text(it, REASON_KEY) }
    return when {
        text == null -> null
        text.isEmpty() -> fail(REASON_KEY, "The signature reason field is required.")
        text.length() > MAX_REASON -> fail(REASON_KEY, "The signature reason may not be greater than $MAX_REASON characters.")
        else -> text
    }
}

/** `decryption_reason`: texto de 1 a [MAX_REASON] caracteres; ausente ou nulo é sem filtro. */
fun Violations.decryptionReason(node: JsonNode?): String? {
    val text = node.given()?.let { text(it, DECRYPTION_REASON_KEY) }
    return when {
        text == null -> null
        text.isEmpty() -> fail(DECRYPTION_REASON_KEY, "The decryption reason field is required.")
        text.length() > MAX_REASON -> fail(DECRYPTION_REASON_KEY, "The decryption reason may not be greater than $MAX_REASON characters.")
        else -> text
    }
}

/** `schema_path`: JSON Pointer de até [MAX_PATH] caracteres (`""` é a raiz); ausente ou nulo é sem filtro. */
fun Violations.schemaPath(node: JsonNode?): String? {
    val text = node.given()?.let { text(it, PATH_KEY) }
    return when {
        text == null -> null
        text.length() > MAX_PATH -> fail(PATH_KEY, "The schema path may not be greater than $MAX_PATH characters.")
        !JSON_POINTER.matches(text) -> fail(PATH_KEY, "The schema path must be a JSON Pointer (\"\" or starting with /).")
        else -> text
    }
}
