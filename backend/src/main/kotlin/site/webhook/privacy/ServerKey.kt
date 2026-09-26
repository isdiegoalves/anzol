package site.webhook.privacy

import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Component
import site.webhook.RedisKeys
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val KEY_BYTES = 32
private const val HMAC = "HmacSHA256"

/**
 * A chave do servidor que assina o cookie de desbloqueio: 32 bytes aleatórios em [RedisKeys.SERVER_KEY], criados no
 * primeiro uso com `SET NX` (duas instâncias subindo juntas ficam com a mesma: a segunda lê a da primeira) e sem TTL,
 * para sobreviver a restart. Lida uma vez e guardada em memória. Nunca vai para log nem resposta.
 */
@Component
class ServerKey(
    private val redis: StringRedisTemplate,
) {
    @Volatile
    private var key: ByteArray? = null

    /** HMAC-SHA256 de [text] com a chave do servidor. */
    fun hmac(text: String): ByteArray {
        val mac = Mac.getInstance(HMAC)
        mac.init(SecretKeySpec(bytes(), HMAC))
        return mac.doFinal(text.toByteArray(Charsets.UTF_8))
    }

    private fun bytes(): ByteArray = key ?: load().also { key = it }

    private fun load(): ByteArray {
        val candidate = ByteArray(KEY_BYTES).also(SecureRandom()::nextBytes)
        redis.opsForValue().setIfAbsent(RedisKeys.SERVER_KEY, Base64.getEncoder().encodeToString(candidate))
        val stored =
            checkNotNull(redis.opsForValue().get(RedisKeys.SERVER_KEY)) { "chave do servidor sumiu do Redis logo depois do SET NX" }
        val decoded = Base64.getDecoder().decode(stored)
        check(decoded.size == KEY_BYTES) { "chave do servidor no Redis com tamanho inválido" }
        return decoded
    }
}
