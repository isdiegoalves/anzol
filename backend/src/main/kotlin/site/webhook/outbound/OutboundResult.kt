package site.webhook.outbound

import com.fasterxml.jackson.annotation.JsonFormat
import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonValue
import site.webhook.RequestId
import site.webhook.TIMESTAMP_PATTERN
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.time.LocalDateTime
import java.util.UUID

/** Por que a saída não teve resposta do alvo (§1): nenhum destes é erro da API, que responde 200. */
enum class ErrorKind(
    @get:JsonValue val id: String,
) {
    BLOCKED("blocked"),
    DNS("dns"),
    CONNECT("connect"),
    TIMEOUT("timeout"),
    TLS("tls"),
    INVALID_URL("invalid_url"),
}

data class OutboundError(
    val kind: ErrorKind,
    val message: String,
)

enum class OutboundKind(
    @get:JsonValue val id: String,
) {
    REPLAY("replay"),
    SEND("send"),
}

/**
 * Um replay ou send, como a chamada devolve e `token:{id}:outbound` guarda. Com [error] não há resposta
 * ([status], [headers], [body] e [truncated] ficam de fora); [sourceRequest] só no replay; [chaos] só no replay pedido
 * com caos, e com o corpo cortado ou a desistência injetados não há resposta nem [error].
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
@JsonInclude(JsonInclude.Include.NON_NULL)
data class OutboundResult(
    val id: UUID,
    val kind: OutboundKind,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val at: LocalDateTime,
    val target: String,
    val method: String,
    val requestHeaders: Map<String, String>,
    val status: Int? = null,
    val headers: Map<String, List<String>>? = null,
    val body: String? = null,
    val truncated: Boolean? = null,
    val durationMs: Long,
    val error: OutboundError? = null,
    val sourceRequest: RequestId? = null,
    val chaos: ChaosReport? = null,
) {
    /** A label `outcome` da métrica: a classe do status, `blocked` ou `error`. */
    fun outcome(): String =
        when {
            status != null -> "${status / STATUS_CLASS}xx"
            error?.kind == ErrorKind.BLOCKED -> "blocked"
            else -> "error"
        }

    private companion object {
        const val STATUS_CLASS = 100
    }
}
