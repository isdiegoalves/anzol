package site.webhook.signature

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.util.Base64
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val SECRET = "whsec_segredo-de-teste-0123456789"
private val NOW: Instant = Instant.parse("2026-09-26T12:00:00Z")
private val BODY = """{"id":"evt_1","valor":10}""".toByteArray(UTF_8)

/** HMAC calculado direto no JCA, independente do código verificado. */
private fun hmac(
    algorithm: String,
    secret: String,
    vararg parts: ByteArray,
): ByteArray {
    val mac = Mac.getInstance(algorithm)
    mac.init(SecretKeySpec(secret.toByteArray(UTF_8), algorithm))
    parts.forEach(mac::update)
    return mac.doFinal()
}

private fun ByteArray.hex(): String = HexFormat.of().formatHex(this)

private fun ByteArray.base64(): String = Base64.getEncoder().encodeToString(this)

private fun sha256Hex(
    secret: String,
    vararg parts: ByteArray,
) = hmac("HmacSHA256", secret, *parts).hex()

/** Cabeçalhos sem caixa, como no Servlet. */
private fun headers(vararg pairs: Pair<String, String>): (String) -> String? {
    val map = pairs.associate { (name, value) -> name.lowercase() to value }
    return { name -> map[name.lowercase()] }
}

private fun SignatureConfig.check(
    headers: (String) -> String?,
    body: ByteArray = BODY,
    now: Instant = NOW,
): SignatureResult = verify(headers, body, now)

private fun valid(provider: String) = SignatureResult(provider, valid = true, reason = null)

private fun invalid(
    provider: String,
    reason: String,
) = SignatureResult(provider, valid = false, reason = reason)

