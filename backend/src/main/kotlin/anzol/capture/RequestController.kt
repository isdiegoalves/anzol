package anzol.capture

import anzol.RequestId
import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.http.legacyInput
import anzol.http.validationFailure
import anzol.rules.Parsed
import anzol.token.TokenStore
import anzol.token.findOrGone
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpHeaders
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.nio.charset.StandardCharsets.UTF_8

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
    private val listing: RequestListing,
) {
    /** `RequestController::all`; ver [RequestListing.list]. */
    @GetMapping("/requests")
    fun all(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> =
        when (val page = listing.list(tokenId, request.legacyInput().query)) {
            is Parsed.Valid -> ResponseEntity.ok(page.value)
            is Parsed.Invalid -> request.validationFailure(page.errors)
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
}
