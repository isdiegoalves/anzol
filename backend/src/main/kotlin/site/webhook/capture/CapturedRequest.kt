package site.webhook.capture

import com.fasterxml.jackson.annotation.JsonFormat
import com.fasterxml.jackson.annotation.JsonIgnore
import com.fasterxml.jackson.annotation.JsonInclude
import site.webhook.RequestId
import site.webhook.TIMESTAMP_PATTERN
import site.webhook.TokenId
import site.webhook.rules.NearMiss
import site.webhook.rules.RuleRef
import site.webhook.schema.SchemaResult
import site.webhook.signature.SignatureResult
import tools.jackson.databind.JsonNode
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.time.LocalDateTime

/**
 * Mensagem gravada em `token:{uuid}:requests`, no formato de `Storage/Request.php`.
 *
 * `query` e `request` são arrays do PHP (lista ou objeto). `request` tem três estados: ausente
 * (Kotlin `null`, requisição JSON), `null` no JSON (`NullNode`, sem campos) ou os campos.
 *
 * `rule` e `near_miss` (regras de resposta), `signature` (verificação HMAC) e `schema` (validação do corpo)
 * são gravados sempre, nulos quando não se aplicam; mensagem gravada antes deles os lê como `null`.
 *
 * `seq` é o score da mensagem no índice (estritamente crescente por URL): anexado quando a mensagem
 * sai do Redis (listagem, `GET`, evento) e nunca gravado na hash, que guarda o formato do app antigo.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class CapturedRequest(
    val uuid: RequestId,
    val tokenId: TokenId,
    val ip: String?,
    val hostname: String,
    val method: String,
    val userAgent: String?,
    val content: String,
    val query: JsonNode?,
    val headers: Map<String, List<String>>,
    val url: String,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val createdAt: LocalDateTime,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val updatedAt: LocalDateTime,
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val request: JsonNode? = null,
    val rule: RuleRef? = null,
    val nearMiss: NearMiss? = null,
    val signature: SignatureResult? = null,
    val schema: SchemaResult? = null,
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val seq: Long? = null,
) {
    /** `Storage/Request::isJson()`: só o Content-Type exatamente `application/json`. */
    @JsonIgnore
    fun isJson(): Boolean = headers["content-type"]?.firstOrNull() == "application/json"
}

enum class Sorting {
    OLDEST,
    NEWEST,
    ;

    companion object {
        fun of(value: Any?): Sorting = if (value == "newest") NEWEST else OLDEST
    }
}
