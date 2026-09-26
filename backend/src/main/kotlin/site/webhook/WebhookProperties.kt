package site.webhook

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.convert.DurationUnit
import java.time.Duration
import java.time.temporal.ChronoUnit

/**
 * `WEBHOOK_MAX_REQUESTS`: quantas mensagens uma URL sem `auto_cleanup` guarda (FIFO; o app antigo
 * respondia 410 ao atingir). `WEBHOOK_EXPIRY`: TTL de tokens e mensagens, em segundos.
 * `WEBHOOK_ALLOWED_HOSTS`: nomes aceitos no `Host` (e no `Origin`) das rotas de gestão, contra DNS rebinding e CSRF;
 * vazia (o padrão) não confere nada ([site.webhook.http.AllowedHostFilter]).
 */
@ConfigurationProperties("webhook")
data class WebhookProperties(
    val maxRequests: Long,
    @param:DurationUnit(ChronoUnit.SECONDS)
    val expiry: Duration,
    val allowedHosts: List<String> = emptyList(),
)
