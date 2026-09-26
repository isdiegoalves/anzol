package site.webhook.cli

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

/**
 * Quem envia o webhook controla nomes e valores dos campos (inclusive a query de um GET
 * multipart, que o servidor grava em `request`). O multipart remontado não pode deixar esses
 * textos criarem partes ou cabeçalhos novos no corpo entregue ao app local.
 */
@DisplayName("Multipart remontado")
class MultipartTest {
    private fun multipart(
        vararg fields: Pair<String, String>,
        boundary: String = "B",
    ) = CapturedRequest(
        uuid = RequestId("r"),
        method = "POST",
        url = "http://localhost:8084/t",
        seq = 1,
        headers = mapOf("content-type" to listOf("multipart/form-data; boundary=$boundary")),
        request = JsonObject(fields.associate { (name, value) -> name to JsonPrimitive(value) }),
    )

    /** Partes como um parser de multipart as enxerga: cada uma com seus cabeçalhos e valor. */
    private fun parts(rebuilt: RebuiltMultipart): List<Pair<List<String>, String>> {
        val boundary = rebuilt.contentType.substringAfter("boundary=")
        val chunks = rebuilt.body.split("--$boundary")
        assertThat(chunks.last()).isEqualTo("--\r\n")
        return chunks.drop(1).dropLast(1).map { chunk ->
            val (head, value) = chunk.removePrefix("\r\n").split("\r\n\r\n", limit = 2)
            head.split("\r\n") to value.removeSuffix("\r\n")
        }
    }

    @Test
    @DisplayName("Dado um valor com o boundary gravado e cabeçalhos, quando remonta, então há uma parte só, com o valor intacto")
    fun rebuiltMultipart_valorComBoundaryGravado_naoDeveCriarParteNova() {
        val attack = "x\r\n--B\r\nContent-Disposition: form-data; name=\"admin\"\r\n\r\ntrue"

        val rebuilt = multipart("nome" to attack).rebuiltMultipart()!!

        assertThat(parts(rebuilt)).containsExactly(listOf("Content-Disposition: form-data; name=\"nome\"") to attack)
    }

    @Test
    @DisplayName("Dado um nome de campo com aspas e quebra de linha, quando remonta, então escapa como o navegador e não cria cabeçalho")
    fun rebuiltMultipart_nomeComAspasECrlf_deveEscapar() {
        val rebuilt = multipart("a\"; filename=\"x\r\nContent-Type: text/html" to "v").rebuiltMultipart()!!

        assertThat(parts(rebuilt)).containsExactly(
            listOf("Content-Disposition: form-data; name=\"a%22; filename=%22x%0D%0AContent-Type: text/html\"") to "v",
        )
    }

    @Test
    @DisplayName("Dado um boundary sorteado que aparece num valor, quando remonta, então sorteia outro")
    fun rebuiltMultipart_boundaryQueApareceNoValor_deveSortearOutro() {
        val candidates = ArrayDeque(listOf("colide", "livre"))

        val rebuilt = multipart("nome" to "texto que colide aqui").rebuiltMultipart { candidates.removeFirst() }!!

        assertThat(rebuilt.contentType).isEqualTo("multipart/form-data; boundary=livre")
        assertThat(parts(rebuilt)).containsExactly(listOf("Content-Disposition: form-data; name=\"nome\"") to "texto que colide aqui")
    }

    @Test
    @DisplayName("Dado uma mensagem que não é multipart guardado pelo servidor, quando remonta, então não há multipart")
    fun rebuiltMultipart_mensagemComum_deveSerNulo() {
        val json = multipart("a" to "1").copy(headers = mapOf("content-type" to listOf("application/json")), content = "{}")

        assertThat(json.rebuiltMultipart()).isNull()
    }
}
