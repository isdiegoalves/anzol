package anzol.stream

import anzol.RequestId
import anzol.capture.CapturedRequest
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode

/** Acima disto (em caracteres do `json_encode` do PHP) o evento vai sem o corpo. */
private const val TRUNCATE_ABOVE = 1_000_000L

/** A mais que o PHP escreve por unidade UTF-16 fora do ASCII: `ç` vira `ç`. */
private const val PHP_UNICODE_ESCAPE_EXTRA = 5L
private const val LAST_ASCII = 0x7F
private val TRUNCATED_FIELDS = listOf("content", "headers", "user_agent")

/**
 * `data:` do evento `request.created`: o payload de `Events/RequestCreated.php` mais `removed`, os
 * uuids que a limpeza automática tirou ao gravar esta mensagem (lista vazia quando nada saiu).
 */
data class RequestCreated(
    val request: JsonNode,
    val total: Long,
    val truncated: Boolean,
    val removed: List<RequestId>,
)

/**
 * Monta o evento como o app antigo pretendia: quando o JSON da mensagem passa de 1.000.000
 * caracteres contados como o `json_encode` do PHP, `content`, `headers` e `user_agent` saem e
 * `truncated` fica true (o app antigo marcava mas mandava tudo; o contrato exige o corte).
 */
fun CapturedRequest.toRequestCreated(
    total: Long,
    removed: List<RequestId>,
    jsonMapper: JsonMapper,
): RequestCreated {
    val request: ObjectNode = jsonMapper.valueToTree(this)
    val truncated = phpJsonLength(jsonMapper.writeValueAsString(request)) > TRUNCATE_ABOVE
    if (truncated) request.remove(TRUNCATED_FIELDS)
    return RequestCreated(request, total, truncated, removed)
}

/** `mb_strlen(json_encode(...))`: o PHP escapa `/` como `\/` e cada unidade UTF-16 não ASCII como `\uXXXX`. */
fun phpJsonLength(json: String): Long =
    json.length + json.count { it == '/' } + PHP_UNICODE_ESCAPE_EXTRA * json.count { it.code > LAST_ASCII }
