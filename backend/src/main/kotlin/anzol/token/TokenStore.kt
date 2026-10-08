package anzol.token

import anzol.AnzolProperties
import anzol.RedisKeys
import anzol.TokenId
import org.springframework.core.io.ClassPathResource
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Clock

private val REPLACE =
    RedisScript.of(ClassPathResource("redis/token-replace.lua").getContentAsString(UTF_8), Long::class.javaObjectType)

/** Um token lido e o JSON exato que estava gravado. */
data class StoredToken(
    val token: Token,
    val json: String,
)

/**
 * `token:{uuid}` no Redis, no formato que o app antigo lê e grava. Cada leitura renova o TTL,
 * como `Storage/Redis/TokenStore::find`; a URL de laboratório E2EE vive o prazo dela, que a leitura não estende.
 */
@Component
class TokenStore(
    private val redis: StringRedisTemplate,
    private val jsonMapper: JsonMapper,
    private val properties: AnzolProperties,
    private val clock: Clock,
) {
    fun find(id: TokenId): Token? {
        val key = RedisKeys.token(id)
        val json = redis.opsForValue().get(key)
        if (json.isNullOrEmpty()) return null
        val token = jsonMapper.readValue(json, Token::class.java)
        redis.expire(key, token.expiry(properties.expiry, clock.instant()))
        return token
    }

    /** O token e o JSON dele como está gravado, para a troca condicional ([replace]). */
    fun read(id: TokenId): StoredToken? {
        val json = redis.opsForValue().get(RedisKeys.token(id))
        return if (json.isNullOrEmpty()) null else StoredToken(jsonMapper.readValue(json, Token::class.java), json)
    }

    /**
     * Grava [token] só se o que está no Redis ainda é o que foi lido ([read]); `false` quando outra gravação chegou
     * antes (ou a URL foi apagada) e nada foi gravado. Atômico no Redis, entre instâncias.
     */
    fun replace(
        read: StoredToken,
        token: Token,
    ): Boolean {
        val keys = listOf(RedisKeys.token(token.uuid))
        return redis.execute(
            REPLACE,
            keys,
            read.json,
            jsonMapper.writeValueAsString(token),
            token.expiry(properties.expiry, clock.instant()).seconds.toString(),
        ) ==
            1L
    }

    fun store(token: Token): Token {
        redis.opsForValue().set(
            RedisKeys.token(token.uuid),
            jsonMapper.writeValueAsString(token),
            token.expiry(properties.expiry, clock.instant()),
        )
        return token
    }

    /**
     * Apaga o token, as mensagens dele (hash, índice e `seq`), as regras, os cenários e o histórico de saída (com a
     * contagem do limite), a contagem das chamadas de IA, as falhas do segredo de leitura, os `jti` decifrados e os links só-leitura (cada
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
        return redis
            .delete(
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
                    RedisKeys.e2eeJti(token.uuid),
                ) + shares,
            ).also { if (token.lab != null) redis.opsForZSet().remove(RedisKeys.LABS, token.uuid.toString()) } > 0
    }
}
