package site.webhook.token

import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Component
import site.webhook.RedisKeys
import site.webhook.TokenId
import site.webhook.WebhookProperties
import tools.jackson.databind.json.JsonMapper

/**
 * `token:{uuid}` no Redis, no formato que o app antigo lê e grava. Cada leitura renova o TTL,
 * como `Storage/Redis/TokenStore::find`.
 */
@Component
class TokenStore(
    private val redis: StringRedisTemplate,
    private val jsonMapper: JsonMapper,
    private val properties: WebhookProperties,
) {
    fun find(id: TokenId): Token? {
        val key = RedisKeys.token(id)
        val json = redis.opsForValue().get(key)
        if (json.isNullOrEmpty()) return null
        redis.expire(key, properties.expiry)
        return jsonMapper.readValue(json, Token::class.java)
    }

    fun store(token: Token): Token {
        redis.opsForValue().set(RedisKeys.token(token.uuid), jsonMapper.writeValueAsString(token), properties.expiry)
        return token
    }

    /** Apaga só o token; as mensagens ficam até expirar, como no app antigo. */
    fun delete(token: Token): Boolean = redis.delete(RedisKeys.token(token.uuid))
}
