package site.webhook.token

import com.fasterxml.jackson.annotation.JsonFormat
import site.webhook.TIMESTAMP_PATTERN
import site.webhook.TokenId
import site.webhook.signature.SignatureConfig
import site.webhook.signature.SignatureDraft
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.time.LocalDateTime

/** JSON de `token:{uuid}`, campo a campo e na ordem de `Storage/Token.php::createFromRequest`. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class Token(
    val uuid: TokenId,
    val ip: String?,
    val userAgent: String?,
    val defaultContent: String,
    val defaultStatus: Long,
    val defaultContentType: String,
    val timeout: Long,
    val cors: Boolean = false,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val createdAt: LocalDateTime,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val updatedAt: LocalDateTime,
    /** Campos novos ficam no fim; token gravado antes deles lê `null`. */
    val retryAfter: RetryAfter? = null,
    val autoCleanup: AutoCleanup? = null,
    val signature: SignatureConfig? = null,
) {
    /**
     * `PUT /token/{id}`: troca a resposta configurada; `updated_at` fica como está, como no app antigo. A
     * assinatura já vem resolvida contra a atual (ver `SignatureDraft.resolve`).
     */
    fun withSettings(
        settings: TokenSettings,
        signature: SignatureConfig?,
    ): Token =
        copy(
            defaultContent = settings.defaultContent,
            defaultStatus = settings.defaultStatus,
            defaultContentType = settings.defaultContentType,
            timeout = settings.timeout,
            retryAfter = settings.retryAfter,
            autoCleanup = settings.autoCleanup,
            signature = signature,
        )

    /** O token como a API o devolve: o segredo da assinatura mascarado. */
    fun forApi(): Token = copy(signature = signature?.masked())
}

/** Os campos que o cliente escolhe na criação e na edição. */
data class TokenSettings(
    val defaultContent: String,
    val defaultStatus: Long,
    val defaultContentType: String,
    val timeout: Long,
    val retryAfter: RetryAfter?,
    val autoCleanup: AutoCleanup?,
    val signature: SignatureDraft?,
)

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class CorsState(
    val enabled: Boolean,
)
