package anzol.e2ee

import anzol.AnzolProperties
import anzol.RedisKeys
import anzol.RequestId
import anzol.capture.CapturedRequest
import anzol.token.Token
import org.springframework.core.io.ClassPathResource
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import org.springframework.stereotype.Component
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.util.UUID

private val FIRST_WITH_JTI =
    RedisScript.of(ClassPathResource("redis/e2ee-jti.lua").getContentAsString(UTF_8), String::class.java)

/**
 * A decifra na captura: com `e2ee` na URL, abre o atributo da mensagem ([open]) e, quando válida, marca a reentrega
 * de um `jti` já visto com a primeira mensagem que o trouxe. O `content` fica como chegou.
 */
@Component
class E2eeReceiver(
    private val redis: StringRedisTemplate,
    private val properties: AnzolProperties,
) {
    fun open(
        token: Token,
        captured: CapturedRequest,
        now: Instant,
    ): CapturedRequest {
        val policy = token.e2ee ?: return captured
        val opening = policy.open(captured.content, captured.signature, token.e2eeKeys, now)
        val result = opening.result
        val jti = result.jti
        val checked =
            if (result.state == DecryptionState.VALID && jti != null) {
                result.copy(duplicateOf = firstWith(token, jti, captured.uuid, policy.maxAgeSeconds + FUTURE_SKEW_SECONDS))
            } else {
                result
            }
        return captured.copy(decryption = checked, decrypted = opening.data)
    }

    /** A primeira mensagem da URL com [jti]; `null` quando é esta. */
    private fun firstWith(
        token: Token,
        jti: String,
        request: RequestId,
        windowSeconds: Long,
    ): RequestId? {
        val keys = listOf(RedisKeys.e2eeJti(token.uuid))
        val first =
            redis.execute(
                FIRST_WITH_JTI,
                keys,
                jti,
                request.toString(),
                windowSeconds.toString(),
                properties.expiry.seconds.toString(),
            )
        return first?.let { RequestId(UUID.fromString(it)) }
    }
}
