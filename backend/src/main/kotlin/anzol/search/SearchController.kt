package anzol.search

import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.http.legacyInput
import anzol.rules.Parsed
import anzol.token.TokenStore
import anzol.token.findOrGone
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController
import java.nio.charset.StandardCharsets.UTF_8

/**
 * Busca nas mensagens da URL por texto (também no valor decifrado: a rota já exige o acesso de leitura da URL
 * protegida) e pelo `match` das regras, com a página no formato do `GET /token/{id}/requests`. Como nas regras, token
 * inexistente responde 410 antes de validar e a validação responde sempre 422 em JSON.
 */
@RestController
class SearchController(
    private val tokens: TokenStore,
    private val search: RequestSearch,
) {
    @PostMapping("/token/{tokenId:$UUID_PATTERN}/requests/search")
    fun search(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        return when (val parsed = parseSearch(String(request.legacyInput().body, UTF_8))) {
            is Parsed.Valid -> {
                ResponseEntity.ok(search.search(token, parsed.value, includeDecrypted = true))
            }

            is Parsed.Invalid -> {
                ResponseEntity.unprocessableContent().contentType(MediaType.APPLICATION_JSON).body(parsed.errors)
            }
        }
    }
}
