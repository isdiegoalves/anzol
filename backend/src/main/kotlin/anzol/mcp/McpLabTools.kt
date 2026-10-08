package anzol.mcp

import anzol.e2ee.lab.DEFAULT_LAB_POLICY
import anzol.e2ee.lab.LabRun
import anzol.e2ee.lab.LabRunner
import anzol.e2ee.lab.LabService
import anzol.privacy.ProtectedUrls
import anzol.rules.Parsed
import io.modelcontextprotocol.server.McpServerFeatures.SyncToolSpecification
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.json.JsonMapper

private const val SCENARIOS =
    """"scenarios": {"type": "array", "items": {"type": "string"}, "description": "Scenario codes (P1, N4, Xa…); default all"}"""

private const val LAB_SETTINGS =
    """"hmac_header": {"type": "string", "description": "Header the URL's HMAC (sha256, hex) goes in; default X-Signature"},
    "path": {"type": "string", "description": "Simple JSONPath ($.a.b) of the encrypted attribute; default $.payload"},
    "bindings": {"type": "object", "description": "Where the plaintext envelope holds what jti, evt and app must repeat: a simple JSONPath, or {path, ignore_case}"},
    "audience": {"type": "string", "description": "The aud the JWS must carry; default anzol-lab"},
    "max_age_seconds": {"type": "integer", "description": "Maximum iat age, 60 to 604800 (default 43200)"},
    "trusted_signers": {"type": "array", "items": {"type": "object"}, "description": "Extra PUBLIC EC P-256 JWKs (with kid) trusted to sign, e.g. the guest client's; the lab's own test signer is always added"}"""

/**
 * As ferramentas do laboratório E2EE. Só criam URL nova e só rodam cenários numa URL de laboratório: nenhuma muda a
 * política de uma URL que já existe (o `create_url` e o `update_url` ignoram o `e2ee`), e o relatório nunca traz o
 * texto aberto.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnBooleanProperty("anzol.mcp.enabled")
class McpLabTools {
    @Bean
    fun labTools(
        jsonMapper: JsonMapper,
        urls: ProtectedUrls,
        labs: LabService,
        runner: LabRunner,
    ): List<SyncToolSpecification> {
        val kit = McpToolkit(jsonMapper)
        return listOf(
            kit.tool(
                ToolDefinition(
                    "create_e2ee_lab",
                    "Create a NEW E2EE lab URL, ready for the encryption scenarios: read secret and HMAC secret " +
                        "(returned only here), encryption keys enc-v1 and enc-v2, a server-side test signer, the policy and " +
                        "the lab rules (HMAC 401, unknown kid 500, other decryption failures 400, else 202). Lives 24 h; " +
                        "at most 20 active. It never changes an existing URL.",
                    objectSchema(LAB_SETTINGS),
                    readOnly = false,
                ),
            ) { args ->
                @Suppress("UNCHECKED_CAST")
                val input = jsonMapper.readValue(args.body(), Map::class.java) as Map<String, Any?>
                labs.create(input, ip = null, userAgent = "MCP")
            },
            kit.tool(
                ToolDefinition(
                    "list_e2ee_scenarios",
                    "List the 27 E2EE scenarios (P positive, N negative, X bindings and limits) with the status, " +
                        "decryption state and reason each one expects with the default lab policy.",
                    objectSchema(""),
                    readOnly = true,
                ),
            ) { LabRunner.catalog(DEFAULT_LAB_POLICY) },
            kit.tool(
                ToolDefinition(
                    "run_e2ee_scenarios",
                    "Run E2EE scenarios on a lab URL: the server builds each vector, delivers it through the real capture " +
                        "and compares status, decryption state and reason with the expected ones. Returns the report " +
                        "(matched of total, and expected vs actual per scenario); never the decrypted text. Only lab URLs.",
                    objectSchema(
                        "$TOKEN_ID, $SCENARIOS",
                        "token_id",
                    ),
                    readOnly = false,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                val codes = (args["scenarios"] as? List<*>).orEmpty().map { it.toString() }
                when (val run = runner.run(urls.open(id, args.readSecret()), codes)) {
                    is LabRun.Done -> Parsed.Valid(run.report)

                    is LabRun.Invalid -> Parsed.Invalid(run.errors)

                    is LabRun.Limited -> throw ResponseStatusException(
                        HttpStatus.TOO_MANY_REQUESTS,
                        "Too many lab runs for this URL; try again later",
                    )
                }
            },
        )
    }
}
