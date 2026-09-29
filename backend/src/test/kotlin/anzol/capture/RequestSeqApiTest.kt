package anzol.capture

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_CLIENT
import anzol.support.SseClient
import anzol.support.WHOLE_HASH_COMMANDS
import anzol.support.commandCalls
import anzol.support.resetCommandStats
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.util.concurrent.Executors

private const val SENDERS = 20
private const val CONCURRENT_MESSAGES = 200

/** `seq` de cada mensagem (o score do índice) e a listagem incremental `after=<seq>`. */
@ApiTest
@DisplayName("seq das mensagens e listagem after")
class RequestSeqApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun indexKey(tokenId: String) = "token:$tokenId:requests:index"

    private fun send(tokenId: String): String =
        api
            .send("GET", "/$tokenId")
            .headers()
            .firstValue("X-Request-Id")
            .orElseThrow()

    private fun list(
        tokenId: String,
        query: String,
    ): JsonNode = api.json(api.send("GET", "/token/$tokenId/requests?$query", headers = JSON_CLIENT))

    private fun JsonNode.uuids(): List<String> = this["data"].toList().map { it["uuid"].asString() }

    private fun JsonNode.seqs(): List<Long> = this["data"].toList().map { it["seq"].asLong() }

    @Nested
    @DisplayName("seq")
    inner class Seq {
        @Test
        @DisplayName("Dado uma mensagem gravada, quando lê pela listagem, pelo GET e pelo evento, então o seq é o score do índice nos três")
        fun seq_umaMensagem_deveSerOScoreDoIndiceNosTresLugares() {
            val tokenId = api.tokenId()
            SseClient("${api.base}/token/$tokenId/stream").use { client ->
                val requestId = send(tokenId)

                await().atMost(Duration.ofSeconds(5)).until { client.events.isNotEmpty() }
                val score = redis.opsForZSet().score(indexKey(tokenId), requestId)?.toLong()
                val fromEvent = api.tree(client.events.single().data)["request"]["seq"]
                val fromFind = api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT))["seq"]
                val fromList = list(tokenId, "")["data"][0]["seq"]
                assertThat(score).isNotNull().isPositive()
                assertThat(listOf(fromEvent, fromFind, fromList).map { it.isIntegralNumber }).containsOnly(true)
                assertThat(listOf(fromEvent, fromFind, fromList).map { it.asLong() }).containsOnly(score)
            }
        }

        @Test
        @DisplayName("Dado 200 mensagens de 20 threads, quando lista, então o seq cresce estritamente e o evento traz o mesmo seq")
        fun seq_gravacaoConcorrente_deveCrescerEstritamenteEBaterComOEvento() {
            val tokenId = api.tokenId()
            SseClient("${api.base}/token/$tokenId/stream").use { client ->
                Executors.newFixedThreadPool(SENDERS).use { pool -> repeat(CONCURRENT_MESSAGES) { pool.submit { send(tokenId) } } }

                await().atMost(Duration.ofSeconds(10)).until { client.events.size == CONCURRENT_MESSAGES }
                val page = list(tokenId, "per_page=$CONCURRENT_MESSAGES")
                val listed = page.uuids().zip(page.seqs()).toMap()
                val published = client.events.map { api.tree(it.data)["request"] }.associate { it["uuid"].asString() to it["seq"].asLong() }
                assertThat(page.seqs()).hasSize(CONCURRENT_MESSAGES).isSorted().doesNotHaveDuplicates()
                assertThat(published).isEqualTo(listed)
            }
        }

        @Test
        @DisplayName("Dado mensagens gravadas, quando olha a hash no Redis, então o JSON gravado continua sem seq")
        fun seq_mensagemGravada_naoDeveEntrarNoJsonDaHash() {
            val tokenId = api.tokenId()
            val requestId = send(tokenId)

            val stored = api.tree(redis.opsForHash<String, String>().get("token:$tokenId:requests", requestId).orEmpty())

            assertThat(stored.has("seq")).isFalse()
            assertThat(stored["uuid"].asString()).isEqualTo(requestId)
        }
    }

    @Nested
    @DisplayName("after")
    inner class After {
        @Test
        @DisplayName("Dado 5 mensagens, quando lista after o seq da 2ª com per_page 2, então devolve 3ª e 4ª em ordem e depois só a 5ª")
        fun all_after_deveDevolverAsSeguintesEmOrdemAtePerPage() {
            val tokenId = api.tokenId()
            val sent = (1..5).map { send(tokenId) }
            val seqs = list(tokenId, "").seqs()

            val first = list(tokenId, "after=${seqs[1]}&per_page=2")
            val second = list(tokenId, "after=${first.seqs().last()}&per_page=2")

            assertThat(first.uuids()).containsExactly(sent[2], sent[3])
            assertThat(first["is_last_page"].asBoolean()).isFalse()
            assertThat(second.uuids()).containsExactly(sent[4])
            assertThat(second["is_last_page"].asBoolean()).isTrue()
            assertThat(second["total"].asInt()).isEqualTo(5)
        }

        @Test
        @DisplayName("Dado after 0 com page e sorting, quando lista, então ignora os dois e devolve da mais antiga para a mais nova")
        fun all_afterZero_deveIgnorarPageESorting() {
            val tokenId = api.tokenId()
            val sent = (1..3).map { send(tokenId) }

            val page = list(tokenId, "after=0&page=3&sorting=newest&per_page=2")

            assertThat(page.uuids()).containsExactly(sent[0], sent[1])
            assertThat(page["current_page"].asInt()).isEqualTo(1)
            assertThat(page["is_last_page"].asBoolean()).isFalse()
        }

        @Test
        @DisplayName("Dado o seq de uma mensagem apagada, quando lista after ele, então devolve as mais novas que ela")
        fun all_afterMensagemApagada_deveDevolverAsMaisNovas() {
            val tokenId = api.tokenId()
            val sent = (1..3).map { send(tokenId) }
            val deletedSeq = list(tokenId, "").seqs()[1]
            api.send("DELETE", "/token/$tokenId/request/${sent[1]}", headers = JSON_CLIENT)

            val page = list(tokenId, "after=$deletedSeq")

            assertThat(page.uuids()).containsExactly(sent[2])
            assertThat(page["is_last_page"].asBoolean()).isTrue()
        }

        @Test
        @DisplayName("Dado o seq da mais nova, quando lista after ele, então devolve lista vazia e última página")
        fun all_afterMaisNova_deveDevolverVazio() {
            val tokenId = api.tokenId()
            repeat(2) { send(tokenId) }
            val newest = list(tokenId, "").seqs().last()

            val page = list(tokenId, "after=$newest")

            assertThat(page["data"].size()).isZero()
            assertThat(page["is_last_page"].asBoolean()).isTrue()
            assertThat(page["total"].asInt()).isEqualTo(2)
        }

        @Test
        @DisplayName("Dado muitas mensagens, quando lista after, então lê só o trecho pelo índice, sem ler a hash inteira")
        fun all_after_naoDeveLerAHashInteira() {
            val tokenId = api.tokenId()
            repeat(30) { send(tokenId) }
            val after = list(tokenId, "per_page=1").seqs().single()
            redis.resetCommandStats()

            val page = list(tokenId, "after=$after&per_page=5")

            assertThat(page["data"].size()).isEqualTo(5)
            assertThat(redis.commandCalls().filterKeys { it in WHOLE_HASH_COMMANDS }).isEmpty()
            assertThat(redis.commandCalls()).containsKey("zrangebyscore")
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado after inválido, quando lista, então responde 422 com a mensagem no estilo do Laravel")
        @CsvSource(
            delimiter = '|',
            value = [
                "after=abc      | {\"after\":[\"The after must be an integer.\"]}",
                "after=1.5      | {\"after\":[\"The after must be an integer.\"]}",
                "after%5B%5D=1  | {\"after\":[\"The after must be an integer.\"]}",
                "after=-1       | {\"after\":[\"The after must be at least 0.\"]}",
            ],
        )
        fun all_afterInvalido_deveResponder422(
            query: String,
            expected: String,
        ) {
            val tokenId = api.tokenId()

            val response = api.send("GET", "/token/$tokenId/requests?$query", headers = JSON_CLIENT)

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(api.tree(expected))
        }
    }
}
