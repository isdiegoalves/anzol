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

    /**
     * Apaga o token, as mensagens dele (hash, índice e `seq`), as regras, os cenários e o histórico de saída (com a
     * contagem do limite), a contagem das chamadas de IA, as falhas do segredo de leitura e os links só-leitura (cada
     * `share:{id}` e o índice) num DEL só, atômico. O app antigo apagava só o token e deixava as mensagens ocupando
     * memória até expirar. O `seq` sai junto: o token deixa de existir e o UUID não se repete, então não há sequência a
     * preservar. Link criado entre a leitura do índice e o DEL fica órfão, mas responde 404: a URL não existe mais.
     */
    fun delete(token: Token): Boolean {
        val shares =
            redis
                .opsForZSet()
                .range(RedisKeys.shares(token.uuid), 0, -1)
                .orEmpty()
                .map(RedisKeys::share)
        return redis.delete(
            listOf(
                RedisKeys.token(token.uuid),
                RedisKeys.requests(token.uuid),
                RedisKeys.requestIndex(token.uuid),
                RedisKeys.requestSeq(token.uuid),
                RedisKeys.rules(token.uuid),
                RedisKeys.scenarios(token.uuid),
                RedisKeys.outbound(token.uuid),
                RedisKeys.outboundRate(token.uuid),
                RedisKeys.aiRate(token.uuid),
                RedisKeys.secretFailures(token.uuid),
                RedisKeys.mcpSecretFailures(token.uuid),
                RedisKeys.shares(token.uuid),
            ) + shares,
        ) > 0
    }
}
