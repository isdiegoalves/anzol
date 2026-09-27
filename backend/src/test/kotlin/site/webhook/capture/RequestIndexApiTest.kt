package site.webhook.capture

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import site.webhook.support.WHOLE_HASH_COMMANDS
import site.webhook.support.commandCalls
import site.webhook.support.resetCommandStats
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.time.Instant
import java.util.UUID

private const val EXPIRY_SECONDS = 604_800L

/** O índice ordenado `token:{uuid}:requests:index` ao lado da hash de mensagens. */
@ApiTest
@DisplayName("Índice ordenado das mensagens")
class RequestIndexApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)
    private val zset get() = redis.opsForZSet()
    private val hash get() = redis.opsForHash<String, String>()

    private fun hashKey(tokenId: String) = "token:$tokenId:requests"

    private fun indexKey(tokenId: String) = "token:$tokenId:requests:index"

    private fun uuids(
        tokenId: String,
        query: String = "",
    ): List<String> {
        val page = api.json(api.send("GET", "/token/$tokenId/requests?$query", headers = JSON_CLIENT))
        return page["data"].toList().map { it["uuid"].asString() }
    }

    private fun total(tokenId: String): Int = api.json(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT))["total"].asInt()

    @Nested
    @DisplayName("Mensagens novas")
    inner class NewMessages {
        @Test
        @DisplayName("Dado 20 mensagens no mesmo segundo, quando lista, então oldest segue a ordem de chegada e newest a inverte")
        fun all_mesmoSegundo_deveSeguirOrdemDeChegada() {
            val tokenId = api.tokenId()
            val sent =
                (1..20).map {
                    api
                        .send("GET", "/$tokenId")
                        .headers()
                        .firstValue("X-Request-Id")
                        .orElseThrow()
                }

            assertThat(uuids(tokenId)).containsExactlyElementsOf(sent)
            assertThat(uuids(tokenId, "sorting=newest")).containsExactlyElementsOf(sent.reversed())
            assertThat(uuids(tokenId, "per_page=5&page=2")).containsExactlyElementsOf(sent.subList(5, 10))
        }

        @Test
        @DisplayName("Dado mensagens gravadas, quando olha o Redis, então hash e índice têm os mesmos uuids e o TTL de 7 dias")
        fun store_mensagens_deveManterHashEIndiceCoerentes() {
            val tokenId = api.tokenId()
            repeat(3) { api.send("GET", "/$tokenId") }

            assertThat(zset.range(indexKey(tokenId), 0, -1)).containsExactlyInAnyOrderElementsOf(hash.keys(hashKey(tokenId)))
            assertThat(zset.size(indexKey(tokenId))).isEqualTo(3)
            assertThat(redis.getExpire(indexKey(tokenId))).isBetween(EXPIRY_SECONDS - 5, EXPIRY_SECONDS)
        }

        @Test
        @DisplayName("Dado uma mensagem lida pelo id, quando o TTL tinha baixado, então renova hash e índice")
        fun find_mensagem_deveRenovarTtlDasDuasChaves() {
            val tokenId = api.tokenId()
            val requestId =
                api
                    .send("GET", "/$tokenId")
                    .headers()
                    .firstValue("X-Request-Id")
                    .orElseThrow()
            listOf(hashKey(tokenId), indexKey(tokenId)).forEach { redis.expire(it, Duration.ofSeconds(60)) }

            api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT)

            assertThat(redis.getExpire(hashKey(tokenId))).isBetween(EXPIRY_SECONDS - 5, EXPIRY_SECONDS)
            assertThat(redis.getExpire(indexKey(tokenId))).isBetween(EXPIRY_SECONDS - 5, EXPIRY_SECONDS)
        }

        @Test
        @DisplayName("Dado uma mensagem apagada, quando lista, então some da hash, do índice e do total")
        fun delete_umaMensagem_deveTirarDoIndice() {
            val tokenId = api.tokenId()
            val (first, second) =
                (1..2).map {
                    api
                        .send("GET", "/$tokenId")
                        .headers()
                        .firstValue("X-Request-Id")
                        .orElseThrow()
                }

            api.send("DELETE", "/token/$tokenId/request/$first", headers = JSON_CLIENT)

            assertThat(uuids(tokenId)).containsExactly(second)
            assertThat(total(tokenId)).isEqualTo(1)
            assertThat(zset.range(indexKey(tokenId), 0, -1)).containsExactly(second)
        }

        @Test
        @DisplayName("Dado mensagens, quando apaga todas, então a hash e o índice deixam de existir")
        fun deleteAll_mensagens_deveApagarAsDuasChaves() {
            val tokenId = api.tokenId()
            repeat(2) { api.send("GET", "/$tokenId") }

            api.send("DELETE", "/token/$tokenId/request", headers = JSON_CLIENT)

            assertThat(redis.hasKey(hashKey(tokenId))).isFalse()
            assertThat(redis.hasKey(indexKey(tokenId))).isFalse()
        }
    }

    /** Mensagens gravadas antes do índice existir: só a hash, com `created_at` em segundos. */
    @Nested
    @DisplayName("Hash antiga, sem índice")
    inner class LegacyHash {
        private val tokenId = UUID.randomUUID().toString()
        private val older = UUID.randomUUID().toString()
        private val middle = UUID.randomUUID().toString()
        private val newer = UUID.randomUUID().toString()

        private fun seed() {
            redis.opsForValue().set("token:$tokenId", legacyToken(tokenId), Duration.ofSeconds(EXPIRY_SECONDS))
            hash.putAll(
                hashKey(tokenId),
                mapOf(
                    newer to legacyMessage(tokenId, newer, "2026-09-20 10:00:00", "?created_at=1999-01-01 00:00:00"),
                    older to legacyMessage(tokenId, older, "2025-12-31 23:59:59"),
                    "fantasma" to "",
                    middle to legacyMessage(tokenId, middle, "2026-01-01 00:00:00"),
                ),
            )
            redis.expire(hashKey(tokenId), Duration.ofSeconds(3_600))
        }

        @Test
        @DisplayName("Dado uma hash sem índice, quando lista e conta, então ordena pelo created_at, conta tudo e monta o índice")
        fun all_hashSemIndice_deveListarContarEOrdenar() {
            seed()

            val oldest = uuids(tokenId)
            val newest = uuids(tokenId, "sorting=newest")

            assertThat(oldest).containsExactly(older, middle, newer)
            assertThat(newest).containsExactly(newer, middle, older)
            assertThat(total(tokenId)).isEqualTo(4)
            assertThat(zset.size(indexKey(tokenId))).isEqualTo(4)
            assertThat(zset.score(indexKey(tokenId), older)).isEqualTo(Instant.parse("2025-12-31T23:59:59Z").epochSecond * 1e6)
            assertThat(zset.score(indexKey(tokenId), "fantasma")).isZero()
            assertThat(redis.getExpire(indexKey(tokenId))).isBetween(3_595L, 3_600L)
        }

        @Test
        @DisplayName("Dado uma hash sem índice, quando chega mensagem nova antes de qualquer leitura, então as antigas continuam listadas")
        fun store_hashSemIndice_naoDeveEsconderAsAntigas() {
            seed()

            val arrived =
                api
                    .send("GET", "/$tokenId")
                    .headers()
                    .firstValue("X-Request-Id")
                    .orElseThrow()

            assertThat(uuids(tokenId)).containsExactly(older, middle, newer, arrived)
            assertThat(total(tokenId)).isEqualTo(5)
        }

        @Test
        @DisplayName("Dado uma hash já indexada, quando lista de novo, então não relê a hash inteira")
        fun all_hashJaIndexada_naoDeveReler() {
            seed()
            uuids(tokenId)
            redis.resetCommandStats()

            uuids(tokenId)
            uuids(tokenId, "sorting=newest")

            assertThat(redis.commandCalls().filterKeys { it in WHOLE_HASH_COMMANDS }).isEmpty()
        }
    }

    /**
     * Mensagens antigas do mesmo segundo (o app Laravel gravava `created_at` em segundos): 150 na hash sem índice, em
     * grupos de 7 por segundo, para o lote de 100 do wait-for cair no meio de um grupo. Nenhuma pode ser pulada.
     */
    @Nested
    @DisplayName("Hash antiga com várias mensagens no mesmo segundo")
    inner class SameSecond {
        private val tokenId = UUID.randomUUID().toString()
        private val total = 150
        private val perSecond = 7

        /** Os uuids semeados, do segundo mais antigo para o mais novo (dentro do segundo, a ordem é do backfill). */
        private fun seed(): List<String> {
            redis.opsForValue().set("token:$tokenId", legacyToken(tokenId), Duration.ofSeconds(EXPIRY_SECONDS))
            val ids = List(total) { UUID.randomUUID().toString() }
            val start = Instant.parse("2026-01-01T00:00:00Z")
            hash.putAll(
                hashKey(tokenId),
                ids
                    .mapIndexed { i, id ->
                        val createdAt =
                            start
                                .plusSeconds((i / perSecond).toLong())
                                .toString()
                                .replace("T", " ")
                                .removeSuffix("Z")
                        id to legacyMessage(tokenId, id, createdAt)
                    }.toMap(),
            )
            return ids
        }

        private fun listed(query: String): JsonNode = api.json(api.send("GET", "/token/$tokenId/requests?$query", headers = JSON_CLIENT))

        private fun wait(body: String): JsonNode =
            api.json(api.send("POST", "/token/$tokenId/requests/wait", body.toByteArray(), JSON_BODY))

        @Test
        @DisplayName("Dado mensagens antigas do mesmo segundo, quando o índice é montado, então cada uma ganha um seq próprio")
        fun backfill_mesmoSegundo_deveDarSeqDistintos() {
            val ids = seed()

            val page = listed("per_page=$total")["data"].toList()

            assertThat(page.map { it["uuid"].asString() }).containsExactlyInAnyOrderElementsOf(ids)
            assertThat(page.map { it["seq"].asLong() }.toSet()).hasSize(total)
            assertThat(page.map { it["created_at"].asString() }).isSorted()
        }

        @Test
        @DisplayName("Dado mensagens antigas do mesmo segundo, quando lista com after de cada uma, então vêm exatamente as seguintes")
        fun after_mesmoSegundo_naoDevePularIrmas() {
            seed()
            val ordered = listed("per_page=$total")["data"].toList().map { it["uuid"].asString() to it["seq"].asLong() }

            ordered.forEachIndexed { i, (_, seq) ->
                val next = listed("after=$seq&per_page=$total")["data"].toList().map { it["uuid"].asString() }
                assertThat(next).describedAs("after da %sª", i + 1).containsExactlyElementsOf(ordered.drop(i + 1).map { it.first })
            }
        }

        @Test
        @DisplayName(
            "Dado 150 mensagens antigas em grupos do mesmo segundo, quando o wait-for pede 100 e depois o resto, então vêm todas, " +
                "sem pular nem repetir",
        )
        fun wait_mesmoSegundo_deveDevolverTodas() {
            seed()
            val ordered = listed("per_page=$total")["data"].toList().map { it["uuid"].asString() }

            val first = wait("""{"count":100,"timeout":0}""")
            val last = first["requests"].last()["seq"].asLong()
            val rest = wait("""{"after":$last,"count":100,"timeout":0}""")

            val all = (first["requests"].toList() + rest["requests"].toList()).map { it["uuid"].asString() }
            assertThat(first["count"].asInt()).isEqualTo(100)
            assertThat(rest["count"].asInt()).isEqualTo(total - 100)
            assertThat(all).containsExactlyElementsOf(ordered)
        }

        @Test
        @DisplayName(
            "Dado um índice já montado com seq repetido e uma mensagem antiga fora dele no mesmo segundo, quando o backfill a põe, " +
                "então os seq antigos não mudam e ela ganha um seq livre",
        )
        fun backfill_indiceExistente_naoDeveMudarSeqAntigos() {
            redis.opsForValue().set("token:$tokenId", legacyToken(tokenId), Duration.ofSeconds(EXPIRY_SECONDS))
            val indexed = List(3) { UUID.randomUUID().toString() }
            val extra = UUID.randomUUID().toString()
            hash.putAll(hashKey(tokenId), (indexed + extra).associateWith { legacyMessage(tokenId, it, "2026-01-01 00:00:00") })
            val second = Instant.parse("2026-01-01T00:00:00Z").epochSecond * 1_000_000.0
            indexed.forEach { zset.add(indexKey(tokenId), it, second) }
            zset.add(indexKey(tokenId), UUID.randomUUID().toString().also { hash.put(hashKey(tokenId), it, "") }, second + 1)

            listed("per_page=10")

            assertThat(indexed.map { zset.score(indexKey(tokenId), it) }).containsOnly(second)
            assertThat(zset.score(indexKey(tokenId), extra)).isNotIn(second, second + 1)
        }
    }

    private fun legacyToken(tokenId: String) =
        """{"uuid":"$tokenId","ip":"1.1.1.1","user_agent":null,"default_content":"","default_status":200,""" +
            """"default_content_type":"text\/plain","timeout":0,"created_at":"2025-12-01 00:00:00","updated_at":"2025-12-01 00:00:00"}"""

    /** `query` pode ter uma chave `created_at` própria: o backfill só olha a de primeiro nível. */
    private fun legacyMessage(
        tokenId: String,
        id: String,
        createdAt: String,
        query: String = "",
    ): String {
        val queryJson = if (query.isEmpty()) "null" else """{"created_at":"${query.substringAfter('=')}"}"""
        return """{"uuid":"$id","token_id":"$tokenId","ip":"1.1.1.1","hostname":"localhost","method":"GET",""" +
            """"user_agent":null,"content":"","query":$queryJson,"headers":{"host":["localhost"]},""" +
            """"url":"http:\/\/localhost\/$tokenId$query","created_at":"$createdAt","updated_at":"$createdAt","request":null}"""
    }
}
