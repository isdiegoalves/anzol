package site.webhook.token

import site.webhook.http.LegacyInput
import site.webhook.legacy.isPhpInteger
import site.webhook.legacy.phpIntval
import site.webhook.legacy.phpNumericSize
import site.webhook.rules.Parsed
import site.webhook.schema.SchemaConfig
import site.webhook.schema.readSchema
import site.webhook.signature.SignatureDraft
import site.webhook.signature.readSignature

private const val PHP_TRIM = " \t\n\r\u0000\u000B"
private const val READ_SECRET = "read_secret"
private val READ_SECRET_LENGTH = 8..256
private const val MAX_TIMEOUT = 10.0
private const val DEFAULT_STATUS = 200L

/** Regra do `CreateTokenRequest` com a mensagem de `resources/lang/en/validation.php` do Laravel 5.4. */
private enum class Rule(
    val passes: (Any?) -> Boolean,
    val message: (String) -> String,
) {
    STRING({ it is String }, { "The $it must be a string." }),
    INTEGER(::isPhpInteger, { "The $it must be an integer." }),
    MIN_ZERO({ phpNumericSize(it) >= 0 }, { "The $it must be at least 0." }),
    MAX_TEN({ phpNumericSize(it) <= MAX_TIMEOUT }, { "The $it may not be greater than 10." }),
    RETRY_AFTER({ it == null || RetryAfter.parse(it) != null }, { "The $it must be a number of seconds or an HTTP date." }),
    AUTO_CLEANUP({ it == null || AutoCleanup.parse(it) != null }, { "The selected $it is invalid." }),
}

private val RULES =
    linkedMapOf(
        "default_content" to listOf(Rule.STRING),
        "default_content_type" to listOf(Rule.STRING),
        "default_status" to listOf(Rule.INTEGER),
        "timeout" to listOf(Rule.INTEGER, Rule.MIN_ZERO, Rule.MAX_TEN),
        "retry_after" to listOf(Rule.RETRY_AFTER),
        "auto_cleanup" to listOf(Rule.AUTO_CLEANUP),
    )

/**
 * Validação do Laravel 5.4 sobre `$request->all()`: campo ausente ou string em branco não é
 * validado; presente (inclusive `null`) passa por todas as regras, sem parar na primeira.
 */
fun LegacyInput.validateTokenSettings(): Map<String, List<String>> {
    val data = all()
    return RULES
        .filterKeys { it in data && !data[it].isBlankString() }
        .mapValues { (attribute, rules) ->
            rules.filterNot { it.passes(data[attribute]) }.map { it.message(attribute.replace('_', ' ')) }
        }.filterValues { it.isNotEmpty() } + signatureErrors(data["signature"]) + schemaErrors(data["schema"]) + readSecretErrors()
}

/**
 * `read_secret` só no corpo (segredo na query acaba em log de proxy e no histórico do terminal): na query é 422, para
 * que ninguém ache que protegeu a URL sem ter protegido. Texto de 8 a 256 caracteres ou `null`. A mensagem nunca
 * repete o valor.
 */
private fun LegacyInput.readSecretErrors(): Map<String, List<String>> {
    val message =
        when {
            READ_SECRET in query -> "The read secret must be sent in the request body."
            READ_SECRET !in inputBag() -> null
            else -> readSecretValueError(inputBag()[READ_SECRET])
        }
    return if (message == null) emptyMap() else mapOf(READ_SECRET to listOf(message))
}

private fun readSecretValueError(value: Any?): String? =
    when {
        value == null -> null
        value !is String -> "The read secret must be a string."
        value.codePointCount(0, value.length) !in READ_SECRET_LENGTH -> "The read secret must be between 8 and 256 characters."
        else -> null
    }

/** Chamado depois da validação: ausente mantém, `null` remove, texto troca. */
private fun LegacyInput.readSecretChange(): ReadSecretChange {
    val body = inputBag()
    if (READ_SECRET !in body) return ReadSecretChange.Keep
    return when (val value = body[READ_SECRET]) {
        is String -> ReadSecretChange.Set(value)
        else -> ReadSecretChange.Remove
    }
}

/** `signature` nula, ausente ou em branco não é validada (remove a assinatura). */
private fun signatureErrors(value: Any?): Map<String, List<String>> =
    when (val parsed = if (value == null || value.isBlankString()) null else readSignature(value)) {
        is Parsed.Invalid -> parsed.errors
        is Parsed.Valid, null -> emptyMap()
    }

/** `schema` nulo, ausente ou em branco não é validado (desliga a validação). */
private fun schemaErrors(value: Any?): Map<String, List<String>> =
    when (val parsed = if (value == null || value.isBlankString()) null else readSchema(value)) {
        is Parsed.Invalid -> parsed.errors
        is Parsed.Valid, null -> emptyMap()
    }

private fun Any?.isBlankString(): Boolean = this is String && trim { it in PHP_TRIM }.isEmpty()

/** Valores como `Token::createFromRequest` os lê: `$request->get()` (query primeiro) e cast `(int)`. */
fun LegacyInput.toTokenSettings(): TokenSettings =
    TokenSettings(
        defaultContent = (get("default_content") as? String).orEmpty(),
        defaultStatus = get("default_status")?.let(::phpIntval) ?: DEFAULT_STATUS,
        defaultContentType = get("default_content_type") as? String ?: "text/plain",
        timeout = phpIntval(get("timeout")),
        retryAfter = RetryAfter.parse(get("retry_after")),
        autoCleanup = AutoCleanup.parse(get("auto_cleanup")),
        signature = signatureDraft(get("signature")),
        schema = schemaConfig(get("schema")),
        readSecret = readSecretChange(),
    )

/** Chamado depois da validação: o que não é um `signature` válido é ausência. */
private fun signatureDraft(value: Any?): SignatureDraft? =
    when (val parsed = if (value == null || value.isBlankString()) null else readSignature(value)) {
        is Parsed.Valid -> parsed.value
        is Parsed.Invalid, null -> null
    }

/** Chamado depois da validação: o que não é um `schema` válido é ausência. */
private fun schemaConfig(value: Any?): SchemaConfig? =
    when (val parsed = if (value == null || value.isBlankString()) null else readSchema(value)) {
        is Parsed.Valid -> parsed.value
        is Parsed.Invalid, null -> null
    }
