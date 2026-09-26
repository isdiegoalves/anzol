package site.webhook.mcp

import io.modelcontextprotocol.server.McpServerFeatures.SyncToolSpecification
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.Tool
import io.modelcontextprotocol.spec.McpSchema.ToolAnnotations
import org.springframework.web.server.ResponseStatusException
import site.webhook.RequestId
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.outbound.Dispatch
import site.webhook.outbound.outboundMessage
import site.webhook.rules.Parsed
import tools.jackson.databind.json.JsonMapper
import java.util.UUID

private val UUID_TEXT = Regex(UUID_PATTERN)
private const val READ_SECRET = "read_secret"

/** Os argumentos de uma chamada de ferramenta, como o cliente MCP os mandou (JSON já lido). */
class ToolArguments(
    private val values: Map<String, Any?>,
    private val jsonMapper: JsonMapper,
) {
    fun tokenId(): TokenId? = uuid("token_id")?.let(::TokenId)

    fun requestId(): RequestId? = uuid("request_id")?.let(::RequestId)

    /** O segredo de leitura da URL, para as URLs protegidas; não vai para o corpo das rotas ([body]). */
    fun readSecret(): String? = values[READ_SECRET] as? String

    operator fun get(name: String): Any? = values[name]

    /** Os argumentos sem os UUIDs do caminho e sem o segredo de acesso, como o corpo JSON da rota da API. */
    fun body(): String = jsonMapper.writeValueAsString(values - setOf("token_id", "request_id", READ_SECRET))

    /** O corpo do `create_url`: nele `read_secret` é o segredo que a URL nova passa a exigir. */
    fun createBody(): String = jsonMapper.writeValueAsString(values - setOf("token_id", "request_id"))

    /** Só os argumentos [names], como o corpo JSON da rota da API. */
    fun bodyOf(vararg names: String): String = jsonMapper.writeValueAsString(values.filterKeys { it in names })

    private fun uuid(name: String): UUID? = (values[name] as? String)?.takeIf { UUID_TEXT.matches(it) }?.let(UUID::fromString)
}

/** Uma ferramenta: nome, descrição para o agente, schema de entrada (JSON) e se só lê. */
data class ToolDefinition(
    val name: String,
    val description: String,
    val inputSchema: String,
    val readOnly: Boolean,
    val destructive: Boolean = false,
)

/**
 * Monta as ferramentas sobre os serviços da API. O resultado é o JSON que a rota da API devolveria (mesmo
 * `JsonMapper`); os erros viram erro de ferramenta (`isError`) com o status e a mensagem da API: validação
 * (`{"status":422,"errors":{campo:[mensagens]}}`), URL ou mensagem inexistente (410, 404) e limite (429).
 */
class McpToolkit(
    private val jsonMapper: JsonMapper,
) {
    fun tool(
        definition: ToolDefinition,
        handler: (ToolArguments) -> Any,
    ): SyncToolSpecification {
        @Suppress("UNCHECKED_CAST")
        val schema = jsonMapper.readValue(definition.inputSchema, Map::class.java) as Map<String, Any>
        val tool =
            Tool
                .builder()
                .name(definition.name)
                .description(definition.description)
                .inputSchema(schema)
                .annotations(
                    ToolAnnotations
                        .builder()
                        .readOnlyHint(definition.readOnly)
                        .destructiveHint(definition.destructive)
                        .build(),
                ).build()
        return SyncToolSpecification
            .builder()
            .tool(tool)
            .callHandler { _, request -> answer { handler(ToolArguments(request.arguments().orEmpty(), jsonMapper)) } }
            .build()
    }

    private fun answer(call: () -> Any): CallToolResult =
        try {
            when (val value = call()) {
                is Parsed.Valid<*> -> success(checkNotNull(value.value))
                is Parsed.Invalid -> invalid(value.errors)
                is Dispatch.Done -> success(value.result)
                is Dispatch.Invalid -> invalid(value.errors)
                is Dispatch.Limited -> failure(STATUS_TOO_MANY, value.refused.outboundMessage())
                else -> success(value)
            }
        } catch (error: ResponseStatusException) {
            failure(error.statusCode.value(), error.reason.orEmpty())
        }

    private fun success(value: Any): CallToolResult = CallToolResult.builder().addTextContent(jsonMapper.writeValueAsString(value)).build()

    private fun invalid(errors: Map<String, List<String>>): CallToolResult =
        error(linkedMapOf("status" to STATUS_UNPROCESSABLE, "errors" to errors))

    private fun failure(
        status: Int,
        message: String,
    ): CallToolResult = error(linkedMapOf("status" to status, "error" to message))

    private fun error(body: Map<String, Any>): CallToolResult =
        CallToolResult
            .builder()
            .addTextContent(jsonMapper.writeValueAsString(body))
            .isError(true)
            .build()

    private companion object {
        const val STATUS_UNPROCESSABLE = 422
        const val STATUS_TOO_MANY = 429
    }
}

/** `token_id` (ou `request_id`) ausente ou fora do formato: o 422 que a ferramenta devolve. */
fun missingUuid(name: String): Parsed.Invalid = Parsed.Invalid(mapOf(name to listOf("The ${name.replace('_', ' ')} must be a valid UUID.")))
