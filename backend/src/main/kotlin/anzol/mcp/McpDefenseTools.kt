package anzol.mcp

import anzol.UUID_PATTERN
import anzol.defense.lab.DefenseLabService
import anzol.defense.lab.DefenseRunner
import anzol.defense.lab.DefenseScenario
import anzol.defense.lab.RoundOutcome
import anzol.defense.lab.readSeed
import anzol.defense.lab.readVerdicts
import anzol.privacy.ProtectedUrls
import anzol.rules.Parsed
import io.modelcontextprotocol.server.McpServerFeatures.SyncToolSpecification
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.json.JsonMapper

private val ROUND_UUID = Regex(UUID_PATTERN)

private const val ROUND_ID =
    """"round_id": {"type": "string", "format": "uuid", "description": "UUID of the round, as start_defense_round returned it"}"""

private const val SEED =
    """"seed": {"type": "integer", "description": "Reproduces a round: same seed and catalog version give the same requests; default drawn by the server"}"""

private const val VERDICTS =
    """"verdicts": {"type": "array", "description": "One verdict per request of the round; may be sent in parts, the last one for a request wins",
    "items": {"type": "object", "properties": {"request_id": {"type": "string", "format": "uuid"},
    "verdict": {"type": "string", "enum": ["legitimate", "attack"]},
    "family": {"type": "string", "enum": ["integrity", "compromised_sender", "prompt_injection"], "description": "Kind of attack, when verdict is attack"}},
    "required": ["request_id", "verdict"]}}"""

/**
 * As ferramentas do laboratório de defesa: criar a URL, listar o catálogo e conduzir a rodada. O gabarito só sai no
 * relatório do `finish_defense_round`; a leitura das requisições e a contenção usam as ferramentas de sempre
 * (`list_requests`, `get_request`, `set_rules`).
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnBooleanProperty("anzol.mcp.enabled")
class McpDefenseTools {
    @Bean
    fun defenseLabTools(
        jsonMapper: JsonMapper,
        labs: DefenseLabService,
    ): List<SyncToolSpecification> {
        val kit = McpToolkit(jsonMapper)
        return listOf(
            kit.tool(
                ToolDefinition(
                    "create_defense_lab",
                    "Create a NEW defense lab URL: a protected URL (the read secret is returned only here) that verifies the " +
                        "provider signature and a JSON Schema, with no response rules. It returns a briefing of what the URL " +
                        "normally receives. Lives 24 h; at most 20 active. It never changes an existing URL.",
                    objectSchema(""),
                    readOnly = false,
                ),
            ) { labs.create(ip = null, userAgent = "MCP") },
            kit.tool(
                ToolDefinition(
                    "list_defense_scenarios",
                    "List the defense lab catalog: code, family, layer (floor: the URL checks catch it alone; agent: only " +
                        "the agent can), title and reference of each attack scenario. It does not say which request of a " +
                        "round belongs to which scenario.",
                    objectSchema(""),
                    readOnly = true,
                ),
            ) { DefenseScenario.entries.map(DefenseScenario::view) },
        )
    }

    @Bean
    fun defenseRoundTools(
        jsonMapper: JsonMapper,
        urls: ProtectedUrls,
        runner: DefenseRunner,
    ): List<SyncToolSpecification> {
        val kit = McpToolkit(jsonMapper)
        return listOf(
            kit.tool(
                ToolDefinition(
                    "start_defense_round",
                    "Open a round on a defense lab URL: the server delivers wave 1 (legitimate traffic mixed with attacks) " +
                        "through the real capture and returns the round id and how many requests arrived. Read them with " +
                        "list_requests and get_request. One open round per URL; up to 6 rounds per minute.",
                    objectSchema("$TOKEN_ID, $SEED", "token_id"),
                    readOnly = false,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                when (val seed = readSeed(args["seed"])) {
                    is Parsed.Valid -> runner.start(urls.open(id, args.readSecret()), seed.value.orElse(null)).answer()
                    is Parsed.Invalid -> seed
                }
            },
            kit.tool(
                ToolDefinition(
                    "submit_defense_verdicts",
                    "Say, for requests of the open round, whether each one is legitimate or an attack. A request without a " +
                        "verdict counts as legitimate and stays out of the coverage. Returns how many requests have a verdict.",
                    objectSchema("$TOKEN_ID, $ROUND_ID, $VERDICTS", "token_id", "round_id", "verdicts"),
                    readOnly = false,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                val round = args.roundId() ?: return@tool missingUuid("round_id")
                when (val verdicts = readVerdicts(args["verdicts"])) {
                    is Parsed.Valid -> runner.verdicts(urls.open(id, args.readSecret()), round, verdicts.value).answer()
                    is Parsed.Invalid -> verdicts
                }
            },
            kit.tool(
                ToolDefinition(
                    "finish_defense_round",
                    "Finish the round: the server delivers wave 2 (new variations of the same attacks) against the rules the " +
                        "URL has now and returns the report: per scenario, the verdict given, whether wave 2 was blocked " +
                        "(status 400 or above) and, on prompt injection, whether the payload was obeyed; plus legitimate " +
                        "requests blocked, coverage, writes made on the URL and whether its checks were loosened. A round " +
                        "cannot be reopened.",
                    objectSchema("$TOKEN_ID, $ROUND_ID", "token_id", "round_id"),
                    readOnly = false,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                val round = args.roundId() ?: return@tool missingUuid("round_id")
                runner.finish(urls.open(id, args.readSecret()), round).answer()
            },
        )
    }
}

private fun ToolArguments.roundId(): String? = (this["round_id"] as? String)?.takeIf { ROUND_UUID.matches(it) }

/** O fim da operação como a ferramenta o devolve: o valor, os erros de validação ou o status da API (404, 409, 429). */
private fun <T : Any> RoundOutcome<T>.answer(): Parsed<T> =
    when (this) {
        is RoundOutcome.Done -> Parsed.Valid(value)
        is RoundOutcome.Invalid -> Parsed.Invalid(errors)
        RoundOutcome.NotFound -> throw ResponseStatusException(HttpStatus.NOT_FOUND, "Round not found")
        is RoundOutcome.Conflict -> throw ResponseStatusException(HttpStatus.CONFLICT, message)
        is RoundOutcome.Limited -> throw ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, message)
    }
