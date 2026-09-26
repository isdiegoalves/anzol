package site.webhook.wait

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.http.legacyInput
import site.webhook.rules.Parsed
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import java.nio.charset.StandardCharsets.UTF_8

/**
 * Espera, com prazo, até a URL receber mensagens que casem um `match` das regras de resposta. Como nas
 * regras, token inexistente responde 410 antes de validar e a validação responde sempre 422 em JSON.
 * A chamada válida responde 200, casando ou não.
 */
@RestController
class WaitController(
    private val tokens: TokenStore,
    private val waiter: RequestWaiter,
) {
    @PostMapping("/token/{tokenId:$UUID_PATTERN}/requests/wait")
    fun wait(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        return when (val parsed = parseWait(String(request.legacyInput().body, UTF_8))) {
            is Parsed.Valid -> {
                ResponseEntity.ok(waiter.wait(token, parsed.value))
            }

            is Parsed.Invalid -> {
                ResponseEntity.unprocessableContent().contentType(MediaType.APPLICATION_JSON).body(parsed.errors)
            }
        }
    }
}
