package site.webhook.search

import org.springframework.stereotype.Component
import site.webhook.capture.CapturedRequest
import site.webhook.capture.RequestPage
import site.webhook.capture.RequestStore
import site.webhook.capture.ScanBatch
import site.webhook.capture.Sorting
import site.webhook.rules.conditions
import site.webhook.rules.failure
import site.webhook.rules.toMatchInput
import site.webhook.token.Token
import tools.jackson.databind.JsonNode

/** Quantas entradas do índice cada leitura da varredura traz. */
private const val SCAN_BATCH = 100L

/**
 * Varre todas as mensagens retidas da URL, em trechos do índice na ordem pedida, e guarda só as da
 * página: na memória ficam um trecho e a página, nunca a URL inteira. `total` conta as que casam.
 */
@Component
class RequestSearch(
    private val requests: RequestStore,
) {
    fun search(
        token: Token,
        search: SearchRequest,
    ): RequestPage {
        val conditions = search.match.conditions()
        val skipped = search.skipped()
        val window = skipped until skipped + search.perPage
        var total = 0L
        val data =
            buildList {
                batches(token, search.sorting)
                    .flatMap { it.messages }
                    .filter { message -> message.contains(search.text) && conditions.none { it.failure(message.toMatchInput()) != null } }
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
 * header ou de query, ou no corpo; [text] vazio casa qualquer mensagem.
 */
fun CapturedRequest.contains(text: String): Boolean {
    fun has(value: String?): Boolean = value != null && value.contains(text, ignoreCase = true)

    return has(method) ||
        has(url) ||
        has(ip) ||
        headers.any { (name, values) -> has(name) || values.any(::has) } ||
        query?.let { queryTexts(it).any(::has) } == true ||
        has(content)
}

/** Nomes e valores da query em qualquer nível: o PHP guarda `a[b]=1` como objeto dentro de objeto. */
private fun queryTexts(node: JsonNode): Sequence<String> =
    when {
        node.isObject -> node.properties().asSequence().flatMap { (name, value) -> sequenceOf(name) + queryTexts(value) }
        node.isArray -> node.asSequence().flatMap(::queryTexts)
        node.isNull -> emptySequence()
        else -> sequenceOf(node.asString())
    }
