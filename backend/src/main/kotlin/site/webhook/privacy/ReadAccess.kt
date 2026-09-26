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
import java.time.Clock
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Base64

/** Nome do cookie de desbloqueio; o `Path` dele é o da URL (`/token/{id}`). */
const val ACCESS_COOKIE = "wh_access"

/**
 * Validade do cookie de desbloqueio: o `Max-Age` para o navegador e o prazo que o servidor confere pelo dia de emissão
 * assinado no valor ([ReadAccess.cookieValue]).
 */
val ACCESS_COOKIE_MAX_AGE: Duration = Duration.ofDays(30)

/** Cabeçalho com o segredo de leitura (CLI, scripts). */
const val SECRET_HEADER = "X-Webhook-Secret"

/** Tentativas erradas do segredo por URL e por [SecretChannel] a cada [FAILURE_WINDOW]. */
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

/**
 * Por onde o segredo chegou; cada canal tem o seu contador de falhas. [HTTP] soma o unlock e o cabeçalho (a §1); o
 * [MCP] conta à parte, para que um agente errando o `read_secret` não trave o dono na tela e no CLI.
 */
enum class SecretChannel(
    val failuresKey: (TokenId) -> String,
) {
    HTTP(RedisKeys::secretFailures),
    MCP(RedisKeys::mcpSecretFailures),
}

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
 * Quem pode ver e gerir uma URL protegida: quem tem o cookie de desbloqueio da versão atual do segredo, dentro do
 * prazo, ou quem mostra o segredo (cabeçalho [SECRET_HEADER], `read_secret` no MCP, corpo do unlock).
 *
 * O segredo é conferido por PBKDF2 em tempo constante. Os acertos ficam [VERIFIED_FOR] em memória, pela chave
 * `HMAC(chave do servidor, id:versão:segredo)` (nem o segredo nem um hash rápido dele ficam guardados), para que o CLI
 * não pague o PBKDF2 em toda chamada; trocar o segredo muda a versão e esvazia o efeito do cache.
 *
 * Limite: [MAX_SECRET_FAILURES] tentativas erradas por minuto por URL e canal; a partir daí, 429 até a janela acabar, **para
 * qualquer segredo, certo ou errado, inclusive os do cache** (senão o 429 do errado e o 200 do certo seriam um
 * oráculo sem limite). Cada tentativa reserva uma vaga na janela antes do PBKDF2 (tentativas simultâneas não passam
 * do limite) e a devolve se acertar. O cookie não passa pelo limite: é um HMAC de 256 bits.
 */
@Component
class ReadAccess(
    private val redis: StringRedisTemplate,
    private val serverKey: ServerKey,
    private val clock: Clock,
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
        channel: SecretChannel = SecretChannel.HTTP,
    ): Access =
        when {
            !token.isProtected() -> Access.Granted
            cookies.any { isValidCookie(token, it) } -> Access.Granted
            secret == null -> Access.Denied
            else -> verify(token, secret, channel)
        }

    /** Confere [secret] contra o segredo da URL, com o limite de falhas. URL sem proteção: sempre. */
    fun verify(
        token: Token,
        secret: String,
        channel: SecretChannel = SecretChannel.HTTP,
    ): Access {
        val hash = token.readSecretHash ?: return Access.Granted
        val failuresKey = channel.failuresKey(token.uuid)
        val locked = lockedFor(failuresKey)
        val cacheKey = Base64.getEncoder().encodeToString(serverKey.hmac("${token.uuid}:${token.secretVersion}:$secret"))
        return when {
            locked != null -> Access.Limited(locked)
            verified.getIfPresent(cacheKey) == true -> Access.Granted
            else -> attempt(failuresKey, hash, secret, cacheKey)
        }
    }

    /**
     * O valor do cookie de desbloqueio: `{dia}.{HMAC-SHA256(chave do servidor, id:versão:dia)}`, o HMAC em Base64 URL sem
     * `=`, com o dia de emissão (dias desde 1970, UTC). O servidor recusa o cookie a partir de [ACCESS_COOKIE_MAX_AGE]
     * do dia de emissão, mesmo que o navegador o guarde. O dia, e não o instante: dois desbloqueios no mesmo dia dão o
     * mesmo cookie, e o prazo nunca passa de 30 dias (no máximo encurta em menos de um).
     */
    fun cookieValue(token: Token): String = cookieValue(token, today())

    private fun cookieValue(
        token: Token,
        issuedDay: Long,
    ): String {
        val mac = serverKey.hmac("${token.uuid}:${token.secretVersion}:$issuedDay")
        return "$issuedDay.${Base64.getUrlEncoder().withoutPadding().encodeToString(mac)}"
    }

    /** Cookie desta versão do segredo, assinado por este servidor e emitido há menos de [ACCESS_COOKIE_MAX_AGE]. */
    private fun isValidCookie(
        token: Token,
        cookie: String,
    ): Boolean {
        val issuedDay = cookie.substringBefore('.', missingDelimiterValue = "").toLongOrNull() ?: return false
        val age = today() - issuedDay
        return age in 0 until ACCESS_COOKIE_MAX_AGE.toDays() && sameBytes(cookie, cookieValue(token, issuedDay))
    }

    private fun today(): Long = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC).toEpochDay()

    /** Reserva a vaga na janela, roda o PBKDF2 e, se acertou, devolve a vaga e guarda o acerto. */
    private fun attempt(
        failuresKey: String,
        hash: ReadSecretHash,
        secret: String,
        cacheKey: String,
    ): Access {
        val limited = redis.countInWindow(failuresKey, FAILURE_WINDOW, MAX_SECRET_FAILURES)
        return when {
            limited != null -> {
                Access.Limited(limited.retryAfterSeconds)
            }

            hash.matches(secret) -> {
                redis.execute(REFUND, listOf(failuresKey))
                verified.put(cacheKey, true)
                Access.Granted
            }

            else -> {
                Access.Denied
            }
        }
    }

    /** Segundos até a janela acabar quando ela já tem [MAX_SECRET_FAILURES] falhas; nulo quando ainda cabe tentar. */
    private fun lockedFor(key: String): Long? {
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
 * protegida sem o segredo certo, 429 no limite de falhas do canal [SecretChannel.MCP].
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
        return when (val result = access.authorize(token, secret, cookies = emptyList(), channel = SecretChannel.MCP)) {
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
