package site.webhook.signature

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.io.File

private val SOURCE = File("src/main/kotlin/site/webhook/signature/SignatureVerification.kt")

/**
 * Tempo constante não se vê pelo resultado (as duas comparações dão a mesma resposta): a guarda olha o
 * código. Comparar a assinatura com `contentEquals`, `Arrays.equals` ou texto (`==` em hex) vaza pelo
 * tempo quantos bytes batem.
 */
@DisplayName("Guarda: comparação de HMAC em tempo constante")
class ConstantTimeGuardTest {
    @Test
    @DisplayName("Dado o código da verificação, quando compara assinaturas, então usa só MessageDigest.isEqual")
    fun verificacao_codigo_deveCompararEmTempoConstante() {
        val code = SOURCE.readText()

        assertThat(code).contains("MessageDigest.isEqual(")
        assertThat(code).doesNotContain("contentEquals", "Arrays.equals", "formatHex", ".equals(")
    }
}
