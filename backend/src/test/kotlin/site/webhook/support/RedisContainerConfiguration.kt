package site.webhook.support

import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.context.annotation.Bean
import org.testcontainers.containers.GenericContainer
import org.testcontainers.utility.DockerImageName

private const val REDIS_PORT = 6379

/** Redis próprio do teste, em container; o Spring o fecha junto com o contexto. Nunca o Redis de dev. */
@TestConfiguration(proxyBeanMethods = false)
class RedisContainerConfiguration {
    @Bean
    @ServiceConnection(name = "redis")
    fun redisContainer(): GenericContainer<*> = GenericContainer(DockerImageName.parse("redis:7-alpine")).withExposedPorts(REDIS_PORT)
}
