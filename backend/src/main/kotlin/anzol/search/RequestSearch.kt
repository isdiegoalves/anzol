package anzol.search

import anzol.capture.CapturedRequest
import anzol.capture.RequestPage
import anzol.capture.RequestStore
import anzol.capture.ScanBatch
import anzol.capture.Sorting
import anzol.rules.conditions
import anzol.rules.failure
import anzol.rules.toMatchInput
import anzol.token.Token
import org.springframework.stereotype.Component
import tools.jackson.databind.JsonNode

/** Quantas entradas do índice cada leitura da varredura traz. */
private const val SCAN_BATCH = 100L

/**
 * Varre todas as mensagens retidas da URL, em trechos do índice na ordem pedida, e guarda só as da
 * página: na memória ficam um trecho e a página, nunca a URL inteira. `total` conta as que casam (desfecho, motivo da
 * assinatura, caminho do schema, texto e `match`, em E). O texto procura no valor decifrado só com [includeDecrypted]:
 * a API REST, que exige o acesso de leitura da URL; o MCP nunca, porque o agente não vê o valor e a busca o revelaria.
 */
@Component
class RequestSearch(
    private val requests: RequestStore,
) {
    fun search(
        token: Token,
        search: SearchRequest,
        includeDecrypted: Boolean,
    ): RequestPage {
        val conditions = search.match.conditions()
        val skipped = search.skipped()
        val window = skipped until skipped + search.perPage
        var total = 0L
        val data =
            buildList {
                batches(token, search.sorting)
                    .flatMap { it.messages }
                    .filter { message -> search.outcome?.matches(message) != false }
                    .filter { message -> search.signatureReason?.let(message::hasSignatureReason) != false }
                    .filter { message -> search.schemaPath?.let(message::hasSchemaPath) != false }
                    .filter { message -> message.contains(search.text, includeDecrypted) }
                    .filter { message -> conditions.none { it.failure(message.toMatchInput()) != null } }
                    .forEach { message ->
                        if (total in window) add(message)
                        total++
                    }
            }
        return RequestPage(
            data = data,
            total = total,
            perPage = search.perPage,
            currentPage = search.page,
            isLastPage = data.size + skipped >= total,
            from = skipped + 1,
            to = minOf(total, data.size + skipped),
        )
    }

    private fun batches(
        token: Token,
        sorting: Sorting,
    ): Sequence<ScanBatch> =
        generateSequence(requests.scan(token, sorting, from = null, limit = SCAN_BATCH)) { previous ->
            previous.next?.let { requests.scan(token, sorting, from = it, limit = SCAN_BATCH) }
        }
}

/** As mensagens que casam antes da página; `page` absurdo satura em vez de estourar o `Long`. */
private fun SearchRequest.skipped(): Long = if (page - 1 >= Long.MAX_VALUE / perPage) Long.MAX_VALUE - perPage else (page - 1) * perPage

/**
 * O [text] aparece, sem diferenciar maiúsculas, no método, na URL gravada, no IP, num nome ou valor de
 * header ou de query, no corpo ou, com [includeDecrypted], num nome ou valor do atributo decifrado; [text] vazio casa
 * qualquer mensagem.
 */
fun CapturedRequest.contains(
    text: String,
    includeDecrypted: Boolean,
): Boolean {
    fun has(value: String?): Boolean = value != null && value.contains(text, ignoreCase = true)

    return has(method) ||
        has(url) ||
        has(ip) ||
        headers.any { (name, values) -> has(name) || values.any(::has) } ||
        query?.let { jsonTexts(it).any(::has) } == true ||
        has(content) ||
        (includeDecrypted && decrypted?.let { jsonTexts(it).any(::has) } == true)
}

/** Nomes e valores em qualquer nível: o PHP guarda a query `a[b]=1` como objeto dentro de objeto. */
private fun jsonTexts(node: JsonNode): Sequence<String> =
    when {
        node.isObject -> node.properties().asSequence().flatMap { (name, value) -> sequenceOf(name) + jsonTexts(value) }
        node.isArray -> node.asSequence().flatMap(::jsonTexts)
        node.isNull -> emptySequence()
        else -> sequenceOf(node.asString())
    }
