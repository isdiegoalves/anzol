package site.webhook.rules

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import site.webhook.signature.Secret
import site.webhook.signature.SignatureConfig
import site.webhook.signature.SignatureProvider
import java.time.Instant
import java.util.Base64
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val SECRET = "segredo-da-url"
private const val BODY = """{"id":"abc-1","valor":10.5}"""
private val SIGNING = SignatureConfig(SignatureProvider.GitHub, Secret(SECRET))

private fun input(signing: SignatureConfig? = SIGNING) =
    TemplateInput(TemplateRequest("POST", "/", "/", emptyMap(), emptyMap(), BODY), seq = 42, now = Instant.EPOCH, signing = signing)

/** O HMAC calculado à parte, com a JCA, para conferir o helper. */
private fun expected(
    jca: String,
    value: String,
    base64: Boolean = false,
): String {
    val mac = Mac.getInstance(jca).apply { init(SecretKeySpec(SECRET.toByteArray(), jca)) }.doFinal(value.toByteArray())
    return if (base64) Base64.getEncoder().encodeToString(mac) else HexFormat.of().formatHex(mac)
}

@DisplayName("Helper hmac do template: assina com o segredo de assinatura da URL")
class HmacHelperTest {
    @Test
    @DisplayName("Dado o corpo e o segredo da URL, quando renderiza {{hmac request.body}}, então sai o HMAC-SHA256 em hex")
    fun render_padrao_deveAssinarSha256Hex() {
        assertThat(renderTemplate("{{hmac request.body}}", input())).isEqualTo(expected("HmacSHA256", BODY))
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado algoritmo e codificação, quando renderiza, então usa os dois")
    @CsvSource(
        delimiter = '|',
        textBlock = """
        {{hmac request.body algorithm="sha1" encoding="base64"}}   | HmacSHA1   | true
        {{hmac request.body algorithm='sha512'}}                   | HmacSHA512 | false
        {{hmac request.body encoding="hex" algorithm="sha256"}}    | HmacSHA256 | false""",
    )
    fun render_algoritmoECodificacao_deveUsarOsDois(
        template: String,
        jca: String,
        base64: Boolean,
    ) {
        assertThat(renderTemplate(template, input())).isEqualTo(expected(jca, BODY, base64))
    }

    @Test
    @DisplayName("Dado um número ou uma subexpressão, quando renderiza, então assina o texto deles")
    fun render_numeroESubexpressao_deveAssinarOTexto() {
        assertThat(renderTemplate("{{hmac seq}}", input())).isEqualTo(expected("HmacSHA256", "42"))
        assertThat(renderTemplate("{{hmac (jsonPath request.body '$.id')}}", input())).isEqualTo(expected("HmacSHA256", "abc-1"))
    }

    @Test
    @DisplayName("Dado uma URL sem segredo, quando renderiza, então o trecho sai vazio e o resto do template fica")
    fun render_semSegredo_deveSairVazio() {
        assertThat(renderTemplate("a{{hmac request.body}}b", input(signing = null))).isEqualTo("ab")
    }

    @Test
    @DisplayName("Dado algoritmo inválido vindo da requisição, quando renderiza, então o trecho sai vazio")
    fun render_algoritmoInvalidoNaExecucao_deveSairVazio() {
        assertThat(renderTemplate("a{{hmac request.body algorithm=request.method}}b", input())).isEqualTo("ab")
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("Dado algoritmo ou codificação inválidos, quando valida, então recusa com linha e coluna, sem citar segredo")
    @CsvSource(
        delimiter = '|',
        textBlock = """
        x{{hmac request.body algorithm="md5"}}     | hmac algorithm must be one of sha1, sha256, sha512 (line 1, column 3)
        {{hmac request.body encoding="base32"}}    | hmac encoding must be one of hex, base64 (line 1, column 2)
        {{hmac}}                                   | hmac requires 1 parameter(s) (line 1, column 2)""",
    )
    fun templateError_parametroInvalido_deveRecusar(
        template: String,
        reason: String,
    ) {
        assertThat(templateError(template)).isEqualTo(reason)
    }

    @Test
    @DisplayName("Dado algoritmo e codificação válidos, quando valida, então aceita (a validação não tem segredo)")
    fun templateError_valido_deveAceitar() {
        assertThat(templateError("""{{hmac request.body algorithm="sha512" encoding="base64"}}""")).isNull()
    }
}
