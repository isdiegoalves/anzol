package anzol.rules

import anzol.RequestId
import anzol.TokenId
import anzol.capture.CapturedRequest
import anzol.signature.Secret
import anzol.signature.SignatureConfig
import anzol.signature.SignatureProvider
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Assertions.assertTimeoutPreemptively
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.function.ThrowingSupplier
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.util.UUID

private val TOKEN = TokenId(UUID.fromString("0b7e3c1a-8f2d-4c55-9a10-3d2f7e6b5a41"))

private fun message(body: String): CapturedRequest =
    CapturedRequest(
        uuid = RequestId(UUID.randomUUID()),
        tokenId = TOKEN,
        ip = "10.0.0.1",
        hostname = "localhost",
        method = "POST",
        userAgent = null,
        content = body,
        query = null,
        headers = mapOf("content-type" to listOf("application/json")),
        url = "http://localhost/$TOKEN/pedidos",
        createdAt = LocalDateTime.of(2026, 9, 27, 12, 0),
        updatedAt = LocalDateTime.of(2026, 9, 27, 12, 0),
        seq = 1,
    )

/** Um caminho de JSONPath que visita bilhões de nós sem achar nada: só para no prazo. */
private val SLOW = "{{jsonPath request.body '$" + List(10) { "0" }.joinToString(",", "[", "]").repeat(20) + ".nada'}}"
private val NESTED = "[".repeat(20) + "1" + "]".repeat(20)

@DisplayName("Render do rules/test: a resposta da regra para mensagens gravadas")
class RuleRenderTest {
    @Test
    @DisplayName("Dado um template, quando renderiza, então usa a mensagem, o seq e o now dados e o segredo da URL")
    fun renderFor_template_deveUsarMensagemSeqNowESegredo() {
        val pedido = message("""{"id":7}""")
        val response =
            RuleResponse(
                status = 201,
                headers = mapOf("X-Id" to "{{jsonPath request.body '$.id'}}"),
                body = "{{seq}}|{{now}}|{{request.path}}|{{hmac 'x'}}",
                template = true,
            )
        val signing = SignatureConfig(SignatureProvider.GitHub, Secret("s"))

        val rendered = response.renderFor(listOf(pedido), seq = 99, now = Instant.parse("2026-09-27T12:00:00Z"), signing = signing)

        val answer = rendered.single() as RenderedResponse.Answered
        assertThat(answer.uuid).isEqualTo(pedido.uuid)
        assertThat(answer.status).isEqualTo(201)
        assertThat(answer.headers).containsExactly(java.util.Map.entry("X-Id", "7"))
        assertThat(answer.body).startsWith("99|2026-09-27T12:00:00Z|/pedidos|").hasSize("99|2026-09-27T12:00:00Z|/pedidos|".length + 64)
    }

    @Test
    @DisplayName("Dado uma regra com fault, quando renderiza, então cada entrada traz só a falha")
    fun renderFor_fault_deveTrazerAFalha() {
        val pedidos = listOf(message("a"), message("b"))

        val rendered = RuleResponse(body = "{{nada", fault = Fault.CONNECTION_RESET).renderFor(pedidos, 1, Instant.EPOCH, null)

        assertThat(rendered).containsExactly(
            RenderedResponse.Failed(pedidos[0].uuid, Fault.CONNECTION_RESET),
            RenderedResponse.Failed(pedidos[1].uuid, Fault.CONNECTION_RESET),
        )
    }

    @Test
    @DisplayName("Dado templates que estouram o prazo, quando renderiza três, então o prazo de 1 s é um só e todas saem com timeout")
    fun renderFor_lento_devePararNoPrazoTotal() {
        val pedidos = List(3) { message(NESTED) }
        val response = RuleResponse(body = SLOW, template = true)

        val rendered =
            assertTimeoutPreemptively(Duration.ofMillis(1_800), ThrowingSupplier { response.renderFor(pedidos, 1, Instant.EPOCH, null) })

        assertThat(rendered).containsExactlyElementsOf(pedidos.map { RenderedResponse.Unrendered(it.uuid, RENDER_TIMEOUT) })
    }

    @Test
    @DisplayName("Dado um cabeçalho renderizado acima do teto, quando renderiza, então a entrada sai com too_large e as outras seguem")
    fun renderFor_grandeDemais_deveMarcarTooLarge() {
        val pedido = message("{}")
        val response = RuleResponse(headers = mapOf("X-Grande" to "{{randomValue type='HEX' length=10000}}"), template = true)

        val rendered = response.renderFor(listOf(pedido), 1, Instant.EPOCH, null)

        assertThat(rendered).containsExactly(RenderedResponse.Unrendered(pedido.uuid, RENDER_TOO_LARGE))
    }
}
