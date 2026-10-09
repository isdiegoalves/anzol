package anzol.token

import anzol.TIMESTAMP_PATTERN
import anzol.TokenId
import anzol.e2ee.DeletedE2eeKey
import anzol.e2ee.E2eeKey
import anzol.e2ee.E2eeKeyView
import anzol.e2ee.E2eePolicy
import anzol.e2ee.lab.LabMark
import anzol.e2ee.lab.LabView
import anzol.schema.SchemaConfig
import anzol.signature.SignatureConfig
import anzol.signature.SignatureDraft
import com.fasterxml.jackson.annotation.JsonFormat
import com.fasterxml.jackson.annotation.JsonIgnore
import com.fasterxml.jackson.annotation.JsonInclude
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.time.Duration
import java.time.Instant
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
    val schema: SchemaConfig? = null,
    /** Segredo de leitura (PBKDF2); nulo = URL não protegida, como todo token gravado antes dele. */
    val readSecretHash: ReadSecretHash? = null,
    /**
     * Muda a cada troca do segredo (definir, trocar, remover) e nunca volta: o cookie de desbloqueio assina `id:versão`,
     * então trocar invalida os cookies antigos, inclusive os de um segredo removido e definido de novo.
     */
    val secretVersion: Long = 0,
    val e2ee: E2eePolicy? = null,
    /** Pares de cifra (com a privada); gerados e apagados só pelas rotas `keys`, nunca pelo `PUT`. */
    @field:JsonInclude(JsonInclude.Include.NON_EMPTY)
    val e2eeKeys: List<E2eeKey> = emptyList(),
    /** Só na URL de laboratório E2EE; nasce com ela e nenhuma rota a troca. */
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val lab: LabMark? = null,
    /** As chaves de cifra apagadas mais novas: a decifra distingue a chave que a URL apagou da que ela nunca teve. */
    @field:JsonInclude(JsonInclude.Include.NON_EMPTY)
    val e2eeDeletedKeys: List<DeletedE2eeKey> = emptyList(),
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
            schema = settings.schema,
            e2ee = settings.e2ee,
        )

    /** O TTL das chaves da URL: [default], ou o que falta da vida de uma URL de laboratório (que o uso não renova). */
    fun expiry(
        default: Duration,
        now: Instant,
    ): Duration = lab?.remaining(now) ?: default

    /** Sem [JsonIgnore], o Jackson gravaria `protected` no Redis como se fosse campo. */
    @JsonIgnore
    fun isProtected(): Boolean = readSecretHash != null

    /** Aplica a mudança do segredo de leitura; cada mudança efetiva avança [secretVersion]. */
    fun withReadSecret(change: ReadSecretChange): Token =
        when (change) {
            ReadSecretChange.Keep -> this
            ReadSecretChange.Remove -> if (readSecretHash == null) this else copy(readSecretHash = null, secretVersion = secretVersion + 1)
            is ReadSecretChange.Set -> copy(readSecretHash = ReadSecretHash.of(change.secret), secretVersion = secretVersion + 1)
        }

    /** O token como a API o devolve: sem o segredo de leitura (só `protected`) e com o segredo da assinatura mascarado. */
    fun forApi(): TokenView =
        TokenView(
            uuid = uuid,
            ip = ip,
            userAgent = userAgent,
            defaultContent = defaultContent,
            defaultStatus = defaultStatus,
            defaultContentType = defaultContentType,
            timeout = timeout,
            cors = cors,
            createdAt = createdAt,
            updatedAt = updatedAt,
            retryAfter = retryAfter,
            autoCleanup = autoCleanup,
            signature = signature?.masked(),
            schema = schema,
            e2ee = e2ee,
            e2eeKeys = e2eeKeys.map { it.view() },
            lab = lab?.view(),
            protected = isProtected(),
        )
}

/**
 * O JSON do token na API: campo a campo o que a API sempre devolveu, mais `protected`. Lista explícita (e não o
 * [Token] inteiro): campo novo do token só aparece aqui de propósito, então nada gravado para uso interno vaza.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class TokenView(
    val uuid: TokenId,
    val ip: String?,
    val userAgent: String?,
    val defaultContent: String,
    val defaultStatus: Long,
    val defaultContentType: String,
    val timeout: Long,
    val cors: Boolean,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val createdAt: LocalDateTime,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val updatedAt: LocalDateTime,
    val retryAfter: RetryAfter?,
    val autoCleanup: AutoCleanup?,
    val signature: SignatureConfig?,
    val schema: SchemaConfig?,
    val e2ee: E2eePolicy?,
    val e2eeKeys: List<E2eeKeyView>,
    val lab: LabView?,
    val protected: Boolean,
)

/** Os campos que o cliente escolhe na criação e na edição. */
data class TokenSettings(
    val defaultContent: String,
    val defaultStatus: Long,
    val defaultContentType: String,
    val timeout: Long,
    val retryAfter: RetryAfter?,
    val autoCleanup: AutoCleanup?,
    val signature: SignatureDraft?,
    val schema: SchemaConfig?,
    val e2ee: E2eePolicy? = null,
    val readSecret: ReadSecretChange = ReadSecretChange.Keep,
)

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class CorsState(
    val enabled: Boolean,
)
