package site.webhook.mcp

import io.modelcontextprotocol.server.McpServerFeatures.SyncToolSpecification
import org.springframework.ai.mcp.customizer.McpSyncServerCustomizer
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Primary
import org.springframework.core.io.ClassPathResource
import site.webhook.capture.RequestListing
import site.webhook.capture.RequestStore
import site.webhook.capture.findOrNotFound
import site.webhook.http.jsonInput
import site.webhook.outbound.OutboundActions
import site.webhook.outbound.OutboundStore
import site.webhook.privacy.ProtectedUrls
import site.webhook.rules.Parsed
import site.webhook.rules.RuleStore
import site.webhook.rules.diff
import site.webhook.rules.generatedIds
import site.webhook.rules.parseRule
import site.webhook.rules.parseRules
import site.webhook.rules.readJson
import site.webhook.rules.test
import site.webhook.search.RequestSearch
import site.webhook.search.parseSearch
import site.webhook.token.TokenService
import site.webhook.wait.RequestWaiter
import site.webhook.wait.parseWait
import tools.jackson.databind.json.JsonMapper

/** O `user_agent` do token criado pelo MCP (o IP do agente não chega às ferramentas). */
private const val MCP_USER_AGENT = "MCP"

private val RULES_LANGUAGE = ClassPathResource("ai/rules-language.md").getContentAsString(Charsets.UTF_8)

private const val TOKEN_ID =
    """"token_id": {"type": "string", "format": "uuid", "description": "UUID of the webhook URL (token)"},
    "read_secret": {"type": "string", "description": "The URL's read secret; required when the URL is protected"}"""
private const val REQUEST_ID = """"request_id": {"type": "string", "format": "uuid", "description": "UUID of a captured request"}"""
private const val MATCH =
    """"match": {"type": "object", "description": "Conditions of a response rule's match (method, path, query, headers, body, signature, schema); absent matches every request"}"""

private const val SETTINGS = """
    "default_status": {"type": "integer", "description": "HTTP status the URL answers with (default 200)"},
    "default_content": {"type": "string", "description": "Response body (default empty)"},
    "default_content_type": {"type": "string", "description": "Response Content-Type (default text/plain)"},
    "timeout": {"type": "integer", "description": "Seconds to wait before answering, 0 to 10"},
    "retry_after": {"description": "Retry-After header on every answer: seconds (integer >= 0) or an HTTP date"},
    "auto_cleanup": {"type": "integer", "description": "Keep only the newest N requests: 500, 1000, 5000 or 10000"},
    "signature": {"type": "object", "description": "HMAC verification: {provider: stripe|github|shopify|slack|generic, secret, header?, algorithm?, encoding?, prefix?, toleranceSeconds?}. The secret is never returned, only masked"},
    "schema": {"description": "JSON Schema (draft 7, 2019-09 or 2020-12) the request body is validated against"}"""

/** O argumento do `set_rules` e do `diff_rules`: a lista inteira de regras. */
private const val RULES_ARGUMENT = """$TOKEN_ID, "rules": {"type": "array", "items": {"type": "object"}}"""

private const val NEW_READ_SECRET =
    """"read_secret": {"type": "string", "description": "Require this secret (8 to 256 characters) to read and manage the URL; never returned"}"""

private fun objectSchema(
    properties: String,
    vararg required: String,
): String = """{"type": "object", "properties": {$properties}, "required": [${required.joinToString(", ") { "\"$it\"" }}]}"""

