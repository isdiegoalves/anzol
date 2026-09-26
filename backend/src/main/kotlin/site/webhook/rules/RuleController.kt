package site.webhook.rules

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.http.legacyInput
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import tools.jackson.core.JacksonException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * Regras de resposta da URL. Token inexistente responde 410 antes de validar; a validação responde
 * sempre 422 em JSON (sem o redirecionamento 302 do formulário do Laravel, que não tem uso numa API nova).
 */
@RestController
@RequestMapping("/token/{tokenId:$UUID_PATTERN}/rules")
class RuleController(
    private val tokens: TokenStore,
    private val rules: RuleStore,
    private val jsonMapper: JsonMapper,
) {
    @GetMapping
    fun all(
        @PathVariable tokenId: TokenId,
    ): List<Rule> = rules.find(tokens.findOrGone(tokenId).uuid)

    /** Substitui a lista inteira (é também o import); devolve a lista salva, com os `id`s. */
    @PutMapping
    fun replace(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        return when (val parsed = parseRules(request.jsonBody())) {
            is Parsed.Valid -> ResponseEntity.ok(rules.store(token.uuid, parsed.value))
            is Parsed.Invalid -> unprocessable(parsed.errors)
        }
    }

    /** O corpo cru como JSON; `null` quando não é JSON. */
    private fun HttpServletRequest.jsonBody(): JsonNode? =
        try {
            jsonMapper.readTree(legacyInput().body)
        } catch (_: JacksonException) {
            null
        }

    private fun unprocessable(errors: Map<String, List<String>>): ResponseEntity<Any> =
        ResponseEntity.unprocessableContent().contentType(MediaType.APPLICATION_JSON).body(errors)
}
