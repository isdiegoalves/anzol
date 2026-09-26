package site.webhook.capture

import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Component
import site.webhook.RedisKeys
import site.webhook.RequestId
import site.webhook.WebhookProperties
import site.webhook.legacy.phpForPage
import site.webhook.token.Token
import tools.jackson.databind.json.JsonMapper

/**
 * `token:{uuid}:requests`: hash `uuid da mensagem → JSON`, no formato que o app antigo lê e
 * grava (`Storage/Redis/RequestStore.php`).
 */
@Component
class RequestStore(
    private val redis: StringRedisTemplate,
    private val jsonMapper: JsonMapper,
    private val properties: WebhookProperties,
) {
    private val hash get() = redis.opsForHash<String, String>()

    fun find(
        token: Token,
        id: RequestId,
    ): CapturedRequest? {
        val key = RedisKeys.requests(token.uuid)
        val json = hash.get(key, id.toString())
        if (json.isNullOrEmpty()) return null
        redis.expire(key, properties.expiry)
        return jsonMapper.readValue(json, CapturedRequest::class.java)
    }

    /**
     * A estrutura é uma hash sem índice, então a página sai de um HGETALL ordenado em memória,
     * como no app antigo (até `WEBHOOK_MAX_REQUESTS` itens). Valores vazios são ignorados.
     */
    fun page(
        token: Token,
        page: Long,
        perPage: Long,
        sorting: Sorting,
    ): List<CapturedRequest> {
        val stored =
            hash
                .entries(RedisKeys.requests(token.uuid))
                .values
                .filter { it.isNotEmpty() }
                .map { jsonMapper.readValue(it, CapturedRequest::class.java) }
        val ordered =
            when (sorting) {
                Sorting.OLDEST -> stored.sortedBy { it.createdAt }
                Sorting.NEWEST -> stored.sortedByDescending { it.createdAt }
            }
        return ordered.phpForPage(page, perPage)
    }

    fun count(token: Token): Long = hash.size(RedisKeys.requests(token.uuid))

    fun store(
        token: Token,
        request: CapturedRequest,
    ) {
        val key = RedisKeys.requests(token.uuid)
        hash.put(key, request.uuid.toString(), jsonMapper.writeValueAsString(request))
        redis.expire(key, properties.expiry)
    }

    fun delete(
        token: Token,
        request: CapturedRequest,
    ): Boolean = hash.delete(RedisKeys.requests(token.uuid), request.uuid.toString()) > 0

    fun deleteAll(token: Token): Boolean = redis.delete(RedisKeys.requests(token.uuid))
}