@DisplayName("Verificação de assinatura HMAC por provedor")
class SignatureVerificationTest {
    @Nested
    @DisplayName("Stripe")
    inner class StripeProvider {
        private val config = SignatureConfig(SignatureProvider.Stripe(toleranceSeconds = 300), Secret(SECRET))
        private val t = NOW.epochSecond.toString()

        private fun signed(
            timestamp: String = t,
            body: ByteArray = BODY,
            secret: String = SECRET,
        ) = sha256Hex(secret, "$timestamp.".toByteArray(UTF_8), body)

        @Test
        @DisplayName("Dado t e v1 assinados com o segredo, quando verifica, então é válida")
        fun verify_assinaturaCorreta_deveSerValida() {
            val result = config.check(headers("Stripe-Signature" to "t=$t,v1=${signed()}"))

            assertThat(result).isEqualTo(valid("stripe"))
        }

        @Test
        @DisplayName("Dado vários v1 e um v0, quando um dos v1 confere, então é válida")
        fun verify_variosV1_deveAceitarQualquerUm() {
            val header = "t=$t,v1=${signed(secret = "outro")},v1=${signed()},v0=abc"

            assertThat(config.check(headers("Stripe-Signature" to header))).isEqualTo(valid("stripe"))
        }

        @Test
        @DisplayName("Dado o corpo alterado depois de assinado, quando verifica, então é signature mismatch")
        fun verify_corpoAlterado_deveSerMismatch() {
            val header = "t=$t,v1=${signed()}"

            val result = config.check(headers("Stripe-Signature" to header), body = BODY + ' '.code.toByte())

            assertThat(result).isEqualTo(invalid("stripe", "signature mismatch"))
        }

        @Test
        @DisplayName("Dado o cabeçalho ausente, quando verifica, então diz qual cabeçalho falta")
        fun verify_cabecalhoAusente_deveDizerOCabecalho() {
            assertThat(config.check(headers())).isEqualTo(invalid("stripe", "header Stripe-Signature absent"))
        }

        @ParameterizedTest(name = "\"{0}\"")
        @DisplayName("Dado um Stripe-Signature fora do formato, quando verifica, então é malformed header")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            v1=abcdef
            t=1790000000
            t=agora,v1=abcdef
            lixo
            t=1790000000,v1=zz""",
        )
        fun verify_cabecalhoMalformado_deveSerMalformed(header: String) {
            assertThat(config.check(headers("Stripe-Signature" to header))).isEqualTo(invalid("stripe", "malformed header"))
        }

        @Test
        @DisplayName("Dado assinatura correta com t 412 s no passado, quando verifica, então é inválida pela tolerância")
        fun verify_timestampAntigo_deveFalharPelaTolerancia() {
            val old = (NOW.epochSecond - 412).toString()

            val result = config.check(headers("Stripe-Signature" to "t=$old,v1=${signed(timestamp = old)}"))

            assertThat(result).isEqualTo(invalid("stripe", "timestamp outside tolerance (412 s)"))
        }

        @ParameterizedTest(name = "t a {0} s de agora, tolerância {1} → válida {2}")
        @DisplayName("Dado t perto do limite da tolerância, quando verifica, então aceita até o limite, no passado e no futuro")
        @CsvSource("-300, 300, true", "300, 300, true", "-301, 300, false", "301, 300, false", "-10, 5, false")
        fun verify_limiteDaTolerancia_deveAceitarAteOLimite(
            offset: Long,
            tolerance: Long,
            expected: Boolean,
        ) {
            val timestamp = (NOW.epochSecond + offset).toString()
            val tolerant = SignatureConfig(SignatureProvider.Stripe(toleranceSeconds = tolerance), Secret(SECRET))

            val result = tolerant.check(headers("Stripe-Signature" to "t=$timestamp,v1=${signed(timestamp = timestamp)}"))

            assertThat(result.valid).isEqualTo(expected)
        }
    }

    @Nested
    @DisplayName("GitHub")
    inner class GitHubProvider {
        private val config = SignatureConfig(SignatureProvider.GitHub, Secret(SECRET))

        @Test
        @DisplayName("Dado o exemplo da documentação do GitHub, quando verifica, então é válida")
        fun verify_exemploDaDocumentacao_deveSerValido() {
            val docs = SignatureConfig(SignatureProvider.GitHub, Secret("It's a Secret to Everybody"))
            val header = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"

            val result = docs.check(headers("X-Hub-Signature-256" to header), body = "Hello, World!".toByteArray(UTF_8))

            assertThat(result).isEqualTo(valid("github"))
        }

        @Test
        @DisplayName("Dado sha256= e o hex do HMAC do corpo (em maiúsculas), quando verifica, então é válida")
        fun verify_hexMaiusculo_deveSerValido() {
            val header = "sha256=" + sha256Hex(SECRET, BODY).uppercase()

            assertThat(config.check(headers("X-Hub-Signature-256" to header))).isEqualTo(valid("github"))
        }

        @Test
        @DisplayName("Dado o segredo errado, quando verifica, então é signature mismatch")
        fun verify_segredoErrado_deveSerMismatch() {
            val header = "sha256=" + sha256Hex("outro", BODY)

            assertThat(config.check(headers("X-Hub-Signature-256" to header))).isEqualTo(invalid("github", "signature mismatch"))
        }

        @Test
        @DisplayName("Dado o cabeçalho ausente, quando verifica, então diz qual cabeçalho falta")
        fun verify_cabecalhoAusente_deveDizerOCabecalho() {
            assertThat(config.check(headers())).isEqualTo(invalid("github", "header X-Hub-Signature-256 absent"))
        }

        @ParameterizedTest(name = "\"{0}\"")
        @DisplayName("Dado um X-Hub-Signature-256 fora do formato, quando verifica, então é malformed header")
        @CsvSource("sha1=abcdef", "abcdef", "sha256=", "sha256=xyz", "sha256=abc")
        fun verify_cabecalhoMalformado_deveSerMalformed(header: String) {
            assertThat(config.check(headers("X-Hub-Signature-256" to header))).isEqualTo(invalid("github", "malformed header"))
        }
    }

    @Nested
    @DisplayName("Shopify")
    inner class ShopifyProvider {
        private val config = SignatureConfig(SignatureProvider.Shopify, Secret(SECRET))

        @Test
        @DisplayName("Dado o base64 do HMAC-SHA256 do corpo, quando verifica, então é válida")
        fun verify_base64Correto_deveSerValido() {
            val header = hmac("HmacSHA256", SECRET, BODY).base64()

            assertThat(config.check(headers("X-Shopify-Hmac-Sha256" to header))).isEqualTo(valid("shopify"))
        }

        @Test
        @DisplayName("Dado o corpo alterado, quando verifica, então é signature mismatch")
        fun verify_corpoAlterado_deveSerMismatch() {
            val header = hmac("HmacSHA256", SECRET, BODY).base64()

            val result = config.check(headers("X-Shopify-Hmac-Sha256" to header), body = "{}".toByteArray())

            assertThat(result).isEqualTo(invalid("shopify", "signature mismatch"))
        }

        @Test
        @DisplayName("Dado o cabeçalho ausente ou fora do base64, quando verifica, então diz o motivo")
        fun verify_ausenteOuMalformado_deveDizerOMotivo() {
            assertThat(config.check(headers())).isEqualTo(invalid("shopify", "header X-Shopify-Hmac-Sha256 absent"))
            assertThat(config.check(headers("X-Shopify-Hmac-Sha256" to "não é base64!"))).isEqualTo(invalid("shopify", "malformed header"))
        }
    }

    @Nested
    @DisplayName("Slack")
    inner class SlackProvider {
        private val config = SignatureConfig(SignatureProvider.Slack(toleranceSeconds = 300), Secret(SECRET))
        private val ts = NOW.epochSecond.toString()

        private fun signed(
            timestamp: String = ts,
            body: ByteArray = BODY,
        ) = "v0=" + sha256Hex(SECRET, "v0:$timestamp:".toByteArray(UTF_8), body)

        @Test
        @DisplayName("Dado o exemplo da documentação do Slack, quando verifica no mesmo instante, então é válida")
        fun verify_exemploDaDocumentacao_deveSerValido() {
            val docs = SignatureConfig(SignatureProvider.Slack(toleranceSeconds = 300), Secret("8f742231b10e8888abcd99yyyzzz85a5"))
            val body =
                "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V" +
                    "&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=" +
                    "&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN" +
                    "&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c"
            val slackHeaders =
                headers(
                    "X-Slack-Request-Timestamp" to "1531420618",
                    "X-Slack-Signature" to "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503",
                )

            val result = docs.check(slackHeaders, body = body.toByteArray(UTF_8), now = Instant.ofEpochSecond(1531420618))

            assertThat(result).isEqualTo(valid("slack"))
        }

        @Test
        @DisplayName("Dado v0 e timestamp assinados, quando verifica, então é válida")
        fun verify_assinaturaCorreta_deveSerValida() {
            val result = config.check(headers("X-Slack-Request-Timestamp" to ts, "X-Slack-Signature" to signed()))

            assertThat(result).isEqualTo(valid("slack"))
        }

        @Test
        @DisplayName("Dado o corpo alterado, quando verifica, então é signature mismatch")
        fun verify_corpoAlterado_deveSerMismatch() {
            val slackHeaders = headers("X-Slack-Request-Timestamp" to ts, "X-Slack-Signature" to signed())

            assertThat(config.check(slackHeaders, body = "x".toByteArray())).isEqualTo(invalid("slack", "signature mismatch"))
        }

        @Test
        @DisplayName("Dado a assinatura ou o timestamp ausente, quando verifica, então diz qual cabeçalho falta")
        fun verify_cabecalhoAusente_deveDizerOCabecalho() {
            assertThat(config.check(headers("X-Slack-Request-Timestamp" to ts)))
                .isEqualTo(invalid("slack", "header X-Slack-Signature absent"))
            assertThat(config.check(headers("X-Slack-Signature" to signed())))
                .isEqualTo(invalid("slack", "header X-Slack-Request-Timestamp absent"))
        }

        @ParameterizedTest(name = "timestamp \"{0}\", assinatura \"{1}\"")
        @DisplayName("Dado timestamp não numérico ou assinatura sem v0=, quando verifica, então é malformed header")
        @CsvSource("ontem, v0=abcd", "1790000000, v1=abcd", "1790000000, v0=xyz")
        fun verify_cabecalhoMalformado_deveSerMalformed(
            timestamp: String,
            signature: String,
        ) {
            val slackHeaders = headers("X-Slack-Request-Timestamp" to timestamp, "X-Slack-Signature" to signature)

            assertThat(config.check(slackHeaders)).isEqualTo(invalid("slack", "malformed header"))
        }

        @Test
        @DisplayName("Dado assinatura correta com timestamp 412 s no futuro, quando verifica, então é inválida pela tolerância")
        fun verify_timestampFora_deveFalharPelaTolerancia() {
            val future = (NOW.epochSecond + 412).toString()
            val slackHeaders = headers("X-Slack-Request-Timestamp" to future, "X-Slack-Signature" to signed(timestamp = future))

            assertThat(config.check(slackHeaders)).isEqualTo(invalid("slack", "timestamp outside tolerance (412 s)"))
        }
    }

    @Nested
    @DisplayName("Genérico")
    inner class GenericProvider {
        private fun generic(
            algorithm: HmacAlgorithm,
            encoding: SignatureEncoding,
            prefix: String?,
        ) = SignatureConfig(SignatureProvider.Generic("X-Assinatura", algorithm, encoding, prefix), Secret(SECRET))

        @ParameterizedTest(name = "{0} em {1} com prefixo \"{2}\"")
        @DisplayName("Dado cada algoritmo, encoding e prefixo, quando o cabeçalho traz o HMAC do corpo, então é válida")
        @CsvSource(
            nullValues = ["null"],
            value = [
                "SHA1, HEX, null, HmacSHA1", "SHA256, HEX, null, HmacSHA256", "SHA512, HEX, null, HmacSHA512",
                "SHA1, BASE64, null, HmacSHA1", "SHA256, BASE64, sha256=, HmacSHA256", "SHA512, BASE64, hmac , HmacSHA512",
                "SHA256, HEX, v1:, HmacSHA256",
            ],
        )
        fun verify_combinacoes_deveSerValida(
            algorithm: HmacAlgorithm,
            encoding: SignatureEncoding,
            prefix: String?,
            jca: String,
        ) {
            val digest = hmac(jca, SECRET, BODY)
            val encoded = if (encoding == SignatureEncoding.HEX) digest.hex() else digest.base64()

            val result = generic(algorithm, encoding, prefix).check(headers("x-assinatura" to prefix.orEmpty() + encoded))

            assertThat(result).isEqualTo(valid("generic"))
        }

        @Test
        @DisplayName("Dado o HMAC de outro algoritmo, quando verifica, então é signature mismatch")
        fun verify_outroAlgoritmo_deveSerMismatch() {
            val header = hmac("HmacSHA1", SECRET, BODY).hex()

            val result = generic(HmacAlgorithm.SHA256, SignatureEncoding.HEX, null).check(headers("X-Assinatura" to header))

            assertThat(result).isEqualTo(invalid("generic", "signature mismatch"))
        }

        @Test
        @DisplayName("Dado o prefixo que falta ou o cabeçalho ausente, quando verifica, então diz o motivo com o nome configurado")
        fun verify_semPrefixoOuAusente_deveDizerOMotivo() {
            val config = generic(HmacAlgorithm.SHA256, SignatureEncoding.HEX, "sha256=")

            assertThat(config.check(headers("X-Assinatura" to sha256Hex(SECRET, BODY)))).isEqualTo(invalid("generic", "malformed header"))
            assertThat(config.check(headers())).isEqualTo(invalid("generic", "header X-Assinatura absent"))
        }
    }

    @Nested
    @DisplayName("Bytes crus")
    inner class RawBytes {
        @Test
        @DisplayName("Dado um corpo com UTF-8 inválido, quando verifica sobre os bytes crus, então é válida (e sobre o texto, não)")
        fun verify_utf8Invalido_deveUsarOsBytesCrus() {
            val raw = byteArrayOf(0x7B, 0xC3.toByte(), 0x28, 0xFF.toByte(), 0x7D)
            val config = SignatureConfig(SignatureProvider.GitHub, Secret(SECRET))
            val header = headers("X-Hub-Signature-256" to "sha256=" + sha256Hex(SECRET, raw))

            assertThat(config.check(header, body = raw)).isEqualTo(valid("github"))
            assertThat(config.check(header, body = String(raw, UTF_8).toByteArray(UTF_8)).reason).isEqualTo("signature mismatch")
        }
    }

    @Nested
    @DisplayName("Estado para as regras")
    inner class State {
        @ParameterizedTest(name = "valid={0}, reason={1} → {2}")
        @DisplayName("Dado o resultado gravado, quando as regras o leem, então ausente é o de cabeçalho ausente")
        @CsvSource(
            delimiter = '|',
            nullValues = ["null"],
            textBlock = """
            true  | null                                | VALID
            false | signature mismatch                  | INVALID
            false | malformed header                    | INVALID
            false | timestamp outside tolerance (412 s) | INVALID
            false | header X-Hub-Signature-256 absent   | ABSENT
            false | header X-Slack-Request-Timestamp absent | ABSENT""",
        )
        fun state_resultadoGravado_deveClassificar(
            valid: Boolean,
            reason: String?,
            expected: SignatureState,
        ) {
            assertThat(SignatureResult("github", valid, reason).state()).isEqualTo(expected)
        }
    }

    @Nested
    @DisplayName("Segredo")
    inner class SecretMasking {
        @ParameterizedTest(name = "\"{0}\" → \"{1}\"")
        @DisplayName("Dado um segredo, quando é mascarado, então mostra só os 4 últimos (e nunca mais que a metade)")
        @CsvSource("whsec_abcdefgh1234, ••••1234", "12345678, ••••5678", "abcdef, ••••def", "a, ••••")
        fun masked_segredo_deveMostrarSoOFim(
            secret: String,
            expected: String,
        ) {
            assertThat(Secret(secret).masked()).isEqualTo(expected)
            assertThat(Secret(secret).toString()).isEqualTo(expected)
        }
    }
}
