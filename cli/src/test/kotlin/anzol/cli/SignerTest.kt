package anzol.cli

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import java.time.Instant
import java.util.Base64
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val SECRET = "whsec_teste"
private val BODY = """{"id":"evt_1","valor":"ção"}""".toByteArray(Charsets.UTF_8)
private val NOW: Instant = Instant.ofEpochSecond(1_790_000_000)

/** O HMAC calculado aqui, direto no JCA, independente do [Signer]. */
private fun jca(
    algorithm: String,
    secret: String,
    vararg parts: ByteArray,
): ByteArray {
    val mac = Mac.getInstance(algorithm)
    mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), algorithm))
    parts.forEach(mac::update)
    return mac.doFinal()
}

private fun hex(bytes: ByteArray): String = HexFormat.of().formatHex(bytes)

@DisplayName("Assinatura do send")
class SignerTest {
    @Nested
    @DisplayName("Exemplos públicos dos provedores")
    inner class PublicVectors {
        @Test
        @DisplayName("Dado o exemplo da documentação do GitHub, quando assina, então o header é o da documentação")
        fun headers_exemploDoGitHub_deveBaterComADocumentacao() {
            val signer = Signer(Provider.GitHub, "It's a Secret to Everybody")

            val headers = signer.headers("Hello, World!".toByteArray(Charsets.UTF_8), NOW)

            assertThat(headers)
                .containsExactly(
                    entry("X-Hub-Signature-256", "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"),
                )
        }

        @Test
        @DisplayName("Dado o exemplo da documentação do Slack no mesmo instante, quando assina, então assinatura e timestamp são os dela")
        fun headers_exemploDoSlack_deveBaterComADocumentacao() {
            val body =
                "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V" +
                    "&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=" +
                    "&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN" +
                    "&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c"
            val signer = Signer(Provider.Slack, "8f742231b10e8888abcd99yyyzzz85a5")

            val headers = signer.headers(body.toByteArray(Charsets.UTF_8), Instant.ofEpochSecond(1_531_420_618))

            assertThat(headers).containsExactly(
                entry("X-Slack-Signature", "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503"),
                entry("X-Slack-Request-Timestamp", "1531420618"),
            )
        }
    }

    @Nested
    @DisplayName("Fórmulas conferidas com o JCA")
    inner class Formulas {
        @Test
        @DisplayName("Dado o Stripe, quando assina, então manda t=agora,v1=<hex do HMAC-SHA256 de t.corpo>")
        fun headers_stripe_deveAssinarTimestampPontoCorpo() {
            val expected = hex(jca("HmacSHA256", SECRET, "${NOW.epochSecond}.".toByteArray(), BODY))

            val headers = Signer(Provider.Stripe, SECRET).headers(BODY, NOW)

            assertThat(headers).containsExactly(entry("Stripe-Signature", "t=${NOW.epochSecond},v1=$expected"))
        }

        @Test
        @DisplayName("Dado o Stripe em dois instantes, quando assina, então o t e a assinatura mudam")
        fun headers_stripeEmOutroInstante_deveMudarTimestampEAssinatura() {
            val signer = Signer(Provider.Stripe, SECRET)

            val first = signer.headers(BODY, NOW).getValue("Stripe-Signature")
            val second = signer.headers(BODY, NOW.plusSeconds(1)).getValue("Stripe-Signature")

            assertThat(second).startsWith("t=${NOW.epochSecond + 1},v1=").isNotEqualTo(first)
        }

        @Test
        @DisplayName("Dado o Shopify, quando assina, então manda o base64 do HMAC-SHA256 do corpo")
        fun headers_shopify_deveMandarBase64() {
            val expected = Base64.getEncoder().encodeToString(jca("HmacSHA256", SECRET, BODY))

            val headers = Signer(Provider.Shopify, SECRET).headers(BODY, NOW)

            assertThat(headers).containsExactly(entry("X-Shopify-Hmac-Sha256", expected))
        }

        @Test
        @DisplayName("Dado o corpo vazio, quando assina com o GitHub, então assina os zero bytes")
        fun headers_corpoVazio_deveAssinarZeroBytes() {
            val expected = "sha256=" + hex(jca("HmacSHA256", SECRET))

            val headers = Signer(Provider.GitHub, SECRET).headers(ByteArray(0), NOW)

            assertThat(headers).containsExactly(entry("X-Hub-Signature-256", expected))
        }

        @ParameterizedTest(name = "{0} {1} prefixo ''{2}''")
        @CsvSource(
            "SHA1, HEX, ''",
            "SHA256, HEX, sha256=",
            "SHA512, HEX, ''",
            "SHA1, BASE64, v1=",
            "SHA256, BASE64, ''",
            "SHA512, BASE64, sig=",
        )
        @DisplayName("Dado o genérico, quando assina, então o header leva prefixo e o HMAC do algoritmo na codificação")
        fun headers_generico_deveUsarAlgoritmoCodificacaoEPrefixo(
            algorithm: HmacAlgorithm,
            encoding: SignatureEncoding,
            prefix: String,
        ) {
            val mac = jca(algorithm.jca, SECRET, BODY)
            val encoded = if (encoding == SignatureEncoding.HEX) hex(mac) else Base64.getEncoder().encodeToString(mac)
            val provider = Provider.Generic("X-Assinatura", algorithm, encoding, prefix.ifEmpty { null })

            val headers = Signer(provider, SECRET).headers(BODY, NOW)

            assertThat(headers).containsExactly(entry("X-Assinatura", prefix + encoded))
        }
    }

    @Test
    @DisplayName("Dado um Signer, quando vira texto, então o segredo não aparece")
    fun toString_signer_naoDeveMostrarOSegredo() {
        assertThat(Signer(Provider.Stripe, SECRET).toString()).doesNotContain(SECRET).contains("stripe")
    }

    private fun entry(
        name: String,
        value: String,
    ) = org.assertj.core.api.Assertions
        .entry(name, value)
}
