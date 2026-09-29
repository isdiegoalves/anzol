package anzol.http

import anzol.AnzolProperties
import anzol.DEFAULT_ALLOWED_HOSTS
import anzol.privacy.ACCESS_COOKIE
import jakarta.servlet.FilterChain
import jakarta.servlet.ServletRequest
import jakarta.servlet.ServletRequestWrapper
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.server.PathContainer
import org.springframework.http.server.RequestPath
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.net.URI
import java.net.URISyntaxException

/** Em [AnzolProperties.allowedHosts], desliga a conferência de `Host` e `Origin` das rotas de gestão. Inseguro. */
const val ANY_HOST = "*"

/** Primeiro segmento das rotas de gestão (`/token`, `/token/...`, `/share/...`) e do servidor MCP. */
private val MANAGEMENT_ROOTS = setOf("token", "share")
private const val MCP_ROOT = "mcp"

/** `Host`: nome (ou IPv6 entre colchetes) e porta opcional só de dígitos. */
private val HOST_HEADER = Regex("""(\[[0-9a-f:.]+]|[^:\[\]/@\s]+)(?::([0-9]{1,5}))?""")

/** Métodos que não mudam estado: neles o `Origin` não é conferido (só o `Host`). */
private val SAFE_METHODS = setOf("GET", "HEAD", "OPTIONS", "TRACE")

/** Os tipos de corpo que um `<form>` de outra página manda sem preflight. */
private val FORM_CONTENT_TYPES = setOf("application/x-www-form-urlencoded", "multipart/form-data", "text/plain")

private const val HTTP_PORT = 80
private const val HTTPS_PORT = 443

/** Nome e porta de um `Host` (nula quando não vem escrita) ou de um `Origin` (a padrão do esquema quando não vem). */
private data class Authority(
    val name: String,
    val port: Int?,
)

/**
 * Contra DNS rebinding e CSRF, nas rotas de gestão e no `/mcp`:
 * - `Host` fora de [AnzolProperties.allowedHosts] → 403 `{"error":"host not allowed"}` (no rebinding ele chega com
 *   o nome do atacante). Nome da lista sem porta casa qualquer porta; com porta, só ela.
 * - `Origin` presente, nos métodos que mudam estado (no `/mcp`, em todos, como o transporte Streamable HTTP exige), só
 *   passa se apontar para este servidor — mesma porta do `Host` e nome aceito pela lista, como a própria tela, também
 *   aberta por outro nome do loopback — ou se `nome:porta` estiver na lista. Outra porta do mesmo nome é outra origem
 *   (outro app local), e o `SameSite` do cookie não a separa: 403 `{"error":"origin not allowed"}`.
 * - Formulário de navegador: `_method` (que transforma o POST de um `<form>` em PUT ou DELETE) → 403
 *   `{"error":"_method not allowed"}`; corpo de formulário (urlencoded, multipart, `text/plain`) com `Origin` ou com o
 *   cookie de acesso ([ACCESS_COOKIE], que só um navegador manda sozinho) → 403 `{"error":"form not allowed"}`. A tela
 *   só manda JSON. Sem `Origin` e sem o cookie (CLI, scripts), o formulário continua valendo, como no app antigo.
 *
 * Cliente sem `Origin` (CLI, SDKs, agentes) passa pelo `Host`. Com [ANY_HOST] na lista, `Host` e `Origin` das rotas
 * de gestão não são conferidos (o `/mcp` fica com [DEFAULT_ALLOWED_HOSTS]); o formulário continua recusado.
 *
 * A captura (`/{id}/...`) e os arquivos da tela nunca passam por aqui. A rota é reconhecida pelo primeiro segmento
 * como o Spring MVC o casa (decodificado e sem `;parâmetros`), para que `/token;x=1/...` ou `/%74oken/...` não
 * escapem; sobrar para mais caminhos só troca um 404 por 403.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 2)
class AllowedHostFilter(
    properties: AnzolProperties,
) : OncePerRequestFilter() {
    private val configured =
        properties.allowedHosts
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .toSet()
    private val anyHost = ANY_HOST in configured
    private val allowedHosts = configured.takeUnless { it.isEmpty() || anyHost } ?: DEFAULT_ALLOWED_HOSTS.toSet()

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val root = request.firstSegment()
        val isMcp = root == MCP_ROOT
        if (!isMcp && root !in MANAGEMENT_ROOTS) return filterChain.doFilter(request, response)
        val denial = (if (isMcp || !anyHost) request.hostOrOriginDenial(isMcp) else null) ?: request.formDenial()
        if (denial == null) filterChain.doFilter(request, response) else response.forbid(denial)
    }

    private fun HttpServletRequest.hostOrOriginDenial(isMcp: Boolean): String? {
        val origin = getHeader(HttpHeaders.ORIGIN)
        val host = getHeader(HttpHeaders.HOST).orEmpty()
        return when {
            origin != null && (isMcp || changesState()) && !isAllowedOrigin(origin, host, isSecure) -> "origin not allowed"
            !isAllowedHost(host) -> "host not allowed"
            else -> null
        }
    }

    /** `Host` da lista: o nome (com ou sem a porta) está nela. Malformado, como `localhost:8084.evil.test`, não está. */
    private fun isAllowedHost(host: String): Boolean {
        val authority = parseHost(host) ?: return false
        return authority.name in allowedHosts || (authority.port != null && "${authority.name}:${authority.port}" in allowedHosts)
    }

    /**
     * `Origin` deste servidor: mesma porta efetiva do `Host` e nome da lista; ou `nome:porta` na lista. `null` (texto),
     * sem host ou malformado não passa.
     */
    private fun isAllowedOrigin(
        origin: String,
        host: String,
        secure: Boolean,
    ): Boolean {
        val from = parseOrigin(origin) ?: return false
        val to = parseHost(host)
        val toPort = to?.port ?: if (secure) HTTPS_PORT else HTTP_PORT
        return "${from.name}:${from.port}" in allowedHosts || (to != null && from.port == toPort && from.name in allowedHosts)
    }

    private fun HttpServletResponse.forbid(message: String) {
        status = HttpServletResponse.SC_FORBIDDEN
        contentType = MediaType.APPLICATION_JSON_VALUE
        outputStream.write("""{"error":"$message"}""".toByteArray())
    }
}

