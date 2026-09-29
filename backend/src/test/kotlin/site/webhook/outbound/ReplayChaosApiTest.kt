package site.webhook.outbound

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.RedisKeys
import site.webhook.TokenId
import site.webhook.support.ApiClient
import site.webhook.support.JSON_BODY
import site.webhook.support.PermissiveOutboundApiTest
import site.webhook.support.RawServer
import site.webhook.support.Receiver
import site.webhook.support.outbound
import site.webhook.support.replay
import site.webhook.support.reply
import site.webhook.support.sendOut
import tools.jackson.databind.json.JsonMapper
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

private const val BODY = "{\"pedido\":42,\"ok\":true}"
private const val CHAOS_KEYS = 8

@PermissiveOutboundApiTest
@DisplayName("POST /token/{id}/request/{rid}/replay com chaos")
class ReplayChaosApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)
    private val closeables = mutableListOf<AutoCloseable>()

    private fun <T : AutoCloseable> T.closing(): T = also { closeables.add(it) }

    @AfterEach
    fun close() = closeables.asReversed().forEach { it.close() }

    private fun message(tokenId: String): String =
        api.capture(tokenId, "POST", "/pedidos", BODY.toByteArray(), JSON_BODY)["uuid"].asString()

    @Test
    @DisplayName(
        "Dado abort_mid_body com duplicate, quando reenvia, então o resultado fica sem status e sem error, com o chaos inteiro, " +
            "e o histórico guarda o mesmo, numa entrada",
    )
    fun corteDuplicado_deveRelatarEGravar() {
        val server =
            RawServer { socket ->
                socket.soTimeout = 5_000
                socket.getInputStream().readAllBytes()
            }.closing()
        val tokenId = api.tokenId()
        val requestId = message(tokenId)

        val result =
            api.json(
                api.replay(
                    tokenId,
                    requestId,
                    """{"url":"http://127.0.0.1:${server.port}/","keep_path":false,"chaos":{"abort_mid_body":true,"duplicate":true}}""",
                ),
            )

        assertThat(result.has("status")).isFalse()
        assertThat(result.has("error")).isFalse()
        val chaos = result["chaos"]
        assertThat(chaos.size()).isEqualTo(CHAOS_KEYS)
        assertThat(chaos["delay_ms"].asInt()).isZero()
        assertThat(chaos["duplicate"].asBoolean()).isTrue()
        assertThat(chaos["abort_mid_body"].asBoolean()).isTrue()
        assertThat(chaos["slow_body_bps"].isNull).isTrue()
        assertThat(chaos["timeout_ms"].isNull).isTrue()
        assertThat(chaos["injected"]).isEqualTo(api.tree("""["abort_mid_body","duplicate"]"""))
        assertThat(chaos["body_bytes_sent"].asInt()).isEqualTo(BODY.length / 2)
        val second = chaos["duplicate_result"]
        assertThat(second.propertyNames()).containsExactlyInAnyOrder("status", "duration_ms", "error")
        assertThat(second["status"].isNull).isTrue()
        assertThat(second["error"].isNull).isTrue()
        assertThat(second["duration_ms"].isIntegralNumber).isTrue()
        assertThat(api.outbound(tokenId)).isEqualTo(api.tree("[$result]"))
    }

    @Test
    @DisplayName("Dado chaos vazio, quando reenvia, então o resultado ecoa os padrões, com null onde não há valor")
    fun chaosVazio_deveEcoarOsPadroes() {
        val receiver = Receiver { it.reply(201) }.closing()
        val tokenId = api.tokenId()

        val result = api.json(api.replay(tokenId, message(tokenId), """{"url":"${receiver.url()}","chaos":{}}"""))

        assertThat(result["status"].asInt()).isEqualTo(201)
        assertThat(result["chaos"]).isEqualTo(
            api.tree(
                """{"delay_ms":0,"duplicate":false,"abort_mid_body":false,"slow_body_bps":null,"timeout_ms":null,""" +
                    """"injected":[],"body_bytes_sent":null,"duplicate_result":null}""",
            ),
        )
    }

    @Test
    @DisplayName("Dado duplicate, quando o alvo responde as duas, então o status é o da primeira e o duplicate_result o da segunda")
    fun duplicata_deveTrazerAsDuasRespostas() {
        val count = AtomicInteger()
        val receiver = Receiver { it.reply(if (count.getAndIncrement() == 0) 201 else 409) }.closing()
        val tokenId = api.tokenId()

        val result = api.json(api.replay(tokenId, message(tokenId), """{"url":"${receiver.url()}","chaos":{"duplicate":true}}"""))

        assertThat(receiver.received).hasSize(2)
        assertThat(result["status"].asInt()).isEqualTo(201)
        assertThat(result["chaos"]["duplicate_result"]["status"].asInt()).isEqualTo(409)
        assertThat(result["chaos"]["duplicate_result"]["error"].isNull).isTrue()
    }

    @Test
    @DisplayName("Dado um histórico gravado antes do chaos, quando lê, então as entradas abrem como foram gravadas, sem a chave chaos")
    fun historicoAntigo_deveAbrirIgual() {
        val tokenId = api.tokenId()
        val old =
            """{"id":"${UUID.randomUUID()}","kind":"replay","at":"2026-09-28 10:00:00","target":"http://host.docker.internal:3000/p",""" +
                """"method":"POST","request_headers":{"content-type":"application/json"},"status":201,""" +
                """"headers":{"content-type":["application/json"]},"body":"{}","truncated":false,"duration_ms":14,""" +
                """"source_request":"${UUID.randomUUID()}"}"""
        redis.opsForList().leftPush(RedisKeys.outbound(TokenId(UUID.fromString(tokenId))), old)

        assertThat(api.outbound(tokenId)).isEqualTo(api.tree("[$old]"))
    }

    @Test
    @DisplayName("Dado 30 replays com duplicate no minuto, quando vem o 31º, então 429: a duplicata não conta outro disparo")
    fun duplicata_deveContarUmDisparo() {
        val receiver = Receiver().closing()
        val tokenId = api.tokenId()
        val requestId = message(tokenId)
        val body = """{"url":"${receiver.url()}","chaos":{"duplicate":true}}"""

        repeat(MAX_DISPATCHES_PER_WINDOW) { assertThat(api.replay(tokenId, requestId, body).statusCode()).isEqualTo(200) }

        assertThat(receiver.received).hasSize(2 * MAX_DISPATCHES_PER_WINDOW)
        assertThat(api.replay(tokenId, requestId, body).statusCode()).isEqualTo(429)
        assertThat(receiver.received).hasSize(2 * MAX_DISPATCHES_PER_WINDOW)
    }

    @Test
    @DisplayName("Dado chaos no send, quando envia, então é ignorado como qualquer campo desconhecido")
    fun send_deveIgnorarOChaos() {
        val receiver = Receiver().closing()
        val tokenId = api.tokenId()

        val result = api.json(api.sendOut(tokenId, """{"url":"${receiver.url()}","chaos":{"delay_ms":-1,"drop":1}}"""))

        assertThat(result["status"].asInt()).isEqualTo(200)
        assertThat(result.has("chaos")).isFalse()
        assertThat(receiver.received).hasSize(1)
    }
}
