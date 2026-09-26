package site.webhook.cli

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpRequest.BodyPublishers
import java.net.http.HttpResponse
import java.net.http.HttpResponse.BodyHandlers
import java.time.Duration
import java.util.stream.Stream

private const val OK = 200
private const val CREATED = 201
private const val UNAUTHORIZED = 401
private const val NOT_FOUND = 404
private const val GONE = 410
private const val UNPROCESSABLE = 422
private const val TOO_MANY_REQUESTS = 429

/** Cabeçalho com o segredo de leitura de uma URL protegida. */
const val SECRET_HEADER = "X-Webhook-Secret"

/** O que `GET /token/{id}` diz de uma URL, com o segredo que o CLI tem (ou nenhum). */
enum class TokenAccess {
    OPEN,

    /** 401: a URL é protegida e o segredo faltou ou está errado. */
    PROTECTED,

    /** 429: segredos errados demais na URL no último minuto. */
    LIMITED,
    NOT_FOUND,
}

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

/** Resposta 200 do `POST /token/{id}/requests/wait`; [requests] são as mensagens como a API as devolve. */
@Serializable
data class WaitResult(
    val matched: Boolean,
    val count: Int,
    val requests: JsonArray,
    @SerialName("near_miss") val nearMiss: NearMiss? = null,
)

/** A mensagem que chegou mais perto de casar e uma frase por condição que falhou. */
@Serializable
data class NearMiss(
    val uuid: RequestId,
    val seq: Long,
    val failed: List<String>,
)

/** O que o `POST /token/{id}/requests/wait` respondeu. */
sealed interface WaitAnswer {
    data class Answered(
        val result: WaitResult,
    ) : WaitAnswer

    /** 422: chave em notação de ponto (`match.path.regex`, `count`) → mensagens. */
    data class Invalid(
        val errors: Map<String, List<String>>,
    ) : WaitAnswer

    data object TokenNotFound : WaitAnswer
}

/**
 * A API do webhook.site que o CLI usa; nada além dela. Com [readSecret], toda chamada leva o [SECRET_HEADER]: numa URL
 * protegida é ele que dá acesso (numa aberta, o servidor o ignora). O segredo só sai neste cabeçalho.
 */
@Suppress("TooManyFunctions") // uma função por rota da API que o CLI chama, mais o envio e a leitura de status
class WebhookServer(
    server: String,
    private val http: HttpClient,
    private val readSecret: String? = null,
) {
    val base: String = server.trimEnd('/')

    /** `GET /token/{id}`: se a URL existe e se o segredo (ou a falta dele) dá acesso. */
    fun access(token: TokenId): TokenAccess {
        val response = send("GET", "/token/$token")
        return when (response.statusCode()) {
            OK -> TokenAccess.OPEN
            UNAUTHORIZED -> TokenAccess.PROTECTED
            TOO_MANY_REQUESTS -> TokenAccess.LIMITED
            NOT_FOUND, GONE -> TokenAccess.NOT_FOUND
            else -> throw unexpected(response)
        }
    }

    /** `POST /token`: uma URL nova, com a resposta padrão. */
    fun createToken(): TokenId {
        val response = send("POST", "/token")
        if (response.statusCode() != CREATED) throw unexpected(response)
        return apiJson.decodeFromString<NewToken>(response.body()).uuid
    }

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

    /** `POST /token/{id}/requests/wait`: long-poll com [wait] no corpo; [httpTimeout] é o prazo da resposta HTTP. */
    fun waitFor(
        token: TokenId,
        wait: JsonObject,
        httpTimeout: Duration,
    ): WaitAnswer {
        val response = send("POST", "/token/$token/requests/wait", wait.toString(), httpTimeout)
        return when (response.statusCode()) {
            OK -> WaitAnswer.Answered(apiJson.decodeFromString<WaitResult>(response.body()))
            UNPROCESSABLE -> WaitAnswer.Invalid(apiJson.decodeFromString<Map<String, List<String>>>(response.body()))
            NOT_FOUND, GONE -> WaitAnswer.TokenNotFound
            else -> throw unexpected(response)
        }
    }

    /**
     * Assina o SSE do token: as linhas do `text/event-stream`, já com a assinatura registrada no
     * servidor (ele só manda o status depois de registrar). `null` quando o token não existe ou deixou de dar
     * acesso (401: o segredo foi trocado com o `listen` rodando).
     */
    fun subscribe(token: TokenId): Stream<String>? {
        val request =
            HttpRequest
                .newBuilder(URI.create("$base/token/$token/stream"))
                .header("Accept", "text/event-stream")
                .withSecret()
                .build()
        val response = http.send(request, BodyHandlers.ofLines())
        if (response.statusCode() == OK) return response.body()
        response.body().close()
        if (response.statusCode() in setOf(UNAUTHORIZED, NOT_FOUND, GONE)) return null
        throw unexpected(response)
    }

    /** Com [json], o corpo vai em UTF-8 com `Content-Type: application/json`; sem [timeout], sem prazo de resposta. */
    private fun send(
        method: String,
        path: String,
        json: String? = null,
        timeout: Duration? = null,
    ): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI.create(base + path)).withSecret()
        if (timeout != null) request.timeout(timeout)
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

    private fun HttpRequest.Builder.withSecret(): HttpRequest.Builder {
        val secret = readSecret ?: return this
        return header(SECRET_HEADER, secret)
    }
}