/**
 * O servidor MCP (`/mcp`, Streamable HTTP) só existe com `webhook.mcp.enabled`: desligado, a rota é 404 como qualquer
 * outra inexistente. As ferramentas são as rotas da API, sobre os mesmos serviços, com a validação e as mensagens
 * delas. O SDK não valida os argumentos pelo schema: quem valida é a API, para que as mensagens sejam as mesmas.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnBooleanProperty("webhook.mcp.enabled")
class McpTools {
    /**
     * O autoconfigurador aceita um customizador só: este substitui o dele (`immediateExecution`, a ferramenta roda na
     * thread da requisição, virtual) e desliga a validação dos argumentos pelo schema, que fica com a API.
     */
    @Bean
    @Primary
    fun apiValidatesToolInputs(): McpSyncServerCustomizer =
        McpSyncServerCustomizer { it.immediateExecution(true).validateToolInputs(false) }

    @Bean
    fun urlTools(
        jsonMapper: JsonMapper,
        urls: ProtectedUrls,
        service: TokenService,
    ): List<SyncToolSpecification> {
        val kit = McpToolkit(jsonMapper)
        return listOf(
            kit.tool(
                ToolDefinition(
                    "create_url",
                    "Create a new webhook URL (token). Any HTTP request to /{uuid} on this server is then captured. " +
                        "Returns the token as POST /token does, with the signature secret masked.",
                    objectSchema("$SETTINGS,$NEW_READ_SECRET"),
                    readOnly = false,
                ),
            ) { args ->
                service
                    .create(
                        jsonInput(args.createBody().toByteArray(), jsonMapper),
                        ip = null,
                        userAgent = MCP_USER_AGENT,
                    ).map { it.forApi() }
            },
            kit.tool(
                ToolDefinition(
                    "get_url",
                    "Read a webhook URL's settings (signature secret masked).",
                    objectSchema(TOKEN_ID, "token_id"),
                    readOnly = true,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                urls.open(id, args.readSecret()).forApi()
            },
            kit.tool(
                ToolDefinition(
                    "update_url",
                    "Replace a webhook URL's settings, as PUT /token/{id}: fields left out go back to their defaults, " +
                        "except the signature secret, which is kept when omitted. The URL's read secret is never changed " +
                        "here: read_secret is only the access to a protected URL.",
                    objectSchema("$TOKEN_ID,$SETTINGS", "token_id"),
                    readOnly = false,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                urls.open(id, args.readSecret())
                service.update(id, jsonInput(args.body().toByteArray(), jsonMapper)).map { it.forApi() }
            },
            kit.tool(
                ToolDefinition(
                    "delete_url",
                    "Delete a webhook URL with all its requests, rules and history.",
                    objectSchema(TOKEN_ID, "token_id"),
                    readOnly = false,
                    destructive = true,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                urls.open(id, args.readSecret())
                service.delete(id)
                mapOf("deleted" to true)
            },
        )
    }

    @Bean
    fun requestTools(
        jsonMapper: JsonMapper,
        urls: ProtectedUrls,
        requests: RequestStore,
        listing: RequestListing,
    ): List<SyncToolSpecification> {
        val kit = McpToolkit(jsonMapper)
        return listOf(
            kit.tool(
                ToolDefinition(
                    "list_requests",
                    "List the requests a webhook URL captured, paginated as GET /token/{id}/requests. With after=<seq>, " +
                        "the requests with a greater seq, oldest first (page and sorting are ignored).",
                    objectSchema(
                        """$TOKEN_ID,
                        "page": {"type": "integer", "description": "Page, from 1"},
                        "per_page": {"type": "integer", "description": "Requests per page (default 50)"},
                        "sorting": {"type": "string", "enum": ["newest", "oldest"]},
                        "after": {"type": "integer", "description": "Only requests with seq greater than this"}""",
                        "token_id",
                    ),
                    readOnly = true,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                urls.open(id, args.readSecret())
                listing.list(
                    id,
                    mapOf(
                        "page" to args["page"],
                        "per_page" to args["per_page"],
                        "sorting" to args["sorting"],
                        "after" to args["after"],
                    ),
                )
            },
            kit.tool(
                ToolDefinition(
                    "get_request",
                    "Read one captured request: method, URL, headers, query, body, signature and schema results, the rule " +
                        "that answered or the near miss.",
                    objectSchema("$TOKEN_ID, $REQUEST_ID", "token_id", "request_id"),
                    readOnly = true,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                val requestId = args.requestId() ?: return@tool missingUuid("request_id")
                requests.findOrNotFound(urls.open(id, args.readSecret()), requestId)
            },
        )
    }

    @Bean
    fun searchTools(
        jsonMapper: JsonMapper,
        urls: ProtectedUrls,
        search: RequestSearch,
        waiter: RequestWaiter,
    ): List<SyncToolSpecification> {
        val kit = McpToolkit(jsonMapper)
        return listOf(
            kit.tool(
                ToolDefinition(
                    "search_requests",
                    "Search a webhook URL's requests by text (method, URL, IP, headers, query and body, case-insensitive) " +
                        "and by a rule match, paginated.",
                    objectSchema(
                        """$TOKEN_ID,
                        "text": {"type": "string", "description": "Text to find, up to 200 characters"},
                        $MATCH,
                        "sorting": {"type": "string", "enum": ["newest", "oldest"]},
                        "page": {"type": "integer"},
                        "per_page": {"type": "integer", "description": "1 to 100 (default 50)"}""",
                        "token_id",
                    ),
                    readOnly = true,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                val token = urls.open(id, args.readSecret())
                parseSearch(args.body()).map { search.search(token, it) }
            },
            kit.tool(
                ToolDefinition(
                    "wait_for_request",
                    "Wait (long poll) until the webhook URL has `count` requests that match `match` and have seq greater " +
                        "than `after`, or until `timeout` ms. Returns {matched, count, requests, near_miss}.",
                    objectSchema(
                        """$TOKEN_ID,
                        $MATCH,
                        "after": {"type": "integer", "description": "Only requests with seq greater than this (default: all)"},
                        "count": {"type": "integer", "description": "How many requests to wait for, 1 to 100 (default 1)"},
                        "timeout": {"type": "integer", "description": "Milliseconds to wait, 0 to 300000 (default 30000)"}""",
                        "token_id",
                    ),
                    readOnly = true,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                val token = urls.open(id, args.readSecret())
                parseWait(args.body()).map { waiter.wait(token, it) }
            },
        )
    }

    @Bean
    fun ruleTools(
        jsonMapper: JsonMapper,
        urls: ProtectedUrls,
        requests: RequestStore,
        rules: RuleStore,
    ): List<SyncToolSpecification> {
        val kit = McpToolkit(jsonMapper)
        return listOf(
            kit.tool(
                ToolDefinition("get_rules", "Read a webhook URL's response rules.", objectSchema(TOKEN_ID, "token_id"), readOnly = true),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                rules.find(urls.open(id, args.readSecret()).uuid)
            },
            kit.tool(
                ToolDefinition(
                    "set_rules",
                    "Replace all response rules of a webhook URL (up to 100) and return the saved list, with ids.\n\n$RULES_LANGUAGE",
                    objectSchema(RULES_ARGUMENT, "token_id", "rules"),
                    readOnly = false,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                val token = urls.open(id, args.readSecret())
                parseRules(readJson(args.bodyOf("rules"))?.get("rules")).map { rules.store(token.uuid, it) }
            },
            kit.tool(
                ToolDefinition(
                    "diff_rules",
                    "Compare a proposed list of response rules (the same argument as set_rules) with the URL's saved rules, " +
                        "by id, without saving anything. Returns {equal: [id], changed: [{id, name, fields}], removed: [{id, name}], " +
                        "added: [{id?, name}]}; a rule without id is new. Invalid rules give the same errors as set_rules.",
                    objectSchema(RULES_ARGUMENT, "token_id", "rules"),
                    readOnly = true,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                val token = urls.open(id, args.readSecret())
                val tree = readJson(args.bodyOf("rules"))?.get("rules")
                parseRules(tree).map { proposed ->
                    rules.find(token.uuid).diff(proposed, proposed.generatedIds(checkNotNull(tree)), jsonMapper)
                }
            },
            kit.tool(
                ToolDefinition(
                    "test_rule",
                    "Test one rule (saved or not) against the 500 newest requests; returns {matches, misses} with the " +
                        "failed conditions of each miss. `enabled` is ignored.",
                    objectSchema("$TOKEN_ID, \"rule\": {\"type\": \"object\"}", "token_id", "rule"),
                    readOnly = true,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                val token = urls.open(id, args.readSecret())
                parseRule(readJson(args.bodyOf("rule"))?.get("rule")).map { requests.test(token, it) }
            },
        )
    }

    @Bean
    fun outboundTools(
        jsonMapper: JsonMapper,
        urls: ProtectedUrls,
        requests: RequestStore,
        actions: OutboundActions,
        store: OutboundStore,
    ): List<SyncToolSpecification> {
        val kit = McpToolkit(jsonMapper)
        return listOf(
            kit.tool(
                ToolDefinition(
                    "replay_request",
                    "The server resends a captured request (method, headers, body) to `url` and returns the response. " +
                        "With keep_path (default true) the path and query after the token are appended to `url`.",
                    objectSchema(
                        """$TOKEN_ID, $REQUEST_ID,
                        "url": {"type": "string", "description": "Absolute http(s) URL"},
                        "keep_path": {"type": "boolean"},
                        "timeout": {"type": "integer", "description": "Milliseconds, 1000 to 30000 (default 10000)"}""",
                        "token_id",
                        "request_id",
                        "url",
                    ),
                    readOnly = false,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                val requestId = args.requestId() ?: return@tool missingUuid("request_id")
                val token = urls.open(id, args.readSecret())
                actions.replay(token, requests.findOrNotFound(token, requestId), args.body())
            },
            kit.tool(
                ToolDefinition(
                    "send_request",
                    "The server sends a request built here (method, headers, body) to `url` and returns the response; " +
                        "with sign=true it is signed with the URL's signature settings.",
                    objectSchema(
                        """$TOKEN_ID,
                        "url": {"type": "string", "description": "Absolute http(s) URL"},
                        "method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]},
                        "headers": {"type": "object", "additionalProperties": {"type": "string"}},
                        "body": {"type": "string"},
                        "sign": {"type": "boolean"},
                        "timeout": {"type": "integer", "description": "Milliseconds, 1000 to 30000 (default 10000)"}""",
                        "token_id",
                        "url",
                    ),
                    readOnly = false,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                actions.send(urls.open(id, args.readSecret()), args.body())
            },
            kit.tool(
                ToolDefinition(
                    "get_outbound",
                    "The URL's last 50 replays and sends, newest first.",
                    objectSchema(TOKEN_ID, "token_id"),
                    readOnly = true,
                ),
            ) { args ->
                val id = args.tokenId() ?: return@tool missingUuid("token_id")
                store.history(urls.open(id, args.readSecret()).uuid)
            },
        )
    }
}

/** Transforma o valor válido, mantendo os erros. */
private fun <T, R> Parsed<T>.map(transform: (T) -> R): Parsed<R> =
    when (this) {
        is Parsed.Valid -> Parsed.Valid(transform(value))
        is Parsed.Invalid -> this
    }
