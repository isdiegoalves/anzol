package anzol.outbound

import anzol.RequestId
import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.capture.RequestStore
import anzol.capture.findOrNotFound
import anzol.http.legacyError
import anzol.http.legacyInput
import anzol.token.TokenStore
import anzol.token.findOrGone
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
import java.nio.charset.StandardCharsets.UTF_8

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
    private val actions: OutboundActions,
    private val store: OutboundStore,
) {
    @PostMapping("/request/{requestId:$UUID_PATTERN}/replay")
    fun replay(
        @PathVariable tokenId: TokenId,
        @PathVariable requestId: RequestId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        val message = requests.findOrNotFound(token, requestId)
        return request.respond(actions.replay(token, message, request.bodyText()))
    }

    @PostMapping("/send")
    fun send(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> = request.respond(actions.send(tokens.findOrGone(tokenId), request.bodyText()))

    /** O histórico da URL, o mais novo primeiro (até 50). */
    @GetMapping("/outbound")
    fun history(
        @PathVariable tokenId: TokenId,
    ): List<OutboundResult> = store.history(tokens.findOrGone(tokenId).uuid)

    /** 200 com o resultado, 422 com os erros ou 429 com `Retry-After` quando passa do limite da janela. */
    private fun HttpServletRequest.respond(dispatch: Dispatch): ResponseEntity<Any> =
        when (dispatch) {
            is Dispatch.Done -> {
                ResponseEntity.ok(dispatch.result)
            }

            is Dispatch.Invalid -> {
                ResponseEntity.unprocessableContent().contentType(MediaType.APPLICATION_JSON).body(dispatch.errors)
            }

            is Dispatch.Limited -> {
                val headers = HttpHeaders().apply { set(HttpHeaders.RETRY_AFTER, dispatch.refused.retryAfterSeconds.toString()) }
                legacyError(HttpStatus.TOO_MANY_REQUESTS, dispatch.refused.outboundMessage(), headers)
            }
        }

    private fun HttpServletRequest.bodyText(): String = String(legacyInput().body, UTF_8)
}
