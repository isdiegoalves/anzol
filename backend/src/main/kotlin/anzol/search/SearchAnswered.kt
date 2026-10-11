package anzol.search

import anzol.STATUS_IN_PATH
import anzol.capture.CapturedRequest
import anzol.rules.Violations
import anzol.rules.allOrNull
import anzol.rules.given
import tools.jackson.databind.JsonNode

private const val ANSWERED_KEY = "answered"
private const val FAMILY_SIZE = 100
private val FAMILY = Regex("[1-5]xx")

/**
 * `answered`: a mensagem cujo `response.status` cai em alguma das faixas. Sem status gravado (a regra derrubou a
 * conexão, ou a mensagem é de antes do `response`), não casa nenhuma.
 */
fun CapturedRequest.answeredIn(statuses: List<IntRange>): Boolean {
    val status = response?.status ?: return false
    return statuses.any { status in it }
}

/**
 * `answered`: lista de famílias (`"5xx"`) e de status exatos (`"404"`), cada item uma faixa de status; ausente, nulo
 * ou vazia é sem filtro. Erros em `answered` (não é lista) e em `answered.<índice>` (o item).
 */
fun Violations.answered(node: JsonNode?): List<IntRange>? {
    val given = node.given() ?: return emptyList()
    return if (given.isArray) {
        given
            .mapIndexed { index, item -> statusRange(item) ?: fail("$ANSWERED_KEY.$index", "The selected answered is invalid.") }
            .allOrNull()
    } else {
        fail(ANSWERED_KEY, "The answered must be an array.")
    }
}

private fun statusRange(item: JsonNode): IntRange? {
    val text = item.takeIf { it.isString }?.stringValue() ?: return null
    return when {
        FAMILY.matches(text) -> family(text.first().digitToInt())
        STATUS_IN_PATH.matches(text) -> text.toInt()..text.toInt()
        else -> null
    }
}

private fun family(digit: Int): IntRange = digit * FAMILY_SIZE until (digit + 1) * FAMILY_SIZE
