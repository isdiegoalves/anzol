package site.webhook

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.convert.DurationUnit
import java.time.Duration
import java.time.temporal.ChronoUnit

/** `config/app.php` do app antigo: `WEBHOOK_MAX_REQUESTS` e `WEBHOOK_EXPIRY` (segundos). */
@ConfigurationProperties("webhook")
data class WebhookProperties(
    val maxRequests: Long,
    @param:DurationUnit(ChronoUnit.SECONDS)
    val expiry: Duration,
)
