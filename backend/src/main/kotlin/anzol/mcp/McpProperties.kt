package anzol.mcp

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * `anzol.mcp`: [enabled] liga o servidor em `/mcp`. O `Host` e o `Origin` dele são conferidos junto com os das rotas
 * de gestão ([anzol.http.AllowedHostFilter]).
 */
@ConfigurationProperties("anzol.mcp")
data class McpProperties(
    val enabled: Boolean = false,
)
