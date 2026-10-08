package anzol.capture

import anzol.RequestId
import anzol.TIMESTAMP_PATTERN
import anzol.TokenId
import anzol.e2ee.DecryptionResult
import anzol.e2ee.ExactJsonDeserializer
import anzol.rules.Fault
import anzol.rules.NearMiss
import anzol.rules.RuleRef
import anzol.schema.SchemaResult
import anzol.signature.SignatureResult
import com.fasterxml.jackson.annotation.JsonFormat
import com.fasterxml.jackson.annotation.JsonIgnore
import com.fasterxml.jackson.annotation.JsonInclude
import tools.jackson.databind.JsonNode
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonDeserialize
import tools.jackson.databind.annotation.JsonNaming
import java.time.LocalDateTime

/**
 * Mensagem gravada em `token:{uuid}:requests`, no formato de `Storage/Request.php`.
 *
 * `query` e `request` são arrays do PHP (lista ou objeto). `request` tem três estados: ausente
 * (Kotlin `null`, requisição JSON), `null` no JSON (`NullNode`, sem campos) ou os campos.
 *
 * `rule` e `near_miss` (regras de resposta), `signature` (verificação HMAC) e `schema` (validação do corpo)
 * são gravados sempre, nulos quando não se aplicam; mensagem gravada antes deles os lê como `null`. `response` é o que
 * a URL respondeu ([RecordedResponse]), gravado sempre; mensagem gravada antes dele o lê como `null`. `decryption` é o
 * resultado da decifra do atributo (nulo sem `e2ee` na URL) e `decrypted`, o atributo aberto, só quando válido.
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
    val response: RecordedResponse? = null,
    val decryption: DecryptionResult? = null,
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    @field:JsonDeserialize(using = ExactJsonDeserializer::class)
    val decrypted: JsonNode? = null,
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val seq: Long? = null,
) {
    /** `Storage/Request::isJson()`: só o Content-Type exatamente `application/json`. */
    @JsonIgnore
    fun isJson(): Boolean = headers["content-type"]?.firstOrNull() == "application/json"
}

/**
 * `response` da mensagem: o que a URL respondeu, conhecido antes de responder. O [status] dado (da regra ou da resposta
 * padrão), ou a [fault] da regra que derrubou a conexão; no JSON, só a chave que se aplica.
 */
data class RecordedResponse(
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val status: Int? = null,
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val fault: Fault? = null,
)

enum class Sorting {
    OLDEST,
    NEWEST,
    ;

    companion object {
        fun of(value: Any?): Sorting = if (value == "newest") NEWEST else OLDEST
    }
}
