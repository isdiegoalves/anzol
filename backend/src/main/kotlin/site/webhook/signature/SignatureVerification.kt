package site.webhook.signature

import com.fasterxml.jackson.annotation.JsonValue
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.abs

private const val MISMATCH = "signature mismatch"
private const val MALFORMED = "malformed header"
private val ABSENT_REASON = Regex("header \\S+ absent")

/** Timestamp de Stripe e Slack: só dígitos, curto o bastante para a conta de segundos não estourar. */
private val TIMESTAMP = Regex("[0-9]{1,15}")

internal val GITHUB = SignatureProvider.Generic("X-Hub-Signature-256", HmacAlgorithm.SHA256, SignatureEncoding.HEX, "sha256=")
internal val SHOPIFY = SignatureProvider.Generic("X-Shopify-Hmac-Sha256", HmacAlgorithm.SHA256, SignatureEncoding.BASE64, null)
internal const val STRIPE_HEADER = "Stripe-Signature"
internal const val SLACK_SIGNATURE = "X-Slack-Signature"
internal const val SLACK_TIMESTAMP = "X-Slack-Request-Timestamp"
internal const val SLACK_VERSION = "v0="

/** O que a condição `match.signature` das regras compara. */
enum class SignatureState(
    @get:JsonValue val id: String,
) {
    VALID("valid"),
    INVALID("invalid"),
    ABSENT("absent"),
}

/** `signature` da mensagem: `reason` nulo quando válida, senão uma frase curta em inglês. */
data class SignatureResult(
    val provider: String,
    val valid: Boolean,
    val reason: String?,
) {
    /** Ausente é faltar um cabeçalho que a verificação exige (a assinatura ou, no Slack, o timestamp). */
    fun state(): SignatureState =
        when {
            valid -> SignatureState.VALID
            reason != null && ABSENT_REASON.matches(reason) -> SignatureState.ABSENT
            else -> SignatureState.INVALID
        }
}

/**
 * Verifica a assinatura sobre os bytes crus do corpo, como chegaram (antes de qualquer decodificação).
 * [header] lê um cabeçalho sem caixa. Toda comparação de HMAC é em tempo constante.
 */
fun SignatureConfig.verify(
    header: (String) -> String?,
    body: ByteArray,
    now: Instant,
): SignatureResult {
    val reason =
        when (provider) {
            is SignatureProvider.Stripe -> stripe(provider, header, body, now)
            SignatureProvider.GitHub -> encoded(GITHUB, header, body)
            SignatureProvider.Shopify -> encoded(SHOPIFY, header, body)
            is SignatureProvider.Slack -> slack(provider, header, body, now)
            is SignatureProvider.Generic -> encoded(provider, header, body)
        }
    return SignatureResult(provider.id(), valid = reason == null, reason = reason)
}

private fun absent(name: String) = "header $name absent"

/** Cabeçalho com o HMAC do corpo, codificado e talvez com prefixo (GitHub, Shopify e genérico). */
private fun SignatureConfig.encoded(
    scheme: SignatureProvider.Generic,
    header: (String) -> String?,
    body: ByteArray,
): String? {
    val value = header(scheme.header) ?: return absent(scheme.header)
    val prefix = scheme.prefix.orEmpty()
    val received = value.takeIf { it.startsWith(prefix) }?.let { scheme.encoding.decode(it.substring(prefix.length)) }
    return when {
        received == null -> MALFORMED
        MessageDigest.isEqual(hmac(scheme.algorithm, body), received) -> null
        else -> MISMATCH
    }
}

/** `Stripe-Signature` lido: o `t` e as assinaturas `v1`. */
private class StripeHeader(
    val timestamp: String,
    val candidates: List<ByteArray>,
)

/** `t=…,v1=…[,v1=…]`; `null` sem `t` numérico, sem `v1` ou com `v1` que não é hex. Outros itens (`v0`) são ignorados. */
private fun stripeHeader(value: String): StripeHeader? {
    val pairs = value.split(',').map { it.substringBefore('=').trim() to it.substringAfter('=', "").trim() }
    val timestamp = pairs.firstOrNull { it.first == "t" }?.second?.takeIf { TIMESTAMP.matches(it) }
    val candidates = pairs.filter { it.first == "v1" }.map { SignatureEncoding.HEX.decode(it.second) }
    val wellFormed = timestamp != null && candidates.isNotEmpty() && null !in candidates
    return if (wellFormed) StripeHeader(checkNotNull(timestamp), candidates.filterNotNull()) else null
}

/** `Stripe-Signature: t=…,v1=…` sobre `"{t}.{corpo}"`; qualquer `v1` que confira vale. */
private fun SignatureConfig.stripe(
    stripe: SignatureProvider.Stripe,
    header: (String) -> String?,
    body: ByteArray,
    now: Instant,
): String? {
    val parsed = stripeHeader(header(STRIPE_HEADER) ?: return absent(STRIPE_HEADER))
    val expected = parsed?.let { hmac(HmacAlgorithm.SHA256, "${it.timestamp}.".toByteArray(UTF_8), body) }
    return when {
        parsed == null || expected == null -> MALFORMED
        parsed.candidates.none { MessageDigest.isEqual(expected, it) } -> MISMATCH
        else -> toleranceFailure(parsed.timestamp, stripe.toleranceSeconds, now)
    }
}

/** `X-Slack-Signature: v0=<hex>` sobre `"v0:{X-Slack-Request-Timestamp}:{corpo}"`. */
private fun SignatureConfig.slack(
    slack: SignatureProvider.Slack,
    header: (String) -> String?,
    body: ByteArray,
    now: Instant,
): String? {
    val signature = header(SLACK_SIGNATURE) ?: return absent(SLACK_SIGNATURE)
    val timestamp = header(SLACK_TIMESTAMP)
    val hex = signature.removePrefix(SLACK_VERSION).takeIf { signature.startsWith(SLACK_VERSION) }
    val received = hex?.let { SignatureEncoding.HEX.decode(it) }
    return when {
        timestamp == null -> absent(SLACK_TIMESTAMP)
        received == null || !TIMESTAMP.matches(timestamp) -> MALFORMED
        !MessageDigest.isEqual(hmac(HmacAlgorithm.SHA256, "v0:$timestamp:".toByteArray(UTF_8), body), received) -> MISMATCH
        else -> toleranceFailure(timestamp, slack.toleranceSeconds, now)
    }
}

/** Assinatura certa, mas longe demais de agora (para o passado ou o futuro): replay ou relógio errado. */
private fun toleranceFailure(
    timestamp: String,
    toleranceSeconds: Long,
    now: Instant,
): String? {
    val distance = abs(now.epochSecond - timestamp.toLong())
    return "timestamp outside tolerance ($distance s)".takeIf { distance > toleranceSeconds }
}

internal fun SignatureConfig.hmac(
    algorithm: HmacAlgorithm,
    vararg parts: ByteArray,
): ByteArray {
    val mac = Mac.getInstance(algorithm.jca)
    mac.init(SecretKeySpec(secret.bytes(), algorithm.jca))
    parts.forEach(mac::update)
    return mac.doFinal()
}

/** Os bytes da assinatura recebida; `null` quando o texto não está na codificação (ou está vazio). */
private fun SignatureEncoding.decode(text: String): ByteArray? =
    try {
        when (this) {
            SignatureEncoding.HEX -> HexFormat.of().parseHex(text)
            SignatureEncoding.BASE64 -> Base64.getDecoder().decode(text)
        }.takeIf { it.isNotEmpty() }
    } catch (_: IllegalArgumentException) {
        null
    }
