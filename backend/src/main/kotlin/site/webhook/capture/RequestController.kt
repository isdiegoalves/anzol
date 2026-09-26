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
import site.webhook.legacy.phpIntval
import site.webhook.token.Token
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.nio.charset.StandardCharsets.UTF_8

private const val DEFAULT_PER_PAGE = 50L

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
    /** `RequestController::all`, com a aritmética de `from`/`to` do PHP (inclusive além do fim). */
    @GetMapping("/requests")
    fun all(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): RequestPage {
        val token = tokens.findOrGone(tokenId)
        val query = request.legacyInput().query
        val page = query["page"]?.let(::phpIntval) ?: 1
        val perPage = query["per_page"]?.let(::phpIntval) ?: DEFAULT_PER_PAGE
        val data = requests.page(token, page = page, perPage = perPage, sorting = Sorting.of(query["sorting"]))
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
