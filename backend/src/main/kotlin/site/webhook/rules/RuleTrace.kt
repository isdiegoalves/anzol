package site.webhook.rules

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController
import site.webhook.RequestId
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.capture.CapturedRequest
import site.webhook.capture.RequestStore
import site.webhook.capture.findOrNotFound
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming

/**
 * Uma regra no trace: [position] é a posição na ordem de avaliação entre as ligadas (1…N), nula nas desligadas.
 * [matches], [failed] e [conditions] são os do near miss (frases e chaves), sem olhar `enabled`.
 */
data class TracedRule(
    val id: RuleId,
    val name: String,
    val enabled: Boolean,
    val position: Int?,
    val matches: Boolean,
    val failed: List<String>,
    val conditions: List<String>,
)

/** Resposta do trace: a regra que a mensagem gravou como a que respondeu ([respondedBy]) e cada regra atual. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class RuleTrace(
    val request: RequestId,
    val respondedBy: RuleRef?,
    val rules: List<TracedRule>,
)

/**
 * As regras atuais contra a mensagem gravada [message], na ordem de avaliação: as ligadas pela escolha
 * ([evaluationOrder]) e as desligadas no fim, na ordem da lista. O cenário conta com o estado atual ([states]);
 * assinatura e schema, com o resultado gravado na mensagem.
 */
fun List<Rule>.trace(
    message: CapturedRequest,
    states: Map<String, String>,
): RuleTrace {
    val input = message.toMatchInput()
    val enabled = evaluationOrder()
    val ordered = enabled.mapIndexed { index, rule -> rule to index + 1 } + filterNot { it.enabled }.map { it to null }
    return RuleTrace(
        request = message.uuid,
        respondedBy = message.rule,
        rules =
            ordered.map { (rule, position) ->
                val failed = rule.failures(input, states)
                TracedRule(
                    id = rule.id,
                    name = rule.name,
                    enabled = rule.enabled,
                    position = position,
                    matches = failed.isEmpty(),
                    failed = failed.map { it.phrase },
                    conditions = failed.map { it.condition },
                )
            },
    )
}

/** Por que cada regra casou ou não com uma mensagem gravada, com as regras de agora. Só lê: nada é gravado. */
@RestController
class RuleTraceController(
    private val tokens: TokenStore,
    private val requests: RequestStore,
    private val rules: RuleStore,
    private val scenarios: ScenarioStore,
) {
    @GetMapping("/token/{tokenId:$UUID_PATTERN}/request/{requestId:$UUID_PATTERN}/rules/trace")
    fun trace(
        @PathVariable tokenId: TokenId,
        @PathVariable requestId: RequestId,
    ): RuleTrace {
        val token = tokens.findOrGone(tokenId)
        val message = requests.findOrNotFound(token, requestId)
        return rules.find(token.uuid).trace(message, scenarios.states(token.uuid))
    }
}
