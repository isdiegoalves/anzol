package site.webhook.privacy

import com.github.benmanes.caffeine.cache.Cache
import com.github.benmanes.caffeine.cache.Caffeine
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.server.ResponseStatusException
import site.webhook.RedisKeys
import site.webhook.TokenId
import site.webhook.countInWindow
import site.webhook.token.ReadSecretHash
import site.webhook.token.Token
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import java.security.MessageDigest
import java.time.Duration
import java.util.Base64

/** Nome do cookie de desbloqueio; o `Path` dele é o da URL (`/token/{id}`). */
const val ACCESS_COOKIE = "wh_access"

/** Cabeçalho com o segredo de leitura (CLI, scripts). */
const val SECRET_HEADER = "X-Webhook-Secret"

/** Tentativas erradas do segredo por URL a cada [FAILURE_WINDOW], somando unlock, cabeçalho e MCP. */
const val MAX_SECRET_FAILURES = 10
val FAILURE_WINDOW: Duration = Duration.ofMinutes(1)

/** Quanto um segredo já conferido dispensa o PBKDF2 (cache em memória, só de acertos). */
private val VERIFIED_FOR: Duration = Duration.ofMinutes(5)
private const val MAX_VERIFIED = 10_000L

/** Devolve a tentativa reservada quando o segredo confere: só falhas contam. Sem a chave (janela acabou), nada. */
private val REFUND =
    RedisScript.of(
        "if redis.call('EXISTS', KEYS[1]) == 1 then return redis.call('DECR', KEYS[1]) end return 0",
        Long::class.java,
    )

/** O resultado de uma tentativa de acesso a uma URL. */
sealed interface Access {
    data object Granted : Access

    data object Denied : Access

    /** Passou de [MAX_SECRET_FAILURES] na janela: 429 com [retryAfterSeconds] no `Retry-After`. */
    data class Limited(
        val retryAfterSeconds: Long,
    ) : Access
}

/**
 * Quem pode ver e gerir uma URL protegida: quem tem o cookie de desbloqueio da versão atual do segredo, ou quem
 * mostra o segredo (cabeçalho [SECRET_HEADER], `read_secret` no MCP, corpo do unlock).
 *
 * O segredo é conferido por PBKDF2 em tempo constante. Os acertos ficam [VERIFIED_FOR] em memória, pela chave
 * `HMAC(chave do servidor, id:versão:segredo)` (nem o segredo nem um hash rápido dele ficam guardados), para que o CLI
 * não pague o PBKDF2 em toda chamada; trocar o segredo muda a versão e esvazia o efeito do cache.
 *
 * Limite: [MAX_SECRET_FAILURES] tentativas erradas por minuto por URL; a partir daí, 429 até a janela acabar, **para
 * qualquer segredo, certo ou errado, inclusive os do cache** (senão o 429 do errado e o 200 do certo seriam um
 * oráculo sem limite). Cada tentativa reserva uma vaga na janela antes do PBKDF2 (tentativas simultâneas não passam
 * do limite) e a devolve se acertar. O cookie não passa pelo limite: é um HMAC de 256 bits.
 */
@Component
class ReadAccess(
    private val redis: StringRedisTemplate,
    private val serverKey: ServerKey,
) {
    private val verified: Cache<String, Boolean> =
        Caffeine
            .newBuilder()
            .expireAfterWrite(VERIFIED_FOR)
            .maximumSize(MAX_VERIFIED)
            .build()

    /** Acesso por cookie ([cookies], todos os `wh_access` que vieram) ou pelo segredo; URL sem proteção: sempre. */
    fun authorize(
        token: Token,
        secret: String?,
        cookies: List<String>,
    ): Access =
        when {
            !token.isProtected() -> Access.Granted
            cookies.any { sameBytes(it, cookieValue(token)) } -> Access.Granted
            secret == null -> Access.Denied
            else -> verify(token, secret)
        }

    /** Confere [secret] contra o segredo da URL, com o limite de falhas. URL sem proteção: sempre. */
    fun verify(
        token: Token,
        secret: String,
    ): Access {
        val hash = token.readSecretHash ?: return Access.Granted
        val locked = lockedFor(token.uuid)
        val cacheKey = Base64.getEncoder().encodeToString(serverKey.hmac("${token.uuid}:${token.secretVersion}:$secret"))
        return when {
            locked != null -> Access.Limited(locked)
            verified.getIfPresent(cacheKey) == true -> Access.Granted
            else -> attempt(token.uuid, hash, secret, cacheKey)
        }
    }

    /** O valor do cookie de desbloqueio: `HMAC-SHA256(chave do servidor, id:versão)`, em Base64 URL sem `=`. */
    fun cookieValue(token: Token): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(serverKey.hmac("${token.uuid}:${token.secretVersion}"))

    /** Reserva a vaga na janela, roda o PBKDF2 e, se acertou, devolve a vaga e guarda o acerto. */
    private fun attempt(
        id: TokenId,
        hash: ReadSecretHash,
        secret: String,
        cacheKey: String,
    ): Access {
        val limited = redis.countInWindow(RedisKeys.secretFailures(id), FAILURE_WINDOW, MAX_SECRET_FAILURES)
        return when {
            limited != null -> {
                Access.Limited(limited.retryAfterSeconds)
            }

            hash.matches(secret) -> {
                redis.execute(REFUND, listOf(RedisKeys.secretFailures(id)))
                verified.put(cacheKey, true)
                Access.Granted
            }

            else -> {
                Access.Denied
            }
        }
    }

    /** Segundos até a janela acabar quando ela já tem [MAX_SECRET_FAILURES] falhas; nulo quando ainda cabe tentar. */
    private fun lockedFor(id: TokenId): Long? {
        val key = RedisKeys.secretFailures(id)
        val failures = redis.opsForValue().get(key)?.toLongOrNull() ?: 0
        return if (failures < MAX_SECRET_FAILURES) null else redis.getExpire(key).coerceIn(1, FAILURE_WINDOW.seconds)
    }
}

private fun sameBytes(
    a: String,
    b: String,
): Boolean = MessageDigest.isEqual(a.toByteArray(Charsets.UTF_8), b.toByteArray(Charsets.UTF_8))

/**
 * As URLs para quem mostra o segredo fora do HTTP (ferramentas do MCP, argumento `read_secret`): 410 sem a URL, 401
 * protegida sem o segredo certo, 429 no limite de falhas (o mesmo contador do unlock e do cabeçalho).
 */
@Component
class ProtectedUrls(
    private val tokens: TokenStore,
    private val access: ReadAccess,
) {
    fun open(
        id: TokenId,
        secret: String?,
    ): Token {
        val token = tokens.findOrGone(id)
        return when (val result = access.authorize(token, secret, cookies = emptyList())) {
            Access.Granted -> {
                token
            }

            Access.Denied -> {
                throw ResponseStatusException(HttpStatus.UNAUTHORIZED, "This URL is protected; pass its read_secret")
            }

            is Access.Limited -> {
                throw ResponseStatusException(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "This URL is protected and got too many wrong secrets; try again in ${result.retryAfterSeconds} s",
                )
            }
        }
    }
}
