package site.webhook

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.convert.DurationUnit
import java.time.Duration
import java.time.temporal.ChronoUnit

/**
 * Padrão de [WebhookProperties.allowedHosts] (lista fechada): o loopback e o host do Docker. Vale também para a lista
 * vazia e, com `*` na lista, para o `/mcp`.
 */
val DEFAULT_ALLOWED_HOSTS = listOf("localhost", "127.0.0.1", "[::1]", "host.docker.internal")

/**
 * `WEBHOOK_MAX_REQUESTS`: quantas mensagens uma URL sem `auto_cleanup` guarda (FIFO; o app antigo
 * respondia 410 ao atingir). `WEBHOOK_EXPIRY`: TTL de tokens e mensagens, em segundos.
 * `WEBHOOK_ALLOWED_HOSTS`: nomes aceitos no `Host` (e no `Origin`) das rotas de gestão, contra DNS rebinding e CSRF
 * ([site.webhook.http.AllowedHostFilter]); vazia vale o padrão fechado (loopback e `host.docker.internal`), `*` desliga
 * a conferência (inseguro).
 */
@ConfigurationProperties("webhook")
data class WebhookProperties(
    val maxRequests: Long,
    @param:DurationUnit(ChronoUnit.SECONDS)
    val expiry: Duration,
    val allowedHosts: List<String> = DEFAULT_ALLOWED_HOSTS,
)
