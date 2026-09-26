package site.webhook.cli

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray
import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpRequest.BodyPublishers
import java.net.http.HttpResponse
import java.net.http.HttpResponse.BodyHandlers
import java.util.stream.Stream

private const val OK = 200
private const val CREATED = 201
private const val NOT_FOUND = 404
private const val GONE = 410
private const val UNPROCESSABLE = 422

@Serializable
private data class NewToken(
    val uuid: TokenId,
)

/** O que o `PUT /token/{id}/rules` respondeu. */
sealed interface RulesReplaced {
    /** Lista salva com [count] regras. */
    data class Saved(
        val count: Int,
    ) : RulesReplaced

    /** 422: chave em notação de ponto a partir da lista (`0.match.path.regex`, `rules`) → mensagens. */
    data class Invalid(
        val errors: Map<String, List<String>>,
    ) : RulesReplaced

    data object TokenNotFound : RulesReplaced
}

/** A API do webhook.site que o CLI usa; nada além dela. */
class WebhookServer(
    server: String,
    private val http: HttpClient,
) {
    val base: String = server.trimEnd('/')

    /** `POST /token`: uma URL nova, com a resposta padrão. */
    fun createToken(): TokenId {
        val response = send("POST", "/token")
        if (response.statusCode() != CREATED) throw unexpected(response)
        return apiJson.decodeFromString<NewToken>(response.body()).uuid
    }

    /** `GET /token/{id}`: 410 quando não existe (404 quando o id nem é uuid). */
    fun exists(token: TokenId): Boolean = found(send("GET", "/token/$token")) != null

    /** `GET /token/{id}/request/{rid}`: a mensagem inteira; `null` quando ela ou o token não existem. */
    fun find(
        token: TokenId,
        id: RequestId,
    ): CapturedRequest? = found(send("GET", "/token/$token/request/$id"))?.let { apiJson.decodeFromString<CapturedRequest>(it) }

    /**
     * `GET /token/{id}/requests?sorting=newest&per_page=1`: o `seq` da mensagem mais nova, 0 sem
     * mensagens; `null` quando o token não existe.
     */
    fun newestSeq(token: TokenId): Long? =
        found(send("GET", "/token/$token/requests?sorting=newest&per_page=1"))?.let {
            apiJson
                .decodeFromString<RequestPage>(it)
                .data
                .firstOrNull()
                ?.seq ?: 0
        }

    /**
     * `GET /token/{id}/requests?after=<seq>&per_page=n`: até [perPage] mensagens com `seq` maior que
     * [seq], na ordem do índice; `null` quando o token não existe.
     */
    fun after(
        token: TokenId,
        seq: Long,
        perPage: Int,
    ): RequestPage? =
        found(send("GET", "/token/$token/requests?after=$seq&per_page=$perPage"))?.let { apiJson.decodeFromString<RequestPage>(it) }

    /** `GET /token/{id}/rules`: a lista como o servidor a guarda; `null` quando o token não existe. */
    fun rules(token: TokenId): JsonArray? = found(send("GET", "/token/$token/rules"))?.let { apiJson.parseToJsonElement(it).jsonArray }

    /** `PUT /token/{id}/rules`: troca a lista inteira da URL por [rules] (o servidor valida). */
    fun replaceRules(
        token: TokenId,
        rules: JsonElement,
    ): RulesReplaced {
        val response = send("PUT", "/token/$token/rules", rules.toString())
        return when (response.statusCode()) {
            OK -> RulesReplaced.Saved(apiJson.parseToJsonElement(response.body()).jsonArray.size)
            UNPROCESSABLE -> RulesReplaced.Invalid(apiJson.decodeFromString<Map<String, List<String>>>(response.body()))
            NOT_FOUND, GONE -> RulesReplaced.TokenNotFound
            else -> throw unexpected(response)
        }
    }

    /**
     * Assina o SSE do token: as linhas do `text/event-stream`, já com a assinatura registrada no
     * servidor (ele só manda o status depois de registrar). `null` quando o token não existe.
     */
    fun subscribe(token: TokenId): Stream<String>? {
        val request = HttpRequest.newBuilder(URI.create("$base/token/$token/stream")).header("Accept", "text/event-stream").build()
        val response = http.send(request, BodyHandlers.ofLines())
        if (response.statusCode() == OK) return response.body()
        response.body().close()
        if (response.statusCode() in setOf(NOT_FOUND, GONE)) return null
        throw unexpected(response)
    }

    /** Com [json], o corpo vai em UTF-8 com `Content-Type: application/json`. */
    private fun send(
        method: String,
        path: String,
        json: String? = null,
    ): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI.create(base + path))
        if (json == null) {
            request.method(method, BodyPublishers.noBody())
        } else {
            request.method(method, BodyPublishers.ofString(json)).header("Content-Type", "application/json")
        }
        return http.send(request.build(), BodyHandlers.ofString())
    }

    /** Corpo do 200; `null` no 404/410 (não existe); qualquer outro status é falha do servidor. */
    private fun found(response: HttpResponse<String>): String? =
        when (response.statusCode()) {
            OK -> response.body()
            NOT_FOUND, GONE -> null
            else -> throw unexpected(response)
        }

    private fun unexpected(response: HttpResponse<*>) = IOException("${response.uri()} answered ${response.statusCode()}")
}
