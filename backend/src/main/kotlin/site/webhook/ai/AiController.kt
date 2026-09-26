package site.webhook.ai

import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController
import site.webhook.RequestId
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.capture.RequestStore
import site.webhook.capture.findOrNotFound
import site.webhook.http.legacyInput
import site.webhook.rules.Parsed
import site.webhook.rules.Rule
import site.webhook.rules.RuleStore
import site.webhook.token.Token
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import java.nio.charset.StandardCharsets.UTF_8

/** Resposta do `rules/suggest`: a regra validada (não gravada), a explicação do modelo e quantas tentativas levou. */
data class SuggestResponse(
    val rule: Rule,
    val explanation: String,
    val attempts: Int,
)

/** Resposta do `explain`: o texto do modelo (markdown simples) e os fatos que o backend deu a ele. */
data class ExplainResponse(
    val explanation: String,
    val facts: ExplainFacts,
)

/** Erro das rotas de IA que não tem forma na API antiga: 503, 502, 429 e o 422 sem regra válida. */
data class AiError(
    val error: String,
)

/** O 422 do suggest quando nenhuma tentativa deu regra válida: os erros do parser na última. */
data class NoRuleError(
    val error: String,
    val errors: Map<String, List<String>>,
    val attempts: Int,
)

/**
 * Rotas de IA com o LLM local. Desligada (`webhook.ai.enabled`), 503 antes de tudo; depois, como nas outras rotas
 * do token: 410 sem a URL, 422 de validação, 404 sem a mensagem. Só então os limites (429) e a chamada, que falhando
 * dá 502. Nada é gravado. O log leva só a URL, a rota e o resultado: nem prompt, nem mensagem, nem resposta.
 */
@RestController
class AiController(
    private val tokens: TokenStore,
    private val requests: RequestStore,
    private val rules: RuleStore,
    private val limits: AiLimits,
    private val suggester: RuleSuggester?,
    private val explainer: Explainer?,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @PostMapping("/token/{tokenId:$UUID_PATTERN}/rules/suggest")
    fun suggest(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val suggester = suggester ?: return notConfigured()
        val token = tokens.findOrGone(tokenId)
        return when (val parsed = parseSuggest(request.bodyText())) {
            is Parsed.Valid -> suggest(suggester, token, parsed.value)
            is Parsed.Invalid -> unprocessable(parsed.errors)
        }
    }

    private fun suggest(
        suggester: RuleSuggester,
        token: Token,
        input: SuggestInput,
    ): ResponseEntity<Any> {
        val tokenId = token.uuid
        val example = input.requestId?.let { requests.findOrNotFound(token, it) }
        return limited(tokenId) {
            when (val suggestion = suggester.suggest(input, example)) {
                is Suggestion.Suggested -> {
                    log.info("[AI] {} suggest ok ({} attempts)", tokenId, suggestion.attempts)
                    ResponseEntity.ok(SuggestResponse(suggestion.rule, suggestion.explanation, suggestion.attempts))
                }

                is Suggestion.NoValidRule -> {
                    log.info("[AI] {} suggest invalid ({} attempts)", tokenId, suggestion.attempts)
                    val message = "The model did not produce a valid rule in ${suggestion.attempts} attempts."
                    json(HttpStatus.UNPROCESSABLE_CONTENT, NoRuleError(message, suggestion.errors, suggestion.attempts))
                }

                is Suggestion.Failed -> {
                    modelFailed(tokenId, "suggest", suggestion.reason)
                }
            }
        }
    }

    @PostMapping("/token/{tokenId:$UUID_PATTERN}/request/{requestId:$UUID_PATTERN}/explain")
    fun explain(
        @PathVariable tokenId: TokenId,
        @PathVariable requestId: RequestId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val explainer = explainer ?: return notConfigured()
        val token = tokens.findOrGone(tokenId)
        val message = requests.findOrNotFound(token, requestId)
        return when (val parsed = parseExplain(request.bodyText())) {
            is Parsed.Valid -> explain(explainer, explainFacts(token, message, rules.find(tokenId)), parsed.value, tokenId)
            is Parsed.Invalid -> unprocessable(parsed.errors)
        }
    }

    private fun explain(
        explainer: Explainer,
        facts: ExplainFacts,
        lang: String,
        tokenId: TokenId,
    ): ResponseEntity<Any> =
        limited(tokenId) {
            when (val explanation = explainer.explain(facts, lang)) {
                is Explanation.Explained -> {
                    log.info("[AI] {} explain ok", tokenId)
                    ResponseEntity.ok(ExplainResponse(explanation.text, facts))
                }

                is Explanation.Failed -> {
                    modelFailed(tokenId, "explain", explanation.reason)
                }
            }
        }

    /** Uma chamada por vez e até 10 por minuto na URL; recusada, 429 com `Retry-After`. */
    private fun limited(
        tokenId: TokenId,
        call: () -> ResponseEntity<Any>,
    ): ResponseEntity<Any> {
        val refused = limits.acquire(tokenId)
        if (refused != null) {
            return ResponseEntity
                .status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, refused.retryAfterSeconds.toString())
                .contentType(MediaType.APPLICATION_JSON)
                .body(AiError(refused.message))
        }
        return try {
            call()
        } finally {
            limits.release(tokenId)
        }
    }

    private fun modelFailed(
        tokenId: TokenId,
        route: String,
        reason: String,
    ): ResponseEntity<Any> {
        log.warn("[AI] {} {} falhou: {}", tokenId, route, reason)
        return json(HttpStatus.BAD_GATEWAY, AiError("The language model failed: $reason."))
    }

    private fun notConfigured(): ResponseEntity<Any> = json(HttpStatus.SERVICE_UNAVAILABLE, AiError("AI is not configured"))

    private fun unprocessable(errors: Map<String, List<String>>): ResponseEntity<Any> = json(HttpStatus.UNPROCESSABLE_CONTENT, errors)

    private fun json(
        status: HttpStatus,
        body: Any,
    ): ResponseEntity<Any> = ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(body)

    private fun HttpServletRequest.bodyText(): String = String(legacyInput().body, UTF_8)
}
