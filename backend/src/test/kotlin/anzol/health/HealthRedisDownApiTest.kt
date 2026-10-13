package anzol.health

import anzol.support.ApiClient
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.annotation.DirtiesContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.context.TestConstructor
import org.testcontainers.containers.GenericContainer
import org.testcontainers.utility.DockerImageName
import tools.jackson.databind.json.JsonMapper
import java.time.Duration

private const val REDIS_PORT = 6379

/** O `timeoutSeconds` das probes do chart: a saúde tem de responder antes dele também com o Redis mudo. */
private val PROBE_TIMEOUT: Duration = Duration.ofSeconds(3)

/**
 * Redis próprio, que o teste congela (`docker pause`): a conexão continua aberta e nenhum comando volta, como num
 * Redis travado ou atrás de uma rede que caiu. Sem prazo, o PING esperaria os 60 s do cliente.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestConstructor(autowireMode = TestConstructor.AutowireMode.ALL)
@DirtiesContext
@DisplayName("Saúde com o Redis sem responder")
class HealthRedisDownApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName("Dado o Redis sem responder, quando lê /health, então 503 antes do prazo da probe, e 200 quando ele volta")
    fun health_redisMudo_deveResponder503EVoltar() {
        assertThat(api.send("GET", "/health").statusCode()).isEqualTo(200)
        redis.dockerClient.pauseContainerCmd(redis.containerId).exec()

        val started = System.nanoTime()
        val down = api.send("GET", "/health")
        val elapsed = Duration.ofNanos(System.nanoTime() - started)
        val version = api.send("GET", "/version")
        redis.dockerClient.unpauseContainerCmd(redis.containerId).exec()

        assertThat(down.statusCode()).isEqualTo(503)
        assertThat(elapsed).isLessThan(PROBE_TIMEOUT)
        assertThat(api.json(down)["status"].asString()).isEqualTo("unavailable")
        assertThat(api.json(down)["redis"].asString()).isEqualTo("down")
        assertThat(api.json(down)["version"]).isEqualTo(api.json(version)["version"])
        assertThat(version.statusCode()).isEqualTo(200)
        await().atMost(Duration.ofSeconds(10)).untilAsserted {
            assertThat(api.send("GET", "/health").statusCode()).isEqualTo(200)
        }
    }

    companion object {
        private val redis: GenericContainer<*> = GenericContainer(DockerImageName.parse("redis:7-alpine")).withExposedPorts(REDIS_PORT)

        @JvmStatic
        @DynamicPropertySource
        fun redisProperties(registry: DynamicPropertyRegistry) {
            redis.start()
            registry.add("spring.data.redis.host", redis::getHost)
            registry.add("spring.data.redis.port", redis::getFirstMappedPort)
        }

        @JvmStatic
        @AfterAll
        fun stop() = redis.stop()
    }
}
