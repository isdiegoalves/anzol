package site.webhook.signature

import site.webhook.legacy.isPhpInteger
import site.webhook.legacy.phpIntval
import site.webhook.rules.HEADER_NAME
import site.webhook.rules.Parsed
import site.webhook.rules.Violations

private const val MAX_SECRET_LENGTH = 256
private const val DEFAULT_TOLERANCE_SECONDS = 300L
private val TOLERANCE_RANGE = 1L..86_400L
private val PROVIDERS = listOf("stripe", "github", "shopify", "slack", "generic")

/**
 * `signature` como o cliente a mandou: o provedor, já com os padrões, e o segredo, `null` quando ausente
 * ou vazio (mantém o atual, ver [resolve]).
 */
data class SignatureDraft(
    val provider: SignatureProvider,
    val secret: String?,
) {
    /**
     * A configuração a gravar: segredo ausente ou igual ao mascarado mantém o de [current]; `null` quando
     * não há segredo nenhum (422).
     */
    fun resolve(current: SignatureConfig?): SignatureConfig? {
        val kept = current?.secret?.takeIf { secret == null || secret == it.masked() }
        val chosen = kept ?: secret?.let(::Secret)
        return chosen?.let { SignatureConfig(provider, it) }
    }

    override fun toString(): String = "SignatureDraft(provider=$provider)"
}

/** 422 de `signature.secret` quando não há segredo novo nem atual. */
val MISSING_SECRET = mapOf("signature.secret" to listOf("The signature.secret field is required."))

/**
 * Lê `signature` (JSON da API, formulário ou o gravado no Redis) com as mensagens do Laravel, chave
 * `signature.<campo>`. Campos que não se aplicam ao provedor são ignorados.
 */
fun readSignature(value: Any?): Parsed<SignatureDraft> {
    val violations = Violations()
    val fields = value as? Map<*, *> ?: return Parsed.Invalid(mapOf("signature" to listOf("The signature must be an object.")))
    val provider = violations.provider(fields)
    val secret = violations.secret(fields["secret"])
    return violations.result { SignatureDraft(checkNotNull(provider), secret) }
}

private fun Any?.isEmptyValue(): Boolean = this == null || this == ""

private fun Violations.provider(fields: Map<*, *>): SignatureProvider? =
    when (fields["provider"]) {
        null, "" -> fail("signature.provider", "The signature.provider field is required.")
        !in PROVIDERS -> fail("signature.provider", "The selected signature.provider is invalid.")
        "stripe" -> tolerance(fields["toleranceSeconds"])?.let(SignatureProvider::Stripe)
        "github" -> SignatureProvider.GitHub
        "shopify" -> SignatureProvider.Shopify
        "slack" -> tolerance(fields["toleranceSeconds"])?.let(SignatureProvider::Slack)
        else -> generic(fields)
    }

private fun Violations.secret(value: Any?): String? =
    when {
        value.isEmptyValue() -> {
            null
        }

        value !is String -> {
            fail("signature.secret", "The signature.secret must be a string.")
        }

        value.codePointCount(0, value.length) > MAX_SECRET_LENGTH -> {
            fail("signature.secret", "The signature.secret may not be greater than $MAX_SECRET_LENGTH characters.")
        }

        else -> {
            value
        }
    }

private fun Violations.tolerance(value: Any?): Long? =
    when {
        value.isEmptyValue() -> {
            DEFAULT_TOLERANCE_SECONDS
        }

        !isPhpInteger(value) -> {
            fail("signature.toleranceSeconds", "The signature.toleranceSeconds must be an integer.")
        }

        phpIntval(value) !in TOLERANCE_RANGE -> {
            val range = "${TOLERANCE_RANGE.first} and ${TOLERANCE_RANGE.last}"
            fail("signature.toleranceSeconds", "The signature.toleranceSeconds must be between $range.")
        }

        else -> {
            phpIntval(value)
        }
    }

/** Lido antes do segredo: qualquer erro sob `signature` até aqui é do genérico. */
private fun Violations.generic(fields: Map<*, *>): SignatureProvider? {
    val header = header(fields["header"])
    val algorithm = choice(fields["algorithm"], "algorithm", HmacAlgorithm.entries, HmacAlgorithm.SHA256) { it.id }
    val encoding = choice(fields["encoding"], "encoding", SignatureEncoding.entries, SignatureEncoding.HEX) { it.id }
    val prefix = prefix(fields["prefix"])
    return if (hasErrorsUnder("signature")) {
        null
    } else {
        SignatureProvider.Generic(checkNotNull(header), checkNotNull(algorithm), checkNotNull(encoding), prefix)
    }
}

private fun Violations.prefix(value: Any?): String? =
    when {
        value.isEmptyValue() -> null
        value is String -> value
        else -> fail("signature.prefix", "The signature.prefix must be a string.")
    }

private fun Violations.header(value: Any?): String? =
    when {
        value.isEmptyValue() -> fail("signature.header", "The signature.header field is required.")
        value is String && HEADER_NAME.matches(value) -> value
        else -> fail("signature.header", "The signature.header is invalid.")
    }

private fun <T> Violations.choice(
    value: Any?,
    field: String,
    options: List<T>,
    default: T,
    id: (T) -> String,
): T? =
    if (value.isEmptyValue()) {
        default
    } else {
        options.firstOrNull { id(it) == value } ?: fail("signature.$field", "The selected signature.$field is invalid.")
    }
