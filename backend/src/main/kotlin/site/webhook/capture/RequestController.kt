package site.webhook.capture

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import site.webhook.RequestId
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.http.legacyInput
import site.webhook.http.validationFailure
import site.webhook.legacy.isPhpInteger
import site.webhook.legacy.phpIntval
import site.webhook.legacy.phpNumericSize
import site.webhook.token.Token
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.nio.charset.StandardCharsets.UTF_8

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

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class RequestPage(
    val data: List<CapturedRequest>,
    val total: Long,
    val perPage: Long,
    val currentPage: Long,
    val isLastPage: Boolean,
    val from: Long,
    val to: Long,
)

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class DeletionResult(
    val status: Boolean,
)

@RestController
@RequestMapping("/token/{tokenId:$UUID_PATTERN}")
class RequestController(
    private val tokens: TokenStore,
    private val requests: RequestStore,
) {
    /**
     * `RequestController::all`, com a aritmética de `from`/`to` do PHP (inclusive além do fim).
     * Com `after=<seq>`, a listagem incremental: `page` e `sorting` são ignorados.
     */
    @GetMapping("/requests")
    fun all(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val query = request.legacyInput().query
        val after = query["after"]?.takeUnless { it is String && it.isBlank() }
        val errors = validateAfter(after)
        if (errors.isNotEmpty()) return request.validationFailure(errors)
        val token = tokens.findOrGone(tokenId)
        val perPage = query["per_page"]?.let(::phpIntval) ?: DEFAULT_PER_PAGE
        val page =
            if (after == null) {
                page(token, page = query["page"]?.let(::phpIntval) ?: 1, perPage = perPage, sorting = Sorting.of(query["sorting"]))
            } else {
                after(token, after = phpIntval(after), perPage = perPage)
            }
        return ResponseEntity.ok(page)
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

    @GetMapping("/request/{requestId:$UUID_PATTERN}")
    fun find(
        @PathVariable tokenId: TokenId,
        @PathVariable requestId: RequestId,
    ): CapturedRequest = requests.findOrNotFound(tokens.findOrGone(tokenId), requestId)

    /** Corpo cru; `application/json` só quando o Content-Type gravado é exatamente esse. */
    @GetMapping("/request/{requestId:$UUID_PATTERN}/raw")
    fun raw(
        @PathVariable tokenId: TokenId,
        @PathVariable requestId: RequestId,
    ): ResponseEntity<ByteArray> {
        val captured = requests.findOrNotFound(tokens.findOrGone(tokenId), requestId)
        val contentType = if (captured.isJson()) "application/json" else "text/plain; charset=UTF-8"
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, contentType).body(captured.content.toByteArray(UTF_8))
    }

    @DeleteMapping("/request/{requestId:$UUID_PATTERN}")
    fun delete(
        @PathVariable tokenId: TokenId,
        @PathVariable requestId: RequestId,
    ): DeletionResult {
        val token = tokens.findOrGone(tokenId)
        return DeletionResult(status = requests.delete(token, requests.findOrNotFound(token, requestId)))
    }

    @DeleteMapping("/request")
    fun deleteAll(
        @PathVariable tokenId: TokenId,
    ): DeletionResult = DeletionResult(status = requests.deleteAll(tokens.findOrGone(tokenId)))

    private fun RequestStore.findOrNotFound(
        token: Token,
        id: RequestId,
    ): CapturedRequest = find(token, id) ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Request not found")
}
