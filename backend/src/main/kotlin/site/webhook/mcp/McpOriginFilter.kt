package site.webhook.mcp

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import site.webhook.http.MCP_ENDPOINT
import java.net.URI
import java.net.URISyntaxException

/** Hosts de loopback que um `Origin` pode ter (qualquer esquema e porta). */
private val LOOPBACK_HOSTS = setOf("localhost", "127.0.0.1", "[::1]")

/**
 * `webhook.mcp`: [enabled] liga o servidor em `/mcp`; [allowedHosts] são os nomes aceitos no `Host` dele (sem porta
 * casa qualquer porta; com porta, só ela). O padrão cobre o loopback e o `host.docker.internal`.
 */
@ConfigurationProperties("webhook.mcp")
data class McpProperties(
    val enabled: Boolean = false,
    val allowedHosts: List<String> = listOf("localhost", "127.0.0.1", "[::1]", "host.docker.internal"),
)

/**
 * O que o transporte Streamable HTTP do MCP exige contra DNS rebinding, só em [MCP_ENDPOINT]: `Origin`, quando vem
 * (navegador), tem de ser de loopback; o `Host` tem de estar em [McpProperties.allowedHosts] (no rebinding ele chega
 * com o nome do atacante). Cliente sem `Origin` (Claude Code, SDKs) passa pelo `Host`. Recusa: 403
 * `{"error":"origin not allowed"}` ou `{"error":"host not allowed"}`.
 */
@Component
@ConditionalOnBooleanProperty("webhook.mcp.enabled")
@Order(Ordered.HIGHEST_PRECEDENCE + 2)
class McpOriginFilter(
    properties: McpProperties,
) : OncePerRequestFilter() {
    private val allowedHosts =
        properties.allowedHosts
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .toSet()

    override fun shouldNotFilter(request: HttpServletRequest): Boolean = request.requestURI.trimEnd('/') != MCP_ENDPOINT

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val origin = request.getHeader(HttpHeaders.ORIGIN)
        val host = request.getHeader(HttpHeaders.HOST).orEmpty()
        when {
            origin != null && !isLoopbackOrigin(origin) -> response.forbid("origin not allowed")
            !isAllowedHost(host) -> response.forbid("host not allowed")
            else -> filterChain.doFilter(request, response)
        }
    }

    private fun isAllowedHost(host: String): Boolean {
        val value = host.trim().lowercase()
        return value in allowedHosts || hostName(value) in allowedHosts
    }

    private fun HttpServletResponse.forbid(message: String) {
        status = HttpServletResponse.SC_FORBIDDEN
        contentType = MediaType.APPLICATION_JSON_VALUE
        writer.write("""{"error":"$message"}""")
    }
}

/** `Origin` de loopback em qualquer porta; `null` (texto), sem host ou malformado não é. */
private fun isLoopbackOrigin(origin: String): Boolean =
    try {
        URI(origin.trim()).host?.lowercase() in LOOPBACK_HOSTS
    } catch (_: URISyntaxException) {
        false
    }

/** O nome do `Host` sem a porta; IPv6 fica entre colchetes (`[::1]:8084` → `[::1]`). */
private fun hostName(host: String): String = if (host.startsWith("[")) host.substringBefore("]") + "]" else host.substringBefore(':')
