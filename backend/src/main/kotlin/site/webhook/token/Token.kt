package site.webhook.token

import com.fasterxml.jackson.annotation.JsonFormat
import site.webhook.TIMESTAMP_PATTERN
import site.webhook.TokenId
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
) {
    /** `PUT /token/{id}`: troca a resposta configurada; `updated_at` fica como está, como no app antigo. */
    fun withSettings(settings: TokenSettings): Token =
        copy(
            defaultContent = settings.defaultContent,
            defaultStatus = settings.defaultStatus,
            defaultContentType = settings.defaultContentType,
            timeout = settings.timeout,
            retryAfter = settings.retryAfter,
            autoCleanup = settings.autoCleanup,
        )
}

/** Os campos que o cliente escolhe na criação e na edição. */
data class TokenSettings(
    val defaultContent: String,
    val defaultStatus: Long,
    val defaultContentType: String,
    val timeout: Long,
    val retryAfter: RetryAfter?,
    val autoCleanup: AutoCleanup?,
)

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class CorsState(
    val enabled: Boolean,
)
