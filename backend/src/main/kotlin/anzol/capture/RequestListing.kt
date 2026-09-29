package anzol.capture

import anzol.RequestId
import anzol.TokenId
import anzol.legacy.isPhpInteger
import anzol.legacy.phpIntval
import anzol.legacy.phpNumericSize
import anzol.rules.Parsed
import anzol.token.Token
import anzol.token.TokenStore
import anzol.token.findOrGone
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.server.ResponseStatusException

private const val DEFAULT_PER_PAGE = 50L

/** `after` com a regra `integer|min:0` do Laravel 5.4 e as mensagens de `validation.php`; ausente não é validado. */
private fun validateAfter(after: Any?): Map<String, List<String>> {
    if (after == null) return emptyMap()
    val errors =
        listOfNotNull(
            "The after must be an integer.".takeUnless { isPhpInteger(after) },
            "The after must be at least 0.".takeUnless { phpNumericSize(after) >= 0 },
        )
    return if (errors.isEmpty()) emptyMap() else mapOf("after" to errors)
}

/** Mensagem inexistente vira 404, como `RequestController::find`. */
fun RequestStore.findOrNotFound(
    token: Token,
    id: RequestId,
): CapturedRequest = find(token, id) ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Request not found")

/** A listagem do `GET /token/{id}/requests`, para a API HTTP e para as ferramentas do MCP. */
@Component
class RequestListing(
    private val tokens: TokenStore,
    private val requests: RequestStore,
) {
    /**
     * `RequestController::all`, com a aritmética de `from`/`to` do PHP (inclusive além do fim), sobre os
     * parâmetros `page`, `per_page`, `sorting` e `after` da query. Com `after=<seq>`, a listagem incremental:
     * `page` e `sorting` são ignorados. A validação vem antes da busca do token (422 antes do 410).
     */
    fun list(
        tokenId: TokenId,
        query: Map<String, Any?>,
    ): Parsed<RequestPage> {
        val after = query["after"]?.takeUnless { it is String && it.isBlank() }
        val errors = validateAfter(after)
        if (errors.isNotEmpty()) return Parsed.Invalid(errors)
        val token = tokens.findOrGone(tokenId)
        val perPage = query["per_page"]?.let(::phpIntval) ?: DEFAULT_PER_PAGE
        val page =
            if (after == null) {
                page(token, page = query["page"]?.let(::phpIntval) ?: 1, perPage = perPage, sorting = Sorting.of(query["sorting"]))
            } else {
                after(token, after = phpIntval(after), perPage = perPage)
            }
        return Parsed.Valid(page)
    }

    private fun page(
        token: Token,
        page: Long,
        perPage: Long,
        sorting: Sorting,
    ): RequestPage {
        val data = requests.page(token, page = page, perPage = perPage, sorting = sorting)
        val total = requests.count(token)
        val skipped = (page - 1) * perPage
        return RequestPage(
            data = data,
            total = total,
            perPage = perPage,
            currentPage = page,
            isLastPage = data.size + skipped >= total,
            from = skipped + 1,
            to = minOf(total, data.size + skipped),
        )
    }

    /** As mensagens com `seq` maior que [after], em ordem crescente, como se fossem a página 1. */
    private fun after(
        token: Token,
        after: Long,
        perPage: Long,
    ): RequestPage {
        val batch = requests.after(token, after = after, limit = perPage)
        return RequestPage(
            data = batch.messages,
            total = requests.count(token),
            perPage = perPage,
            currentPage = 1,
            isLastPage = !batch.hasMore,
            from = 1,
            to = batch.messages.size.toLong(),
        )
    }
}
