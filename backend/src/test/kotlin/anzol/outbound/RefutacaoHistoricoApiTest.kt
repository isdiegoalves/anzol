package anzol.outbound

import anzol.RedisKeys
import anzol.TokenId
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.sendOut
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.json.JsonMapper
import java.util.UUID

/** Teto declarado do histórico: 50 resultados, ~3,2 MB por URL, isto é, ~64 KB por resultado. */
private const val HISTORY_ENTRY_CEILING = 128 * 1024

/**
 * Refutação (fatia 04), no padrão seguro (`allow-private=false`): o send grava `request_headers` sem teto, até os
 * 2 MiB do pedido, mesmo quando o alvo é bloqueado e nada sai. Cada URL guarda 50 desses (~100 MB) e o
 * `POST /token` é aberto.
 */
@ApiTest
@DisplayName("Refutação: tamanho do histórico de saída")
class RefutacaoHistoricoApiTest(
    @LocalServerPort port: Int,
    private val jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName("Dado um send bloqueado com 1,5 MB de cabeçalho, quando grava o histórico, então o resultado cabe no teto declarado")
    fun sendBloqueadoComCabecalhoGrande_deveCaberNoTeto() {
        val tokenId = api.tokenId()
        val body =
            jsonMapper.writeValueAsString(
                mapOf("url" to "http://0.0.0.0/", "method" to "GET", "headers" to mapOf("X-Big" to "a".repeat(1_500_000))),
            )

        val result = api.json(api.sendOut(tokenId, body))

        assertThat(result["error"]["kind"].asString()).isEqualTo("blocked")
        val stored = redis.opsForList().index(RedisKeys.outbound(TokenId(UUID.fromString(tokenId))), 0).orEmpty()
        assertThat(stored.length).isLessThanOrEqualTo(HISTORY_ENTRY_CEILING)
    }
}
