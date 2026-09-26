package site.webhook.token

import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.http.PHP_DEFAULT_CONTENT_TYPE
import site.webhook.http.legacyInput
import site.webhook.http.validationFailure
import site.webhook.rules.Parsed
import java.time.Clock
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

/** Ausência do token vira 410, como `Storage/Redis/TokenStore::find`. */
fun TokenStore.findOrGone(id: TokenId): Token = find(id) ?: throw ResponseStatusException(HttpStatus.GONE, "Token not found")

/** Hora do app antigo: UTC com resolução de segundo, como o `created_at` gravado. */
fun Instant.toLegacyDateTime(): LocalDateTime = LocalDateTime.ofInstant(this, ZoneOffset.UTC).truncatedTo(ChronoUnit.SECONDS)

fun Clock.legacyNow(): LocalDateTime = instant().toLegacyDateTime()

@RestController
@RequestMapping("/token")
class TokenController(
    private val tokens: TokenStore,
    private val service: TokenService,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @PostMapping
    fun create(request: HttpServletRequest): ResponseEntity<Any> =
        when (val created = service.create(request.legacyInput(), ip = request.remoteAddr, userAgent = request.getHeader("User-Agent"))) {
            is Parsed.Valid -> ResponseEntity.status(HttpStatus.CREATED).body(created.value.forApi())
            is Parsed.Invalid -> request.validationFailure(created.errors)
        }

    @GetMapping("/{tokenId:$UUID_PATTERN}")
    fun find(
        @PathVariable tokenId: TokenId,
    ): TokenView = tokens.findOrGone(tokenId).forApi()

    @DeleteMapping("/{tokenId:$UUID_PATTERN}")
    fun delete(
        @PathVariable tokenId: TokenId,
    ): ResponseEntity<Unit> {
        service.delete(tokenId)
        return ResponseEntity.noContent().header(HttpHeaders.CONTENT_TYPE, PHP_DEFAULT_CONTENT_TYPE).build()
    }

    @PutMapping("/{tokenId:$UUID_PATTERN}")
    fun update(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> =
        when (val updated = service.update(tokenId, request.legacyInput())) {
            is Parsed.Valid -> ResponseEntity.ok(updated.value.forApi())
            is Parsed.Invalid -> request.validationFailure(updated.errors)
        }

    /** Liga e desliga. O app antigo só ligava (`isset` em atributo mágico); o contrato exige o toggle real. */
    @PutMapping("/{tokenId:$UUID_PATTERN}/cors/toggle")
    fun toggleCors(
        @PathVariable tokenId: TokenId,
    ): CorsState {
        val token = tokens.findOrGone(tokenId).let { it.copy(cors = !it.cors) }
        tokens.store(token)
        log.info("[CORS] {} toggle", tokenId)
        return CorsState(enabled = token.cors)
    }
}
