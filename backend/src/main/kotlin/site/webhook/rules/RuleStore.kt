package site.webhook.rules

import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Component
import site.webhook.RedisKeys
import site.webhook.TokenId
import site.webhook.WebhookProperties
import tools.jackson.databind.json.JsonMapper

/**
 * `token:{uuid}:rules`: a lista de regras da URL em JSON, no formato da API. Gravada com o TTL da URL
 * e renovada a cada leitura (o webhook lê a cada requisição); lista vazia apaga a chave. Sai junto com
 * a URL no `TokenStore.delete`. A leitura não recompila os templates: regra salva antes de um teto novo
 * continua listada e casando, e a resposta dela é 500 com o motivo (ver [parseRules]).
 */
@Component
class RuleStore(
    private val redis: StringRedisTemplate,
    private val jsonMapper: JsonMapper,
    private val properties: WebhookProperties,
) {
    fun find(id: TokenId): List<Rule> {
        val json = redis.opsForValue().getAndExpire(RedisKeys.rules(id), properties.expiry) ?: return emptyList()
        return when (val parsed = parseRules(jsonMapper.readTree(json), checkTemplates = false)) {
            is Parsed.Valid -> parsed.value
            is Parsed.Invalid -> error("regras inválidas no Redis em ${RedisKeys.rules(id)}: ${parsed.errors}")
        }
    }

    fun store(
        id: TokenId,
        rules: List<Rule>,
    ): List<Rule> {
        if (rules.isEmpty()) {
            redis.delete(RedisKeys.rules(id))
        } else {
            redis.opsForValue().set(RedisKeys.rules(id), jsonMapper.writeValueAsString(rules), properties.expiry)
        }
        return rules
    }
}