/**
 * `_method` num POST (o que o [LegacyRequestFilter] aplicaria) ou corpo de formulário com `Origin` ou com o cookie de
 * acesso (um `<form>` que o navegador mandou sem `Origin` ainda leva o cookie): o motivo; senão nulo.
 */
private fun HttpServletRequest.formDenial(): String? {
    val input = getAttribute(LegacyInput.ATTRIBUTE) as? LegacyInput
    val mediaType =
        contentType
            .orEmpty()
            .substringBefore(';')
            .trim()
            .lowercase()
    return when {
        input != null && input.realMethod == "POST" && (input.inputBag()["_method"] != null || input.query["_method"] != null) -> {
            "_method not allowed"
        }

        mediaType in FORM_CONTENT_TYPES && (getHeader(HttpHeaders.ORIGIN) != null || hasAccessCookie()) -> {
            "form not allowed"
        }

        else -> {
            null
        }
    }
}

private fun HttpServletRequest.hasAccessCookie(): Boolean = cookies.orEmpty().any { it.name == ACCESS_COOKIE }

/**
 * O primeiro segmento não vazio do caminho, como o Spring MVC o compara (decodificado, sem `;x=y`), em minúsculas. Só
 * ele é decodificado: a captura aceita `%` solto no resto do caminho. Escape inválido nele fica como veio.
 */
private fun HttpServletRequest.firstSegment(): String? =
    RequestPath
        .parse(requestURI, contextPath)
        .pathWithinApplication()
        .elements()
        .asSequence()
        .filterIsInstance<PathContainer.PathSegment>()
        .map { it.decodedOrRaw() }
        .firstOrNull { it.isNotEmpty() }
        ?.lowercase()

private fun PathContainer.PathSegment.decodedOrRaw(): String =
    try {
        valueToMatch()
    } catch (_: IllegalArgumentException) {
        value()
    }

/**
 * Muda estado se o método efetivo ou o que chegou pela rede não é seguro: o `X-HTTP-Method-Override` (ou `_method`)
 * transforma um POST em outro método, e um POST de outro site é justamente o CSRF.
 */
private fun HttpServletRequest.changesState(): Boolean =
    method.uppercase() !in SAFE_METHODS || originalMethod().uppercase() !in SAFE_METHODS

private fun HttpServletRequest.originalMethod(): String {
    var current: ServletRequest = this
    while (current is ServletRequestWrapper) current = current.request
    return (current as? HttpServletRequest)?.method ?: method
}

/** `Host` como nome e porta; nulo se não tem a forma `nome` ou `nome:dígitos` (IPv6 entre colchetes). */
private fun parseHost(host: String): Authority? {
    val match = HOST_HEADER.matchEntire(host.trim().lowercase()) ?: return null
    val (name, port) = match.destructured
    return Authority(name, port.toIntOrNull())
}

/** `Origin` como nome e porta efetiva (a padrão do esquema); nulo quando é `null`, sem host ou malformado. */
private fun parseOrigin(origin: String): Authority? =
    try {
        val uri = URI(origin.trim())
        val name = uri.host?.lowercase()
        val port = if (uri.port >= 0) uri.port else defaultPort(uri.scheme)
        if (name == null || port == null) null else Authority(name, port)
    } catch (_: URISyntaxException) {
        null
    }

private fun defaultPort(scheme: String?): Int? =
    when (scheme?.lowercase()) {
        "http" -> HTTP_PORT
        "https" -> HTTPS_PORT
        else -> null
    }
