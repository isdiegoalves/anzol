package site.webhook.wait

import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.TokenId
import site.webhook.WebhookProperties
import site.webhook.capture.RequestBatch
import site.webhook.capture.RequestStore
import site.webhook.rules.PathMatcher
import site.webhook.rules.RuleMatch
import site.webhook.stream.RequestStream
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.token.Token
import site.webhook.token.TokenStore
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Bem abaixo do prazo pedido nos testes que devem voltar antes dele. */
private val PROMPTLY: Duration = Duration.ofSeconds(3)
private const val LONG_TIMEOUT_MS = 20_000

@ApiTest
@DisplayName("POST /token/{id}/requests/wait")
class WaitApiTest(
    @LocalServerPort port: Int,
    private val jsonMapper: JsonMapper,
    private val stream: RequestStream,
    private val tokens: TokenStore,
    private val redis: StringRedisTemplate,
    private val properties: WebhookProperties,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun wait(
        tokenId: String,
        body: String,
    ): HttpResponse<String> = api.send("POST", "/token/$tokenId/requests/wait", body.toByteArray(), JSON_BODY)

    /** A chamada em outra thread, devolvida só depois de a escuta dela estar registrada no servidor. */
    private fun waitInBackground(
        tokenId: String,
        body: String,
    ): CompletableFuture<HttpResponse<String>> {
        val listening = stream.listenerCount(id(tokenId))
        val call = CompletableFuture.supplyAsync { wait(tokenId, body) }
        await().atMost(PROMPTLY).until { stream.listenerCount(id(tokenId)) > listening }
        return call
    }

    private fun id(tokenId: String) = TokenId(UUID.fromString(tokenId))

    private fun <T> timed(call: () -> T): Pair<T, Duration> {
        val start = System.nanoTime()
        val result = call()
        return result to Duration.ofNanos(System.nanoTime() - start)
    }

    private fun uuids(result: JsonNode): List<String> = result["requests"].toList().map { it["uuid"].asString() }

    @Nested
    @DisplayName("Mensagem no histórico")
    inner class History {
        @Test
        @DisplayName("Dado uma mensagem gravada que casa, quando espera, então responde na hora com a mensagem completa, como o GET dela")
        fun wait_mensagemNoHistorico_deveResponderNaHora() {
            val tokenId = api.tokenId()
            api.capture(tokenId, suffix = "/outro")
            val body = """{"s":"pago"}""".toByteArray()
            val pagamento = api.capture(tokenId, method = "POST", suffix = "/pagamentos?x=1", body = body, headers = JSON_BODY)

            val (response, elapsed) =
                timed { wait(tokenId, """{"match":{"method":["POST"],"path":{"equals":"/pagamentos"}},"timeout":$LONG_TIMEOUT_MS}""") }

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(api.json(response)).isEqualTo(
                api.tree("""{"matched":true,"count":1,"requests":[$pagamento],"near_miss":null}"""),
            )
            assertThat(elapsed).isLessThan(PROMPTLY)
            assertThat(stream.listenerCount(id(tokenId))).isZero()
        }

        @Test
        @DisplayName("Dado um corpo vazio, quando espera, então casa qualquer mensagem do histórico")
        fun wait_corpoVazio_deveCasarQualquerMensagem() {
            val tokenId = api.tokenId()
            val primeira = api.capture(tokenId)
            api.capture(tokenId)

            val response = api.send("POST", "/token/$tokenId/requests/wait")

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(uuids(api.json(response))).containsExactly(primeira["uuid"].asString())
        }
    }

    @Nested
    @DisplayName("Mensagem que chega durante a espera")
    inner class Arriving {
        @Test
        @DisplayName("Dado uma espera aberta, quando chega a mensagem que casa, então a chamada volta logo com ela, bem antes do prazo")
        fun wait_mensagemChegando_deveVoltarLogo() {
            val tokenId = api.tokenId()
            val call = waitInBackground(tokenId, """{"match":{"path":{"prefix":"/pedidos"}},"timeout":$LONG_TIMEOUT_MS}""")
            val start = System.nanoTime()

            api.capture(tokenId, suffix = "/outro")
            val pedido = api.capture(tokenId, method = "PUT", suffix = "/pedidos/42")

            val result = api.json(call.get(PROMPTLY.toMillis(), TimeUnit.MILLISECONDS))
            assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(PROMPTLY)
            assertThat(result).isEqualTo(api.tree("""{"matched":true,"count":1,"requests":[$pedido],"near_miss":null}"""))
            assertThat(stream.listenerCount(id(tokenId))).isZero()
        }

        @Test
        @DisplayName("Dado count=3 e after, quando as mensagens chegam uma a uma, então só volta com a 3ª, em ordem de seq, sem as antigas")
        fun wait_count3_deveEsperarATerceira() {
            val tokenId = api.tokenId()
            val antiga = api.capture(tokenId, method = "POST")
            val call =
                waitInBackground(tokenId, """{"match":{"method":["POST"]},"count":3,"after":${antiga["seq"]},"timeout":$LONG_TIMEOUT_MS}""")

            val primeira = api.capture(tokenId, method = "POST")
            api.capture(tokenId, method = "GET")
            val segunda = api.capture(tokenId, method = "POST")
            await().during(Duration.ofMillis(300)).atMost(PROMPTLY).until { !call.isDone }
            val terceira = api.capture(tokenId, method = "POST")

            val result = api.json(call.get(PROMPTLY.toMillis(), TimeUnit.MILLISECONDS))
            assertThat(result["matched"].asBoolean()).isTrue()
            assertThat(result["count"].asInt()).isEqualTo(3)
            assertThat(uuids(result)).containsExactly(primeira["uuid"].asString(), segunda["uuid"].asString(), terceira["uuid"].asString())
            assertThat(result["requests"].toList().map { it["seq"].asLong() }).isSorted()
        }

        @Test
        @DisplayName("Dado count=2 com uma mensagem no histórico, quando chega a segunda, então volta com as duas")
        fun wait_historicoMaisNova_deveSomar() {
            val tokenId = api.tokenId()
            val velha = api.capture(tokenId)
            val call = waitInBackground(tokenId, """{"count":2,"timeout":$LONG_TIMEOUT_MS}""")

            val nova = api.capture(tokenId)

            val result = api.json(call.get(PROMPTLY.toMillis(), TimeUnit.MILLISECONDS))
            assertThat(uuids(result)).containsExactly(velha["uuid"].asString(), nova["uuid"].asString())
        }

        @Test
        @DisplayName("Dado uma espera aberta, quando a URL é apagada, então a espera acaba na hora com o que houver")
        fun wait_urlApagada_deveEncerrar() {
            val tokenId = api.tokenId()
            val call = waitInBackground(tokenId, """{"match":{"method":["DELETE"]},"count":2,"timeout":$LONG_TIMEOUT_MS}""")
            api.capture(tokenId, method = "DELETE")

            api.send("DELETE", "/token/$tokenId")

            val response = call.get(PROMPTLY.toMillis(), TimeUnit.MILLISECONDS)
            assertThat(response.statusCode()).isEqualTo(200)
            val result = api.json(response)
            assertThat(result["matched"].asBoolean()).isFalse()
            assertThat(result["count"].asInt()).isEqualTo(1)
            assertThat(stream.listenerCount(id(tokenId))).isZero()
        }
    }

    @Nested
    @DisplayName("Prazo sem casar")
    inner class Timeout {
        @Test
        @DisplayName(
            "Dado mensagens que não casam, quando o prazo acaba, então matched=false com o near miss: menos falhas, empate na mais nova",
        )
        fun wait_prazoSemCasar_deveTrazerNearMiss() {
            val tokenId = api.tokenId()
            api.capture(tokenId, method = "GET", suffix = "/y")
            api.capture(tokenId, method = "PUT", suffix = "/y")
            val maisNova = api.capture(tokenId, method = "GET", suffix = "/x")

            val (response, elapsed) = timed { wait(tokenId, """{"match":{"method":["PUT"],"path":{"equals":"/x"}},"timeout":600}""") }

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(api.json(response)).isEqualTo(
                api.tree(
                    """{"matched":false,"count":0,"requests":[],"near_miss":{"uuid":"${maisNova["uuid"].asString()}",""" +
                        """"seq":${maisNova["seq"]},"failed":["method: expected PUT, got GET"],"conditions":["match.method"]}}""",
                ),
            )
            assertThat(elapsed).isBetween(Duration.ofMillis(600), PROMPTLY)
        }

        @Test
        @DisplayName("Dado timeout=0 numa URL vazia, quando espera, então responde na hora sem near miss")
        fun wait_timeoutZero_deveResponderNaHora() {
            val tokenId = api.tokenId()

            val (response, elapsed) = timed { wait(tokenId, """{"timeout":0}""") }

            assertThat(api.json(response)).isEqualTo(api.tree("""{"matched":false,"count":0,"requests":[],"near_miss":null}"""))
            assertThat(elapsed).isLessThan(Duration.ofMillis(500))
        }

        @Test
        @DisplayName("Dado count=2 e uma só mensagem que casa, quando o prazo acaba, então devolve a que casou com matched=false")
        fun wait_contagemIncompleta_deveDevolverAsQueCasaram() {
            val tokenId = api.tokenId()
            val unica = api.capture(tokenId, method = "POST")
            val outra = api.capture(tokenId, method = "GET")

            val result = api.json(wait(tokenId, """{"match":{"method":["POST"]},"count":2,"timeout":0}"""))

            assertThat(result["matched"].asBoolean()).isFalse()
            assertThat(result["count"].asInt()).isEqualTo(1)
            assertThat(uuids(result)).containsExactly(unica["uuid"].asString())
            assertThat(result["near_miss"]["uuid"].asString()).isEqualTo(outra["uuid"].asString())
        }
    }

    @Nested
    @DisplayName("Validação")
    inner class Validation {
        @Test
        @DisplayName("Dado um match inválido ou números fora dos limites, quando espera, então responde 422 com as chaves dos campos")
        fun wait_corpoInvalido_deveResponder422() {
            val tokenId = api.tokenId()

            val response = wait(tokenId, """{"match":{"path":{"regex":"("}},"count":0,"timeout":300001,"after":-1}""")

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/json")
            assertThat(api.json(response)).isEqualTo(
                api.tree(
                    """{"match.path.regex":["The regex is invalid."],"after":["The after must be at least 0."],""" +
                        """"count":["The count must be between 1 and 100."],"timeout":["The timeout must be between 0 and 300000."]}""",
                ),
            )
        }

        @Test
        @DisplayName("Dado um token inexistente, quando espera, então responde 410 antes de validar")
        fun wait_tokenInexistente_deveResponder410() {
            val response = wait("00000000-0000-4000-8000-000000000000", """{"count":0}""")

            assertThat(response.statusCode()).isEqualTo(410)
            assertThat(api.json(response)["error"]["message"].asString()).isEqualTo("Token not found")
        }
    }

    /**
     * A mensagem gravada depois da leitura do histórico e antes de a escuta existir se perderia. Aqui ela
     * é gravada (pelo webhook de verdade) logo depois de cada leitura do índice, antes de o resultado voltar
     * ao [RequestWaiter]: só a escuta registrada antes da leitura a vê.
     */
    @Nested
    @DisplayName("Escuta antes do histórico")
    inner class ListenBeforeHistory {
        @Test
        @DisplayName("Dado uma mensagem gravada logo depois da leitura do histórico, quando espera, então ela casa e a chamada volta logo")
        fun wait_mensagemEntreLeituraEEscuta_naoDeveSePerder() {
            val tokenId = api.tokenId()
            val token = checkNotNull(tokens.find(id(tokenId)))
            val sent = AtomicBoolean()
            val store =
                object : RequestStore(redis, jsonMapper, properties) {
                    override fun after(
                        token: Token,
                        after: Long,
                        limit: Long,
                    ): RequestBatch =
                        super.after(token, after, limit).also {
                            if (sent.compareAndSet(false, true)) api.send("POST", "/$tokenId/depois-da-leitura")
                        }
                }
            val match = RuleMatch(path = PathMatcher.Equals("/depois-da-leitura"))

            val (result, elapsed) = timed { RequestWaiter(store, stream).wait(token, WaitRequest(match, timeout = Duration.ofSeconds(5))) }

            assertThat(sent).isTrue()
            assertThat(result.matched).isTrue()
            assertThat(result.requests.single().method).isEqualTo("POST")
            assertThat(elapsed).isLessThan(PROMPTLY)
        }
    }
}
