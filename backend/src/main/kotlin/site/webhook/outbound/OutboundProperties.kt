package site.webhook.outbound

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * `WEBHOOK_OUTBOUND_ALLOW_PRIVATE`: libera loopback, redes privadas, CGNAT e ULA como destino do replay e do send
 * (padrão `false`, seguro para publicar). `WEBHOOK_OUTBOUND_LOCALHOST_ALIAS`: nome que substitui o `localhost` do
 * alvo, porque dentro do container o `localhost` não é o da máquina do dono (vazio: sem alias).
 */
@ConfigurationProperties("webhook.outbound")
data class OutboundProperties(
    val allowPrivate: Boolean = false,
    val localhostAlias: String? = null,
) {
    fun alias(): String? = localhostAlias?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
}
