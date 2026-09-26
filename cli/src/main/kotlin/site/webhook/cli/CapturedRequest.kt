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
 * Mensagem gravada, como a API devolve (`GET /token/{id}/request/{rid}` e a listagem) e o evento
 * `request.created` traz. Só os campos que o reenvio usa; `url` é a URL inteira recebida pelo
 * webhook.site, com o caminho cru e a query normalizada; `seq` é a posição dela no índice do
 * servidor, estritamente crescente por URL.
 */
@Serializable
data class CapturedRequest(
    val uuid: RequestId,
    val seq: Long,
    val method: String,
    val url: String,
    val content: String = "",
    val headers: Map<String, List<String>> = emptyMap(),
    val request: JsonElement? = null,
)

/** `data:` do evento `request.created`; o CLI só usa o `seq` da mensagem (truncada ou não). */
@Serializable
data class RequestCreated(
    val request: CapturedRequest,
)

/** Página de `GET /token/{id}/requests`. */
@Serializable
data class RequestPage(
    val data: List<CapturedRequest>,
    @SerialName("is_last_page") val isLastPage: Boolean,
)

val apiJson = Json { ignoreUnknownKeys = true }
