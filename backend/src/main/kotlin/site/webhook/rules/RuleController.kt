package site.webhook.rules

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import site.webhook.RequestId
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.capture.RequestStore
import site.webhook.capture.Sorting
import site.webhook.http.legacyInput
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import tools.jackson.core.JacksonException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** Quantas mensagens, das mais recentes, o `rules/test` avalia. */
private const val TEST_WINDOW = 500L

data class TestMatch(
    val uuid: RequestId,
    val seq: Long,
)

data class TestMiss(
    val uuid: RequestId,
    val seq: Long,
    val failed: List<String>,
)

/** Resposta do `rules/test`, da mensagem mais nova para a mais antiga. */
data class RuleTestResult(
    val matches: List<TestMatch>,
    val misses: List<TestMiss>,
)

/**
 * Regras de resposta da URL. Token inexistente responde 410 antes de validar; a validação responde
 * sempre 422 em JSON (sem o redirecionamento 302 do formulário do Laravel, que não tem uso numa API nova).
 */
@RestController
@RequestMapping("/token/{tokenId:$UUID_PATTERN}/rules")
class RuleController(
    private val tokens: TokenStore,
    private val rules: RuleStore,
    private val requests: RequestStore,
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

    /** Uma regra (salva ou não) contra as mensagens gravadas mais recentes; `enabled` não conta. */
    @PostMapping("/test")
    fun test(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        val rule =
            when (val parsed = parseRule(request.jsonBody())) {
                is Parsed.Valid -> parsed.value
                is Parsed.Invalid -> return unprocessable(parsed.errors)
            }
        val evaluated =
            requests.page(token, page = 1, perPage = TEST_WINDOW, sorting = Sorting.NEWEST).map { message ->
                Triple(message.uuid, checkNotNull(message.seq), rule.failures(message.toMatchInput()))
            }
        return ResponseEntity.ok(
            RuleTestResult(
                matches = evaluated.filter { it.third.isEmpty() }.map { (uuid, seq) -> TestMatch(uuid, seq) },
                misses = evaluated.filter { it.third.isNotEmpty() }.map { (uuid, seq, failed) -> TestMiss(uuid, seq, failed) },
            ),
        )
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
