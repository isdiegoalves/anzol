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
import site.webhook.capture.RequestStore
import site.webhook.http.PHP_DEFAULT_CONTENT_TYPE
import site.webhook.http.legacyInput
import site.webhook.http.validationFailure
import site.webhook.signature.MISSING_SECRET
import site.webhook.signature.SignatureConfig
import site.webhook.signature.SignatureDraft
import site.webhook.stream.RequestStream
import java.time.Clock
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.UUID

/** Ausência do token vira 410, como `Storage/Redis/TokenStore::find`. */
fun TokenStore.findOrGone(id: TokenId): Token = find(id) ?: throw ResponseStatusException(HttpStatus.GONE, "Token not found")

/** [save] com a assinatura resolvida contra a atual, ou o 422 quando não há segredo novo nem atual. */
private fun HttpServletRequest.withSignature(
    draft: SignatureDraft?,
    current: SignatureConfig?,
    save: (SignatureConfig?) -> ResponseEntity<Any>,
): ResponseEntity<Any> {
    val resolved = draft?.resolve(current)
    return if (draft != null && resolved == null) validationFailure(MISSING_SECRET) else save(resolved)
}

/** Hora do app antigo: UTC com resolução de segundo, como o `created_at` gravado. */
fun Instant.toLegacyDateTime(): LocalDateTime = LocalDateTime.ofInstant(this, ZoneOffset.UTC).truncatedTo(ChronoUnit.SECONDS)

fun Clock.legacyNow(): LocalDateTime = instant().toLegacyDateTime()

@RestController
@RequestMapping("/token")
class TokenController(
    private val tokens: TokenStore,
    private val requests: RequestStore,
    private val clock: Clock,
    private val stream: RequestStream,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @PostMapping
    fun create(request: HttpServletRequest): ResponseEntity<Any> {
        val input = request.legacyInput()
        val errors = input.validateTokenSettings()
        if (errors.isNotEmpty()) return request.validationFailure(errors)
        val now = clock.legacyNow()
        val settings = input.toTokenSettings()
        return request.withSignature(settings.signature, current = null) { signature ->
            val token =
                Token(
                    uuid = TokenId(UUID.randomUUID()),
                    ip = request.remoteAddr,
                    userAgent = request.getHeader("User-Agent"),
                    defaultContent = settings.defaultContent,
                    defaultStatus = settings.defaultStatus,
                    defaultContentType = settings.defaultContentType,
                    timeout = settings.timeout,
                    cors = false,
                    createdAt = now,
                    updatedAt = now,
                    retryAfter = settings.retryAfter,
                    autoCleanup = settings.autoCleanup,
                    signature = signature,
                )
            ResponseEntity.status(HttpStatus.CREATED).body(tokens.store(token).forApi())
        }
    }

    @GetMapping("/{tokenId:$UUID_PATTERN}")
    fun find(
        @PathVariable tokenId: TokenId,
    ): Token = tokens.findOrGone(tokenId).forApi()

    /** Apagar encerra as esperas do `requests/wait` na URL, com o que já tiverem. */
    @DeleteMapping("/{tokenId:$UUID_PATTERN}")
    fun delete(
        @PathVariable tokenId: TokenId,
    ): ResponseEntity<Unit> {
        tokens.delete(tokens.findOrGone(tokenId))
        stream.end(tokenId)
        return ResponseEntity.noContent().header(HttpHeaders.CONTENT_TYPE, PHP_DEFAULT_CONTENT_TYPE).build()
    }

    /**
     * Validação antes da busca: token inexistente com dado inválido responde 422, como no app antigo.
     * Limite menor corta as mensagens excedentes na hora. Assinatura sem segredo novo mantém o atual; sem
     * nenhum, 422.
     */
    @PutMapping("/{tokenId:$UUID_PATTERN}")
    fun update(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val input = request.legacyInput()
        val errors = input.validateTokenSettings()
        if (errors.isNotEmpty()) return request.validationFailure(errors)
        val current = tokens.findOrGone(tokenId)
        val settings = input.toTokenSettings()
        return request.withSignature(settings.signature, current.signature) { signature ->
            val token = tokens.store(current.withSettings(settings, signature))
            requests.trim(token)
            ResponseEntity.ok(token.forApi())
        }
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
