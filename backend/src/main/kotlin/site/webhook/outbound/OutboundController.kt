package site.webhook.outbound

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import site.webhook.RequestId
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.capture.CapturedRequest
import site.webhook.capture.RequestStore
import site.webhook.http.legacyError
import site.webhook.http.legacyInput
import site.webhook.rules.Parsed
import site.webhook.signature.sign
import site.webhook.token.Token
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Clock

/**
 * Reenvio (replay) de mensagem gravada e envio (send) montado na tela, pelo servidor, com o motor de saída
 * ([OutboundClient]). Como na busca: token inexistente responde 410 e mensagem inexistente 404 antes de validar; a
 * validação responde 422 em JSON; acima de 30 disparos por minuto na URL, 429 com `Retry-After`. Falha de saída
 * (bloqueado, DNS, conexão, prazo, TLS, URL inválida) não é erro da API: 200 com `error` no resultado.
 */
@RestController
@RequestMapping("/token/{tokenId:$UUID_PATTERN}")
class OutboundController(
    private val tokens: TokenStore,
    private val requests: RequestStore,
    private val outbound: OutboundService,
    private val store: OutboundStore,
    private val clock: Clock,
) {
    @PostMapping("/request/{requestId:$UUID_PATTERN}/replay")
    fun replay(
        @PathVariable tokenId: TokenId,
        @PathVariable requestId: RequestId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        val message = requests.find(token, requestId) ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Request not found")
        return when (val parsed = parseReplay(request.bodyText())) {
            is Parsed.Valid -> request.replay(token, message, parsed.value)
            is Parsed.Invalid -> invalid(parsed.errors)
        }
    }

    /** A mensagem gravada sai com o método, os cabeçalhos filtrados e o corpo; com `keep_path`, também o caminho e a query. */
    private fun HttpServletRequest.replay(
        token: Token,
        message: CapturedRequest,
        input: ReplayInput,
    ): ResponseEntity<Any> {
        val body = message.content.toByteArray(UTF_8)
        if (body.size > MAX_OUTBOUND_BODY) {
            return invalid(mapOf("body" to listOf("The recorded body may not be greater than $MAX_OUTBOUND_BODY bytes.")))
        }
        val url = if (input.keepPath) message.keepPathTarget(input.url, token.uuid) else input.url
        val outgoing = OutboundRequest(message.method, url, message.replayHeaders(), body, input.timeout)
        return limited(token) ?: ResponseEntity.ok(outbound.dispatch(token, OutboundKind.REPLAY, outgoing, source = message.uuid))
    }

    @PostMapping("/send")
    fun send(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        val signature = token.signature
        val input =
            when (val parsed = parseSend(request.bodyText(), hasSignature = signature != null)) {
                is Parsed.Valid -> parsed.value
                is Parsed.Invalid -> return invalid(parsed.errors)
            }
        val body = input.body.toByteArray(UTF_8)
        val signed = if (input.sign && signature != null) signature.sign(body, clock.instant()) else emptyMap()
        val outgoing = OutboundRequest(input.method, input.url, sendHeaders(input.headers, signed), body, input.timeout)
        return request.limited(token) ?: ResponseEntity.ok(outbound.dispatch(token, OutboundKind.SEND, outgoing))
    }

    /** O histórico da URL, o mais novo primeiro (até 50). */
    @GetMapping("/outbound")
    fun history(
        @PathVariable tokenId: TokenId,
    ): List<OutboundResult> = store.history(tokens.findOrGone(tokenId).uuid)

    /** Conta o disparo; 429 com `Retry-After` quando passa do limite da janela. */
    private fun HttpServletRequest.limited(token: Token): ResponseEntity<Any>? {
        val refused = store.countDispatch(token.uuid) ?: return null
        val headers = HttpHeaders().apply { set(HttpHeaders.RETRY_AFTER, refused.retryAfterSeconds.toString()) }
        val message = "Too many outbound requests for this URL; try again in ${refused.retryAfterSeconds} s."
        return legacyError(HttpStatus.TOO_MANY_REQUESTS, message, headers)
    }

    private fun HttpServletRequest.bodyText(): String = String(legacyInput().body, UTF_8)

    private fun invalid(errors: Map<String, List<String>>): ResponseEntity<Any> =
        ResponseEntity.unprocessableContent().contentType(MediaType.APPLICATION_JSON).body(errors)
}
