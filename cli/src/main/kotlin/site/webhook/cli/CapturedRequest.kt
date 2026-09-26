package site.webhook.cli

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

@Serializable
@JvmInline
value class TokenId(
    val value: String,
) {
    override fun toString(): String = value
}

@Serializable
@JvmInline
value class RequestId(
    val value: String,
) {
    override fun toString(): String = value
}

/**
 * Mensagem gravada, como a API devolve (`GET /token/{id}/request/{rid}`) e o evento
 * `request.created` traz. Só os campos que o reenvio usa; `url` é a URL inteira recebida pelo
 * webhook.site, com o caminho cru e a query normalizada.
 */
@Serializable
data class CapturedRequest(
    val uuid: RequestId,
    val method: String,
    val url: String,
    @SerialName("created_at") val createdAt: String,
    val content: String = "",
    val headers: Map<String, List<String>> = emptyMap(),
    val request: JsonElement? = null,
)

/** `data:` do evento `request.created`; truncado, `request` vem sem `content` e `headers`. */
@Serializable
data class RequestCreated(
    val request: CapturedRequest,
    val truncated: Boolean = false,
)

val apiJson = Json { ignoreUnknownKeys = true }
