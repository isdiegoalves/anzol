package site.webhook.signature

import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.util.Base64
import java.util.HexFormat

/**
 * Os cabeçalhos que assinam [body] em [now] (Stripe e Slack assinam o timestamp junto), com as mesmas fórmulas de
 * [verify]: o que sai daqui, a própria URL verifica como válido. É o `sign` do `POST /token/{id}/send`; só a
 * assinatura sai, nunca o segredo.
 */
fun SignatureConfig.sign(
    body: ByteArray,
    now: Instant,
): Map<String, String> =
    when (provider) {
        is SignatureProvider.Stripe -> {
            val timestamp = now.epochSecond
            val signature = hmac(HmacAlgorithm.SHA256, "$timestamp.".toByteArray(UTF_8), body)
            mapOf(STRIPE_HEADER to "t=$timestamp,v1=" + SignatureEncoding.HEX.encode(signature))
        }

        SignatureProvider.GitHub -> {
            signed(GITHUB, body)
        }

        SignatureProvider.Shopify -> {
            signed(SHOPIFY, body)
        }

        is SignatureProvider.Slack -> {
            val timestamp = now.epochSecond
            val signature = hmac(HmacAlgorithm.SHA256, "v0:$timestamp:".toByteArray(UTF_8), body)
            mapOf(SLACK_SIGNATURE to SLACK_VERSION + SignatureEncoding.HEX.encode(signature), SLACK_TIMESTAMP to timestamp.toString())
        }

        is SignatureProvider.Generic -> {
            signed(provider, body)
        }
    }

/** HMAC do corpo, codificado e com o prefixo (GitHub, Shopify e genérico). */
private fun SignatureConfig.signed(
    scheme: SignatureProvider.Generic,
    body: ByteArray,
): Map<String, String> = mapOf(scheme.header to scheme.prefix.orEmpty() + scheme.encoding.encode(hmac(scheme.algorithm, body)))

private fun SignatureEncoding.encode(bytes: ByteArray): String =
    when (this) {
        SignatureEncoding.HEX -> HexFormat.of().formatHex(bytes)
        SignatureEncoding.BASE64 -> Base64.getEncoder().encodeToString(bytes)
    }
