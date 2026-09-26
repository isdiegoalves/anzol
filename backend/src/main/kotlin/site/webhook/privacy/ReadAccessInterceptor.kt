package site.webhook.privacy

import jakarta.servlet.DispatcherType
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.method.HandlerMethod
import org.springframework.web.servlet.HandlerInterceptor
import org.springframework.web.servlet.HandlerMapping
import org.springframework.web.servlet.config.annotation.InterceptorRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.capture.WebhookController
import site.webhook.token.TokenStore
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

/** Corpo do 401 de toda rota de uma URL protegida sem acesso. */
const val PROTECTED_BODY = """{"error":"This URL is protected","protected":true}"""

/** Corpo do 429 do limite de falhas do segredo. */
const val TOO_MANY_ATTEMPTS_BODY = """{"error":"Too many wrong secrets for this URL; try again later"}"""

/** Prefixo das rotas de gestão de uma URL; toda rota com ele tem de ter a variável `tokenId`. */
private const val TOKEN_ROUTES = "/token/{"
private const val TOKEN_VARIABLE = "tokenId"
private val UUID_TEXT = Regex(UUID_PATTERN)

/** Rota de uma URL que responde sem acesso: só o `unlock` (é por ele que se ganha o acesso) e o `lock`. */
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class WithoutReadAccess

/**
 * O controle de acesso das URLs protegidas, em **toda** rota do Spring MVC com a variável `tokenId` (as de
 * `/token/{tokenId}/...`), exceto a captura ([WebhookController], que continua aberta) e as marcadas com
 * [WithoutReadAccess]. É um interceptor, e não um filtro por prefixo de caminho, para que a URL conferida seja a
 * mesma que o Spring casou (`;x=y`, `%74oken`, barra final e o que mais o casamento aceitar). Rota nova herda o
 * controle sem fazer nada; o `ReadAccessCoverageApiTest` percorre todos os mapeamentos para provar.
 *
 * Token inexistente segue para o controller (410 de sempre). Sem acesso: 401 [PROTECTED_BODY]; no limite de falhas,
 * 429 com `Retry-After`. O despacho assíncrono (fim do SSE e do wait) não é conferido de novo: o acesso foi conferido
 * quando a requisição chegou.
 */
@Component
class ReadAccessInterceptor(
    private val tokens: TokenStore,
    private val access: ReadAccess,
) : HandlerInterceptor {
    override fun preHandle(
        request: HttpServletRequest,
        response: HttpServletResponse,
        handler: Any,
    ): Boolean {
        if (request.dispatcherType == DispatcherType.ASYNC || !request.needsAccess(handler)) return true
        return when (val result = request.access()) {
            Access.Granted -> true
            Access.Denied -> response.deny()
            is Access.Limited -> response.limited(result)
        }
    }

    /** Sem `tokenId` válido: negado. URL inexistente: segue (o controller responde o 410 de sempre). */
    private fun HttpServletRequest.access(): Access {
        val id = tokenIdVariable() ?: return Access.Denied
        val token = tokens.find(id)
        return if (token == null) Access.Granted else access.authorize(token, secretHeader(), accessCookies())
    }

    /** Toda rota de handler com `tokenId` (ou em `/token/{...}`), menos a captura e as [WithoutReadAccess]. */
    private fun HttpServletRequest.needsAccess(handler: Any): Boolean {
        val open =
            handler !is HandlerMethod ||
                handler.beanType == WebhookController::class.java ||
                handler.hasMethodAnnotation(WithoutReadAccess::class.java)
        val pattern = getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE)?.toString().orEmpty()
        return !open && (pattern.startsWith(TOKEN_ROUTES) || uriVariables().containsKey(TOKEN_VARIABLE))
    }

    /** O `tokenId` que o Spring extraiu; rota de URL sem ele (ou fora do formato) é negada, nunca liberada. */
    private fun HttpServletRequest.tokenIdVariable(): TokenId? =
        uriVariables()[TOKEN_VARIABLE]?.takeIf { UUID_TEXT.matches(it) }?.let { TokenId(UUID.fromString(it)) }

    @Suppress("UNCHECKED_CAST")
    private fun HttpServletRequest.uriVariables(): Map<String, String> =
        (getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE) as? Map<String, String>).orEmpty()

    private fun HttpServletResponse.deny(): Boolean {
        writeJson(HttpServletResponse.SC_UNAUTHORIZED, PROTECTED_BODY)
        return false
    }

    private fun HttpServletResponse.limited(result: Access.Limited): Boolean {
        setHeader(HttpHeaders.RETRY_AFTER, result.retryAfterSeconds.toString())
        writeJson(TOO_MANY_REQUESTS, TOO_MANY_ATTEMPTS_BODY)
        return false
    }

    private companion object {
        const val TOO_MANY_REQUESTS = 429
    }
}

@Configuration
class ReadAccessConfiguration(
    private val interceptor: ReadAccessInterceptor,
) : WebMvcConfigurer {
    override fun addInterceptors(registry: InterceptorRegistry) {
        registry.addInterceptor(interceptor)
    }
}

/**
 * O segredo do cabeçalho [SECRET_HEADER]. O Tomcat lê cabeçalhos em ISO-8859-1; o segredo foi definido em JSON
 * (UTF-8), então os bytes são relidos como UTF-8 para que um segredo com acento confira.
 */
fun HttpServletRequest.secretHeader(): String? = getHeader(SECRET_HEADER)?.let { String(it.toByteArray(ISO_8859_1), UTF_8) }

/** Todos os cookies [ACCESS_COOKIE] que vieram (o navegador pode mandar mais de um). */
fun HttpServletRequest.accessCookies(): List<String> = cookies.orEmpty().filter { it.name == ACCESS_COOKIE }.map { it.value }

fun HttpServletResponse.writeJson(
    status: Int,
    body: String,
) {
    this.status = status
    contentType = MediaType.APPLICATION_JSON_VALUE
    // Pelo stream, e não pelo writer: sem o `;charset=ISO-8859-1` que o Tomcat acrescentaria.
    outputStream.write(body.toByteArray(UTF_8))
}
