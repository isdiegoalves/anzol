package anzol.rules

import anzol.RequestId
import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.capture.CapturedRequest
import anzol.capture.RequestStore
import anzol.capture.Sorting
import anzol.http.legacyInput
import anzol.token.Token
import anzol.token.TokenStore
import anzol.token.findOrGone
import com.fasterxml.jackson.annotation.JsonInclude
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.core.JacksonException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.time.Clock
import java.time.Instant

/** Quantas mensagens, das mais recentes, o `rules/test` avalia. */
private const val TEST_WINDOW = 500L

data class TestMatch(
    val uuid: RequestId,
    val seq: Long,
)

/** [conditions] é a chave de cada frase de [failed], na mesma ordem (ver [Condition.key]). */
data class TestMiss(
    val uuid: RequestId,
    val seq: Long,
    val failed: List<String>,
    val conditions: List<String>,
)

/**
 * Resposta do `rules/test`, da mensagem mais nova para a mais antiga. [rendered] só com `render=N` (sem ele, a chave
 * nem aparece): a resposta da regra para as N primeiras de [matches].
 */
data class RuleTestResult(
    val matches: List<TestMatch>,
    val misses: List<TestMiss>,
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val rendered: List<RenderedResponse>? = null,
)

/** As mensagens da janela do `rules/test` (as [TEST_WINDOW] mais recentes da URL), da mais nova para a mais antiga. */
fun RequestStore.recent(token: Token): List<CapturedRequest> = page(token, page = 1, perPage = TEST_WINDOW, sorting = Sorting.NEWEST)

/** Pedido de render do `rules/test`: quantas mensagens ([count]) e o instante do `{{now}}`. */
data class RenderRequest(
    val count: Int,
    val now: Instant,
)

/**
 * A regra (salva ou não) contra as [TEST_WINDOW] mensagens gravadas mais recentes; `enabled` não conta. Com [render],
 * renderiza a resposta dela para as primeiras de `matches`, com o `seq` da mensagem mais nova da janela.
 */
fun RequestStore.test(
    token: Token,
    rule: Rule,
    render: RenderRequest? = null,
): RuleTestResult {
    val messages = recent(token)
    val evaluated = messages.map { message -> message to rule.failures(message.toMatchInput()) }
    val matched = evaluated.filter { (_, failed) -> failed.isEmpty() }.map { (message) -> message }
    return RuleTestResult(
        matches = matched.map { TestMatch(it.uuid, checkNotNull(it.seq)) },
        misses =
            evaluated
                .filter { (_, failed) -> failed.isNotEmpty() }
                .map { (message, failed) ->
                    TestMiss(message.uuid, checkNotNull(message.seq), failed.map { it.phrase }, failed.map { it.condition })
                },
        rendered =
            render?.let {
                val seq = messages.firstOrNull()?.seq ?: 0
                rule.response.renderFor(matched.take(it.count), seq, it.now, token.signature)
            },
    )
}

private val INVALID_RENDER = "The render must be an integer between ${RENDER_RANGE.first} and ${RENDER_RANGE.last}."

/** `render` da query: ausente é `null`; senão, inteiro de [RENDER_RANGE] ou o erro na chave `render`. */
private fun renderCount(value: Any?): Parsed<Int?> {
    val count = (value as? String)?.toIntOrNull()
    return when {
        value == null -> Parsed.Valid(null)
        count != null && count in RENDER_RANGE -> Parsed.Valid(count)
        else -> Parsed.Invalid(mapOf("render" to listOf(INVALID_RENDER)))
    }
}

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
    private val clock: Clock,
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

    /**
     * Uma regra (salva ou não) contra as mensagens gravadas mais recentes; `enabled` não conta. Com `?render=N` (1 a 3),
     * a resposta que ela daria às N mais novas que casam. Os erros da regra e do `render` saem juntos no 422.
     */
    @PostMapping("/test")
    fun test(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        val parsed = parseRule(request.jsonBody())
        val render = renderCount(request.legacyInput().query["render"])
        return when {
            parsed is Parsed.Valid && render is Parsed.Valid -> {
                val count = render.value
                ResponseEntity.ok(requests.test(token, parsed.value, count?.let { RenderRequest(it, clock.instant()) }))
            }

            else -> {
                unprocessable(parsed.errorsOrEmpty() + render.errorsOrEmpty())
            }
        }
    }

    /** O corpo cru como JSON; `null` quando não é JSON. */
    private fun HttpServletRequest.jsonBody(): JsonNode? =
        try {
            jsonMapper.readTree(legacyInput().body)
        } catch (_: JacksonException) {
            null
        }

    private fun Parsed<*>.errorsOrEmpty(): Map<String, List<String>> =
        when (this) {
            is Parsed.Valid -> emptyMap()
            is Parsed.Invalid -> errors
        }

    private fun unprocessable(errors: Map<String, List<String>>): ResponseEntity<Any> =
        ResponseEntity.unprocessableContent().contentType(MediaType.APPLICATION_JSON).body(errors)
}
