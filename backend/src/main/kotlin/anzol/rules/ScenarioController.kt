package anzol.rules

import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.http.legacyInput
import anzol.token.TokenStore
import anzol.token.findOrGone
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.core.JacksonException
import tools.jackson.databind.json.JsonMapper

/** Um cenário da URL: o estado atual e os estados que as regras citam (exigido e novo, na ordem da lista). */
data class ScenarioView(
    val name: String,
    val state: String,
    val states: List<String>,
)

/**
 * Os cenários das regras (todas, ativas ou não, na ordem em que aparecem) e, depois, os que só têm
 * estado gravado (definido à mão), por nome.
 */
fun scenarioViews(
    rules: List<Rule>,
    states: Map<String, String>,
): List<ScenarioView> {
    val cited = rules.mapNotNull { it.scenario }.groupBy { it.name }
    val names = cited.keys + states.keys.filterNot { it in cited }.sorted()
    return names.map { name ->
        val citedStates = cited[name].orEmpty().flatMap { listOfNotNull(it.requiredState, it.newState) }.distinct()
        ScenarioView(name, states[name] ?: STARTED, citedStates)
    }
}

/** Estado dos cenários da URL: consulta, definição à mão e reset. Token inexistente responde 410. */
@RestController
@RequestMapping("/token/{tokenId:$UUID_PATTERN}/scenarios")
class ScenarioController(
    private val tokens: TokenStore,
    private val rules: RuleStore,
    private val scenarios: ScenarioStore,
    private val jsonMapper: JsonMapper,
) {
    @GetMapping
    fun all(
        @PathVariable tokenId: TokenId,
    ): List<ScenarioView> = views(tokens.findOrGone(tokenId).uuid)

    /** Leva o cenário ao estado do corpo (`{"state": "..."}`); devolve o cenário. */
    @PutMapping("/{name}")
    fun set(
        @PathVariable tokenId: TokenId,
        @PathVariable name: String,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        val state =
            try {
                jsonMapper.readTree(request.legacyInput().body)?.get("state").given()
            } catch (_: JacksonException) {
                null
            }
        val error =
            when {
                state == null || (state.isString && state.stringValue().isEmpty()) -> "The state field is required."
                !state.isString -> "The state must be a string."
                else -> null
            }
        if (error != null || state == null) {
            return ResponseEntity.unprocessableContent().contentType(MediaType.APPLICATION_JSON).body(mapOf("state" to listOf(error)))
        }
        scenarios.set(token.uuid, name, state.stringValue())
        return ResponseEntity.ok(views(token.uuid).first { it.name == name })
    }

    /** Todos voltam a `Started`; devolve a lista. */
    @DeleteMapping
    fun reset(
        @PathVariable tokenId: TokenId,
    ): List<ScenarioView> {
        val token = tokens.findOrGone(tokenId)
        scenarios.reset(token.uuid)
        return views(token.uuid)
    }

    private fun views(id: TokenId): List<ScenarioView> = scenarioViews(rules.find(id), scenarios.states(id))
}
