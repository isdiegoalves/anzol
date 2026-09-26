package site.webhook.stats

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.http.legacyInput
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone

private val WINDOW_ERROR = mapOf("window" to listOf("The window must be an integer between 1 and $MAX_STATS_WINDOW."))
private val DIGITS = Regex("[0-9]{1,9}")

/**
 * `window` da query: ausente (ou vazio, como o `after` da listagem) é [MAX_STATS_WINDOW]; fora de 1 a
 * [MAX_STATS_WINDOW], ou que não é inteiro, é nulo.
 */
private fun parseWindow(value: Any?): Int? {
    if (value == null || (value is String && value.isEmpty())) return MAX_STATS_WINDOW
    return (value as? String)?.takeIf { DIGITS.matches(it) }?.toInt()?.takeIf { it in 1..MAX_STATS_WINDOW }
}

/**
 * Resumo das mensagens mais novas da URL (Health e Insights da tela). Como a busca, token inexistente responde 410
 * antes de validar, e a validação responde sempre 422 em JSON. O acesso de URL protegida é do `ReadAccessInterceptor`.
 */
@RestController
class StatsController(
    private val tokens: TokenStore,
    private val statistics: RequestStatistics,
) {
    @GetMapping("/token/{tokenId:$UUID_PATTERN}/stats")
    fun stats(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        val window =
            parseWindow(request.legacyInput().query["window"])
                ?: return ResponseEntity.unprocessableContent().contentType(MediaType.APPLICATION_JSON).body(WINDOW_ERROR)
        return ResponseEntity.ok(statistics.of(token, window))
    }
}
