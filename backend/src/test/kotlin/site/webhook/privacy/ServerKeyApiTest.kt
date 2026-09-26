package site.webhook.privacy

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.ApiTest
import java.io.File
import java.util.Base64
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

private const val SERVER_KEY = "webhook:server-key"

/** A chave do servidor e as guardas do código do segredo. */
@ApiTest
@DisplayName("Chave do servidor e comparações do segredo")
class ServerKeyApiTest(
    private val redis: StringRedisTemplate,
) {
    @Test
    @DisplayName(
        "Dado o Redis sem a chave, quando oito instâncias a usam ao mesmo tempo, então todas ficam com a mesma (SET NX), " +
            "de 32 bytes e sem TTL",
    )
    fun chave_instanciasSimultaneas_devemFicarComAMesma() {
        val original = redis.opsForValue().get(SERVER_KEY)
        try {
            redis.delete(SERVER_KEY)
            val start = CountDownLatch(1)
            val results =
                Executors.newVirtualThreadPerTaskExecutor().use { executor ->
                    (1..8)
                        .map {
                            CompletableFuture.supplyAsync({
                                start.await()
                                Base64.getEncoder().encodeToString(ServerKey(redis).hmac("id:1"))
                            }, executor)
                        }.also { start.countDown() }
                        .map { it.join() }
                }

            assertThat(results.toSet()).hasSize(1)
            assertThat(Base64.getDecoder().decode(redis.opsForValue().get(SERVER_KEY))).hasSize(32)
            assertThat(redis.getExpire(SERVER_KEY)).isEqualTo(-1)
        } finally {
            // O contexto dos outros testes guarda a chave em memória: o Redis volta a ter a mesma.
            if (original != null) redis.opsForValue().set(SERVER_KEY, original)
        }
    }

    @Test
    @DisplayName("Dado o código do segredo e do cookie, quando compara, então usa só MessageDigest.isEqual (tempo constante)")
    fun codigo_deveCompararEmTempoConstante() {
        val code =
            listOf(
                "privacy/ReadAccess.kt",
                "token/ReadSecret.kt",
            ).joinToString("\n") { File("src/main/kotlin/site/webhook/$it").readText() }

        assertThat(code).contains("MessageDigest.isEqual(")
        assertThat(code).doesNotContain("contentEquals", "Arrays.equals", ".equals(")
    }
}
