package anzol.health

import anzol.ai.AiProperties
import anzol.mcp.McpProperties
import org.springframework.boot.info.BuildProperties
import org.springframework.data.redis.core.RedisCallback
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Abaixo do prazo das probes (3 s no chart): Redis fora do ar deixa um comando esperando os 60 s do cliente. */
private val REDIS_TIMEOUT: Duration = Duration.ofSeconds(2)

data class Health(
    val status: String,
    val version: String,
    val redis: String,
    val ai: String,
    val mcp: String,
)

data class Version(
    val version: String,
)

/**
 * `GET /health`: 200 com `"status": "ok"` só quando o Redis responde ao PING em [REDIS_TIMEOUT]; senão 503 com
 * `"status": "unavailable"` e `"redis": "down"`. `GET /version`: a versão do build, também com o Redis fora.
 *
 * As duas ficam fora da conferência de `Host`: a probe do Kubernetes chega com o IP do pod e o `HEALTHCHECK` da
 * imagem, de dentro do container.
 */
@RestController
class HealthController(
    private val redis: StringRedisTemplate,
    build: BuildProperties,
    private val ai: AiProperties,
    private val mcp: McpProperties,
) {
    private val version: String = requireNotNull(build.version) { "build-info.properties sem build.version" }
    private val pings = Executors.newVirtualThreadPerTaskExecutor()

    @GetMapping("/health")
    fun health(): ResponseEntity<Health> {
        val up = redisAnswers()
        val health =
            Health(
                status = if (up) "ok" else "unavailable",
                version = version,
                redis = if (up) "ok" else "down",
                ai = onOrOff(ai.enabled),
                mcp = onOrOff(mcp.enabled),
            )
        return ResponseEntity.status(if (up) HttpStatus.OK else HttpStatus.SERVICE_UNAVAILABLE).body(health)
    }

    @GetMapping("/version")
    fun version(): Version = Version(version)

    private fun redisAnswers(): Boolean =
        try {
            CompletableFuture
                .supplyAsync({ redis.execute(RedisCallback { it.ping() }) }, pings)
                .get(REDIS_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS) != null
        } catch (_: ExecutionException) {
            false
        } catch (_: TimeoutException) {
            false
        }
}

private fun onOrOff(enabled: Boolean): String = if (enabled) "on" else "off"
