package site.webhook.http

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
import site.webhook.WebhookProperties
import java.net.URI
import java.net.URISyntaxException

/** O `/mcp` sem [WebhookProperties.allowedHosts]: continua conferido, só com o loopback e o host do Docker. */
private val MCP_DEFAULT_HOSTS = setOf("localhost", "127.0.0.1", "[::1]", "host.docker.internal")

/** Primeiro segmento das rotas de gestão (`/token`, `/token/...`, `/share/...`) e do servidor MCP. */
private val MANAGEMENT_ROOTS = setOf("token", "share")
private const val MCP_ROOT = "mcp"

/** `Host`: nome (ou IPv6 entre colchetes) e porta opcional só de dígitos. */
private val HOST_HEADER = Regex("""(\[[0-9a-f:.]+]|[^:\[\]/@\s]+)(?::([0-9]{1,5}))?""")

/** Métodos que não mudam estado: neles o `Origin` não é conferido (só o `Host`). */
private val SAFE_METHODS = setOf("GET", "HEAD", "OPTIONS", "TRACE")

/**
 * Contra DNS rebinding e CSRF, nas rotas de gestão e no `/mcp`: `Host` fora de [WebhookProperties.allowedHosts] →
 * 403 `{"error":"host not allowed"}` (no rebinding ele chega com o nome do atacante); `Origin` presente cujo host não
 * esteja na lista → 403 `{"error":"origin not allowed"}`, nos métodos que mudam estado (no `/mcp`, em todos, como o
 * transporte Streamable HTTP exige). Cliente sem `Origin` (CLI, SDKs, agentes) passa pelo `Host`. Nome sem porta
 * casa qualquer porta; com porta, só ela. Lista vazia: nada é conferido (o `/mcp` fica com [MCP_DEFAULT_HOSTS]).
 *
 * A captura (`/{id}/...`) e os arquivos da tela nunca passam por aqui. A rota é reconhecida pelo primeiro segmento
 * como o Spring MVC o casa (decodificado e sem `;parâmetros`), para que `/token;x=1/...` ou `/%74oken/...` não
 * escapem; sobrar para mais caminhos só troca um 404 por 403.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 2)
class AllowedHostFilter(
    properties: WebhookProperties,
) : OncePerRequestFilter() {
    private val allowedHosts =
        properties.allowedHosts
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .toSet()
    private val mcpHosts = allowedHosts.ifEmpty { MCP_DEFAULT_HOSTS }

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val root = request.firstSegment()
        val isMcp = root == MCP_ROOT
        val hosts = if (isMcp) mcpHosts else allowedHosts.takeIf { root in MANAGEMENT_ROOTS }.orEmpty()
        if (hosts.isEmpty()) return filterChain.doFilter(request, response)
        val origin = request.getHeader(HttpHeaders.ORIGIN)
        val host = request.getHeader(HttpHeaders.HOST).orEmpty()
        when {
            origin != null && (isMcp || request.changesState()) && !isAllowedOrigin(origin, hosts) -> response.forbid("origin not allowed")
            !isAllowedHost(host, hosts) -> response.forbid("host not allowed")
            else -> filterChain.doFilter(request, response)
        }
    }

    private fun HttpServletResponse.forbid(message: String) {
        status = HttpServletResponse.SC_FORBIDDEN
        contentType = MediaType.APPLICATION_JSON_VALUE
        outputStream.write("""{"error":"$message"}""".toByteArray())
    }
}

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

/**
 * `Host` da lista: o nome (com ou sem a porta) está nela. Só `nome` ou `nome:dígitos` (IPv6 entre colchetes); o que
 * não tem essa forma, como `localhost:8084.evil.test`, não está.
 */
private fun isAllowedHost(
    host: String,
    allowed: Set<String>,
): Boolean {
    val match = HOST_HEADER.matchEntire(host.trim().lowercase()) ?: return false
    val (name, port) = match.destructured
    return name in allowed || (port.isNotEmpty() && "$name:$port" in allowed)
}

/** `Origin` cujo host (com ou sem a porta) está na lista; `null` (texto), sem host ou malformado não está. */
private fun isAllowedOrigin(
    origin: String,
    allowed: Set<String>,
): Boolean =
    try {
        val uri = URI(origin.trim())
        val host = uri.host?.lowercase()
        host != null && (host in allowed || (uri.port >= 0 && "$host:${uri.port}" in allowed))
    } catch (_: URISyntaxException) {
        false
    }
