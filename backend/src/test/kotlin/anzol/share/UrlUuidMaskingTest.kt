package anzol.share

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import tools.jackson.databind.json.JsonMapper
import java.util.Base64

private const val UUID = "0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41"
private const val OTHER = "9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b"
private val mapper = JsonMapper.builder().build()

/** O texto como o link o serializa: um valor de string JSON (o corpo gravado vai assim). */
private fun inJson(text: String): String = mapper.writeValueAsString(mapOf("content" to text))

/** Os 4 grafias cujo base64 não pode sair: com e sem hífens, em minúsculas e maiúsculas. */
private fun spellings(uuid: String): List<String> {
    val compact = uuid.replace("-", "")
    return listOf(uuid, uuid.uppercase(), compact, compact.uppercase())
}

/** O miolo de `base64(k bytes + texto)` que só depende dos bytes de [text]. */
private fun core(
    text: String,
    k: Int,
    url: Boolean,
): String {
    val bytes = ByteArray(k) { 'p'.code.toByte() } + text.toByteArray()
    val encoded = (if (url) Base64.getUrlEncoder() else Base64.getEncoder()).encodeToString(bytes)
    return encoded.substring((8 * k + 5) / 6, 8 * (k + text.length) / 6)
}

@DisplayName("Link só-leitura: o UUID da URL em outras codificações")
class UrlUuidMaskingTest {
    @ParameterizedTest(name = "{0}")
    @ValueSource(
        strings = [
            "\\u0030b7e3c1a\\u002d8f2d-4c55-9a10-3d2f7e6b5a41",
            "0b7e3c1a\\u002D8f2d\\u002d4c55\\u002d9a10\\u002d3d2f7e6b5a41",
            "\\u0030\\u0062\\u0037\\u0065" + "3c1a-8f2d-4c55-9a10-3d2f7e6b5a41",
            "0B7E3C1A%2d8f2d-4c55-9a10-3D2F7E6B5A41",
        ],
    )
    @DisplayName("Dado o UUID com escape JSON \\uXXXX (misturado com cru e %hh), quando mascara, então some")
    fun mask_escapeJson_deveSumir(text: String) {
        val masked = maskUrlUuid(inJson("antes $text depois"), UUID)

        assertThat(masked).isEqualTo(inJson("antes $REDACTED depois"))
    }

    @Test
    @DisplayName("Dado o UUID sem hífens, em minúsculas ou maiúsculas, quando mascara, então some")
    fun mask_semHifens_deveSumir() {
        val compact = UUID.replace("-", "")

        val masked = maskUrlUuid(inJson("a=$compact&b=${compact.uppercase()}"), UUID)

        assertThat(masked).isEqualTo(inJson("a=$REDACTED&b=$REDACTED"))
    }

    @Test
    @DisplayName("Dado base64 e base64url de um texto com o UUID, nas 4 grafias e nos 3 alinhamentos, quando mascara, então o miolo some")
    fun mask_base64_deveTirarOMiolo() {
        spellings(UUID).forEach { spelling ->
            (0..2).forEach { k ->
                listOf(false, true).forEach { url ->
                    val payload = "p".repeat(k) + "https://destino.test/$spelling/volta"
                    val encoded = (if (url) Base64.getUrlEncoder() else Base64.getEncoder()).encodeToString(payload.toByteArray())

                    val masked = maskUrlUuid(inJson("state=$encoded"), UUID)

                    val coreOfUuid = core(spelling, k + "https://destino.test/".length, url)
                    assertThat(masked).describedAs("%s k=%d url=%s", spelling, k, url).doesNotContain(coreOfUuid).contains(REDACTED)
                }
            }
        }
    }

    @Test
    @DisplayName("Dado outro UUID em todas essas formas, quando mascara, então tudo fica como veio")
    fun mask_outroUuid_deveFicar() {
        val compact = OTHER.replace("-", "")
        val blobs =
            spellings(OTHER).flatMap { spelling ->
                (0..2).map { Base64.getEncoder().encodeToString(("p".repeat(it) + spelling).toByteArray()) }
            }
        val text = "$OTHER ${compact.uppercase()} \\u0039f1c2b3a\\u002d4d5e-4f60-8a7b-1c2d3e4f5a6b ${blobs.joinToString(" ")}"

        assertThat(maskUrlUuid(inJson(text), UUID)).isEqualTo(inJson(text))
    }
}
