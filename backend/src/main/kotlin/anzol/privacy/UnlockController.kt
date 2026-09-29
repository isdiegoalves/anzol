package anzol.privacy

import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.http.PHP_DEFAULT_CONTENT_TYPE
import anzol.http.requireJsonObject
import anzol.telemetry.AnzolTelemetry
import anzol.token.Token
import anzol.token.TokenStore
import anzol.token.findOrGone
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseCookie
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Duration

/** Erro do unlock com o segredo errado; nunca repete o que veio. */
data class UnlockError(
    val error: String,
)

/**
 * Desbloqueio de uma URL protegida no navegador: o segredo certo vira o cookie [ACCESS_COOKIE] (`HttpOnly`,
 * `SameSite=Strict`, `Path=/token/{id}`, 30 dias, `Secure` em HTTPS), que dá acesso a toda rota da URL, inclusive ao
 * SSE, sem o segredo ficar no JavaScript. Os 30 dias valem também no servidor (o dia de emissão vai assinado no valor).
 * As duas rotas são as únicas da URL abertas sem acesso ([WithoutReadAccess]).
 */
@RestController
@RequestMapping("/token/{tokenId:$UUID_PATTERN}")
class UnlockController(
    private val tokens: TokenStore,
    private val access: ReadAccess,
    private val telemetry: AnzolTelemetry,
) {
    /**
     * `{"secret": "..."}`. Certo: 204 com o cookie. Errado: 401. Acima de 10 falhas no minuto (somando cabeçalho e
     * MCP): 429 com `Retry-After`. Sem `secret` em texto: 422. Corpo JSON que não é objeto: 400. URL sem proteção:
     * 204 sem cookie (não há o que desbloquear). URL inexistente: 410.
     */
    @WithoutReadAccess
    @PostMapping("/unlock")
    fun unlock(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        return when (val secret = request.requireJsonObject().inputBag()["secret"]) {
            null, "" -> unprocessable("The secret field is required.")
            !is String -> unprocessable("The secret must be a string.")
            else -> if (token.isProtected()) answer(request, token, access.verify(token, secret)) else noContent()
        }
    }

    private fun answer(
        request: HttpServletRequest,
        token: Token,
        result: Access,
    ): ResponseEntity<Any> =
        when (result) {
            Access.Granted -> {
                telemetry.unlock("ok")
                ResponseEntity
                    .noContent()
                    .header(HttpHeaders.SET_COOKIE, cookie(request, token.uuid, access.cookieValue(token)))
                    .header(HttpHeaders.CONTENT_TYPE, PHP_DEFAULT_CONTENT_TYPE)
                    .build()
            }

            Access.Denied -> {
                telemetry.unlock("wrong")
                ResponseEntity.status(HttpStatus.UNAUTHORIZED).contentType(MediaType.APPLICATION_JSON).body(UnlockError("Wrong secret"))
            }

            is Access.Limited -> {
                telemetry.unlock("limited")
                ResponseEntity
                    .status(HttpStatus.TOO_MANY_REQUESTS)
                    .header(HttpHeaders.RETRY_AFTER, result.retryAfterSeconds.toString())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(TOO_MANY_ATTEMPTS_BODY)
            }
        }

    /** Apaga o cookie desta URL. Sempre 204, exista a URL ou não. */
    @WithoutReadAccess
    @PostMapping("/lock")
    fun lock(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> =
        ResponseEntity
            .noContent()
            .header(HttpHeaders.SET_COOKIE, cookie(request, tokenId, value = "", maxAge = Duration.ZERO))
            .header(HttpHeaders.CONTENT_TYPE, PHP_DEFAULT_CONTENT_TYPE)
            .build()

    private fun noContent(): ResponseEntity<Any> =
        ResponseEntity.noContent().header(HttpHeaders.CONTENT_TYPE, PHP_DEFAULT_CONTENT_TYPE).build()

    private fun unprocessable(message: String): ResponseEntity<Any> =
        ResponseEntity.unprocessableContent().contentType(MediaType.APPLICATION_JSON).body(mapOf("secret" to listOf(message)))
}

/** O cookie da URL; `Secure` quando a requisição chegou em HTTPS (direto ou por um proxy que diz `X-Forwarded-Proto`). */
private fun cookie(
    request: HttpServletRequest,
    tokenId: TokenId,
    value: String,
    maxAge: Duration = ACCESS_COOKIE_MAX_AGE,
): String =
    ResponseCookie
        .from(ACCESS_COOKIE, value)
        .path("/token/$tokenId")
        .httpOnly(true)
        .sameSite("Strict")
        .secure(request.isSecure || request.getHeader("X-Forwarded-Proto").equals("https", ignoreCase = true))
        .maxAge(maxAge)
        .build()
        .toString()
