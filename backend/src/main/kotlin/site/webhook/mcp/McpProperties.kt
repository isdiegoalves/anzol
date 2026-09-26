package site.webhook.mcp

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * `webhook.mcp`: [enabled] liga o servidor em `/mcp`. O `Host` e o `Origin` dele são conferidos junto com os das rotas
 * de gestão ([site.webhook.http.AllowedHostFilter]).
 */
@ConfigurationProperties("webhook.mcp")
data class McpProperties(
    val enabled: Boolean = false,
)
