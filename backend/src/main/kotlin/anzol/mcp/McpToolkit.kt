package anzol.mcp

import anzol.RequestId
import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.outbound.Dispatch
import anzol.outbound.outboundMessage
import anzol.rules.Parsed
import io.modelcontextprotocol.server.McpServerFeatures.SyncToolSpecification
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import io.modelcontextprotocol.spec.McpSchema.Tool
import io.modelcontextprotocol.spec.McpSchema.ToolAnnotations
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ArrayNode
import tools.jackson.databind.node.ObjectNode
import java.util.UUID

private val UUID_TEXT = Regex(UUID_PATTERN)
private const val READ_SECRET = "read_secret"

/**
 * A política de decifra não muda pelo MCP: um agente que lê o payload de terceiros, mandado ao `update_url` ou ao
 * `create_url`, poderia desligá-la ou pôr um remetente confiável dele. O `update_url` mantém a salva.
 */
internal const val E2EE = "e2ee"

/** O aviso do `create_url` e do `update_url` quando `e2ee` veio e foi ignorado. */
internal const val E2EE_IGNORED = "e2ee ignored: MCP never changes it; ask the person to change it in the UI (Checks › Decryption)."

/** O aviso do `update_url` quando `signature: null` tira o HMAC de uma URL que decifra. */
internal const val SIGNATURE_REMOVED = "signature removed on a URL with e2ee: decryption no longer requires a valid HMAC"

/**
 * Os argumentos de uma chamada de ferramenta, como o cliente MCP os mandou (JSON já lido). O argumento de primeiro
 * nível enviado como `null` vale como ausente em toda ferramenta (é o que os agentes mandam num opcional que não
 * usam); só o `update_url` lhe dá sentido próprio ([bodyOver]).
 */
class ToolArguments(
    private val sent: Map<String, Any?>,
    private val jsonMapper: JsonMapper,
) {
    private val values: Map<String, Any?> = sent.filterValues { it != null }

    fun tokenId(): TokenId? = uuid("token_id")?.let(::TokenId)

    fun requestId(): RequestId? = uuid("request_id")?.let(::RequestId)

    /** O segredo de leitura da URL, para as URLs protegidas; não vai para o corpo das rotas ([body]). */
    fun readSecret(): String? = values[READ_SECRET] as? String

    operator fun get(name: String): Any? = values[name]

    /** Se [name] veio na chamada, mesmo como `null`. */
    fun sent(name: String): Boolean = name in sent

    /** Os argumentos sem os UUIDs do caminho e sem o segredo de acesso, como o corpo JSON da rota da API. */
    fun body(): String = jsonMapper.writeValueAsString(values - setOf("token_id", "request_id", READ_SECRET))

    /**
     * O corpo do `PUT /token/{id}` que muda só o que foi enviado: [current] (a configuração de agora, como o corpo
     * do `PUT` a escreveria) com os argumentos por cima. O campo enviado como `null` sai do corpo, e no `PUT` campo
     * ausente é o padrão (ou desligado).
     */
    fun bodyOver(current: Map<String, Any?>): String {
        val changed = sent - setOf("token_id", "request_id", READ_SECRET, E2EE)
        return jsonMapper.writeValueAsString((current + changed).filterKeys { it !in changed || changed[it] != null })
    }

    /** O corpo do `create_url`: nele `read_secret` é o segredo que a URL nova passa a exigir. */
    fun createBody(): String = jsonMapper.writeValueAsString(values - setOf("token_id", "request_id", E2EE))

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

    private fun success(value: Any): CallToolResult =
        CallToolResult
            .builder()
            .addTextContent(jsonMapper.writeValueAsString(jsonMapper.valueToTree<JsonNode>(value).withoutDecrypted()))
            .build()

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

/** [value] com `warnings` no fim do objeto quando há aviso; sem aviso, o JSON de sempre. */
fun JsonMapper.withWarnings(
    value: Any,
    warnings: List<String>,
): Any {
    if (warnings.isEmpty()) return value
    val tree = valueToTree<ObjectNode>(value)
    val list = tree.putArray("warnings")
    warnings.forEach(list::add)
    return tree
}

/** `token_id` (ou `request_id`) ausente ou fora do formato: o 422 que a ferramenta devolve. */
fun missingUuid(name: String): Parsed.Invalid = Parsed.Invalid(mapOf(name to listOf("The ${name.replace('_', ' ')} must be a valid UUID.")))

/**
 * Sem o atributo decifrado (`decrypted`) de nenhuma mensagem, em qualquer nível da resposta: o agente lê o resultado da
 * decifra, nunca o texto aberto. Mensagem é o objeto com `token_id` e `decryption`.
 */
private fun JsonNode.withoutDecrypted(): JsonNode {
    when (this) {
        is ObjectNode -> {
            if (has("token_id") && has("decryption")) remove("decrypted")
            properties().forEach { (_, child) -> child.withoutDecrypted() }
        }

        is ArrayNode -> {
            forEach { it.withoutDecrypted() }
        }

        else -> {}
    }
    return this
}
