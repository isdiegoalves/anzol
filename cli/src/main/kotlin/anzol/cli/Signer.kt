package anzol.cli

import java.time.Instant
import java.util.Base64
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val STRIPE_HEADER = "Stripe-Signature"
private const val SLACK_SIGNATURE = "X-Slack-Signature"
private const val SLACK_TIMESTAMP = "X-Slack-Request-Timestamp"

/** Algoritmo do provedor genérico; [id] é o valor de `--algorithm` e [jca] o nome do `Mac`. */
enum class HmacAlgorithm(
    val id: String,
    val jca: String,
) {
    SHA1("sha1", "HmacSHA1"),
    SHA256("sha256", "HmacSHA256"),
    SHA512("sha512", "HmacSHA512"),
}

/** Como o provedor genérico escreve a assinatura no header; [id] é o valor de `--encoding`. */
enum class SignatureEncoding(
    val id: String,
) {
    HEX("hex"),
    BASE64("base64"),
    ;

    fun encode(bytes: ByteArray): String =
        when (this) {
            HEX -> HexFormat.of().formatHex(bytes)
            BASE64 -> Base64.getEncoder().encodeToString(bytes)
        }
}

/**
 * Os cinco provedores da verificação do servidor (`backend/.../signature/SignatureVerification.kt`),
 * com as mesmas fórmulas: o que sai daqui o Anzol verifica como válido.
 */
sealed interface Provider {
    data object Stripe : Provider

    data object GitHub : Provider

    data object Shopify : Provider

    data object Slack : Provider

    data class Generic(
        val header: String,
        val algorithm: HmacAlgorithm,
        val encoding: SignatureEncoding,
        val prefix: String?,
    ) : Provider

    /** O valor de `--provider`. */
    fun id(): String =
        when (this) {
            Stripe -> "stripe"
            GitHub -> "github"
            Shopify -> "shopify"
            Slack -> "slack"
            is Generic -> "generic"
        }
}

private val GITHUB = Provider.Generic("X-Hub-Signature-256", HmacAlgorithm.SHA256, SignatureEncoding.HEX, "sha256=")
private val SHOPIFY = Provider.Generic("X-Shopify-Hmac-Sha256", HmacAlgorithm.SHA256, SignatureEncoding.BASE64, null)

/** Assina o corpo como o [provider]; o segredo não sai em [toString]. */
class Signer(
    private val provider: Provider,
    private val secret: String,
) {
    /** Os headers da assinatura de [body] no instante [now] (Stripe e Slack assinam o timestamp junto). */
    fun headers(
        body: ByteArray,
        now: Instant,
    ): Map<String, String> =
        when (provider) {
            Provider.Stripe -> {
                val t = now.epochSecond
                mapOf(STRIPE_HEADER to "t=$t,v1=" + SignatureEncoding.HEX.encode(hmac(HmacAlgorithm.SHA256, "$t.".toByteArray(), body)))
            }

            Provider.GitHub -> {
                encoded(GITHUB, body)
            }

            Provider.Shopify -> {
                encoded(SHOPIFY, body)
            }

            Provider.Slack -> {
                val ts = now.epochSecond
                val hex = SignatureEncoding.HEX.encode(hmac(HmacAlgorithm.SHA256, "v0:$ts:".toByteArray(), body))
                mapOf(SLACK_SIGNATURE to "v0=$hex", SLACK_TIMESTAMP to ts.toString())
            }

            is Provider.Generic -> {
                encoded(provider, body)
            }
        }

    override fun toString(): String = "Signer(provider=${provider.id()})"

    private fun encoded(
        scheme: Provider.Generic,
        body: ByteArray,
    ): Map<String, String> = mapOf(scheme.header to scheme.prefix.orEmpty() + scheme.encoding.encode(hmac(scheme.algorithm, body)))

    private fun hmac(
        algorithm: HmacAlgorithm,
        vararg parts: ByteArray,
    ): ByteArray {
        val mac = Mac.getInstance(algorithm.jca)
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), algorithm.jca))
        parts.forEach(mac::update)
        return mac.doFinal()
    }
}
