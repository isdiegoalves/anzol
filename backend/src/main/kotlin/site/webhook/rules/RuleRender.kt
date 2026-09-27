package site.webhook.rules

import org.springframework.web.server.ResponseStatusException
import site.webhook.RequestId
import site.webhook.capture.CapturedRequest
import site.webhook.signature.SignatureConfig
import java.time.Instant

/** Quantas mensagens, no máximo, o `rules/test?render=N` renderiza. */
val RENDER_RANGE = 1..3

/** `error` da entrada que passou do prazo total do render. */
const val RENDER_TIMEOUT = "timeout"

/** `error` da entrada cuja resposta passou dos tetos de tamanho (a execução responderia 500). */
const val RENDER_TOO_LARGE = "too_large"

/**
 * Uma entrada de `rendered` no `rules/test?render=N`: a resposta que a regra daria à mensagem [uuid] ([Answered]), a
 * falha de rede no lugar dela ([Failed]) ou por que não saiu ([Unrendered]).
 */
sealed interface RenderedResponse {
    val uuid: RequestId

    data class Answered(
        override val uuid: RequestId,
        val status: Int,
        val headers: Map<String, String>,
        val body: String,
    ) : RenderedResponse

    data class Failed(
        override val uuid: RequestId,
        val fault: Fault,
    ) : RenderedResponse

    data class Unrendered(
        override val uuid: RequestId,
        val error: String,
    ) : RenderedResponse
}

/**
 * A resposta desta regra para cada uma das [messages], pelo mesmo motor do webhook (template, helpers e tetos), com
 * [seq] e [now] de agora e o segredo de assinatura da URL ([signing]) para o `{{hmac}}`. Sem atraso nem dribble. Um
 * prazo só ([MAX_RENDER_TIME]) para todas: a entrada que o estoura, e as que viriam depois dele, saem com
 * [RENDER_TIMEOUT].
 */
fun RuleResponse.renderFor(
    messages: List<CapturedRequest>,
    seq: Long,
    now: Instant,
    signing: SignatureConfig?,
): List<RenderedResponse> {
    val until = deadline()
    return messages.map { message ->
        val fault = fault
        when {
            fault != null -> RenderedResponse.Failed(message.uuid, fault)
            System.nanoTime() - until > 0 -> RenderedResponse.Unrendered(message.uuid, RENDER_TIMEOUT)
            else -> render(message, TemplateInput(message.toTemplateRequest(), seq, now, signing), until)
        }
    }
}

private fun RuleResponse.render(
    message: CapturedRequest,
    input: TemplateInput,
    until: Long,
): RenderedResponse =
    try {
        val answer = rendered(input, until)
        RenderedResponse.Answered(message.uuid, answer.status, answer.headers, answer.body)
    } catch (e: ResponseStatusException) {
        RenderedResponse.Unrendered(message.uuid, if (e.reason == TEMPLATE_TOO_SLOW) RENDER_TIMEOUT else RENDER_TOO_LARGE)
    }
