package site.webhook.outbound

import org.springframework.stereotype.Component
import site.webhook.RateLimited
import site.webhook.capture.CapturedRequest
import site.webhook.rules.Parsed
import site.webhook.signature.sign
import site.webhook.token.Token
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Clock

/** O que um replay ou send deu: o resultado (200), os erros de validação (422) ou o limite da janela (429). */
sealed interface Dispatch {
    data class Done(
        val result: OutboundResult,
    ) : Dispatch

    data class Invalid(
        val errors: Map<String, List<String>>,
    ) : Dispatch

    data class Limited(
        val refused: RateLimited,
    ) : Dispatch
}

fun RateLimited.outboundMessage(): String = "Too many outbound requests for this URL; try again in $retryAfterSeconds s."

/**
 * Reenvio (replay) de mensagem gravada e envio (send) montado na tela, pelo servidor, com o motor de saída
 * ([OutboundClient]), para a API HTTP e para as ferramentas do MCP. A validação vem antes do limite: acima de 30
 * disparos por minuto na URL, [Dispatch.Limited]. Falha de saída (bloqueado, DNS, conexão, prazo, TLS, URL inválida)
 * não é erro: [Dispatch.Done] com `error` no resultado.
 */
@Component
class OutboundActions(
    private val outbound: OutboundService,
    private val store: OutboundStore,
    private val clock: Clock,
) {
    /** [body] é o JSON do pedido (`{"url", "keep_path"?, "timeout"?, "chaos"?}`). */
    fun replay(
        token: Token,
        message: CapturedRequest,
        body: String,
    ): Dispatch =
        when (val parsed = parseReplay(body, hasBody = message.content.isNotEmpty())) {
            is Parsed.Valid -> replay(token, message, parsed.value)
            is Parsed.Invalid -> Dispatch.Invalid(parsed.errors)
        }

    /** A mensagem gravada sai com o método, os cabeçalhos filtrados e o corpo; com `keep_path`, também o caminho e a query. */
    private fun replay(
        token: Token,
        message: CapturedRequest,
        input: ReplayInput,
    ): Dispatch {
        val body = message.content.toByteArray(UTF_8)
        if (body.size > MAX_OUTBOUND_BODY) {
            return Dispatch.Invalid(mapOf("body" to listOf("The recorded body may not be greater than $MAX_OUTBOUND_BODY bytes.")))
        }
        val url = if (input.keepPath) message.keepPathTarget(input.url, token.uuid) else input.url
        val outgoing = OutboundRequest(message.method, url, message.replayHeaders(), body, input.timeout)
        return limited(token) ?: Dispatch.Done(outbound.dispatch(token, OutboundKind.REPLAY, outgoing, source = message.uuid))
    }

    /** [body] é o JSON do pedido (`{"url", "method"?, "headers"?, "body"?, "sign"?, "timeout"?}`). */
    fun send(
        token: Token,
        body: String,
    ): Dispatch {
        val signature = token.signature
        val input =
            when (val parsed = parseSend(body, hasSignature = signature != null)) {
                is Parsed.Valid -> parsed.value
                is Parsed.Invalid -> return Dispatch.Invalid(parsed.errors)
            }
        val content = input.body.toByteArray(UTF_8)
        val signed = if (input.sign && signature != null) signature.sign(content, clock.instant()) else emptyMap()
        val overLimits = input.headers.overLimits()
        val headers = if (overLimits == null) input.headers else input.headers.withinLimits()
        val outgoing = OutboundRequest(input.method, input.url, sendHeaders(headers, signed), content, input.timeout)
        return if (overLimits != null) {
            oversized(token, outgoing, overLimits)
        } else {
            limited(token) ?: Dispatch.Done(outbound.dispatch(token, OutboundKind.SEND, outgoing))
        }
    }

    /**
     * Cabeçalhos acima dos tetos: se o destino passa pela política, 422 em `headers` e nada sai; se é recusado antes
     * de sair (URL, faixa, DNS), o resultado recusado, gravado com os cabeçalhos já cortados aos tetos.
     */
    private fun oversized(
        token: Token,
        outgoing: OutboundRequest,
        problem: String,
    ): Dispatch {
        val refused = outbound.refusal(outgoing) ?: return Dispatch.Invalid(mapOf("headers" to listOf(problem)))
        return limited(token) ?: Dispatch.Done(outbound.record(token, OutboundKind.SEND, outgoing, refused))
    }

    /** Conta o disparo; o limite quando passa da janela. */
    private fun limited(token: Token): Dispatch? = store.countDispatch(token.uuid)?.let(Dispatch::Limited)
}
