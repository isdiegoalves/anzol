package site.webhook.privacy

import io.micrometer.core.instrument.MeterRegistry
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import site.webhook.support.SseClient
import site.webhook.support.rawHttp
import tools.jackson.databind.json.JsonMapper
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.util.Base64
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val SECRET = "segredo-de-leitura-Q7x"
private const val OTHER_SECRET = "outro-segredo-Z9k"
private const val PROTECTED = """{"error":"This URL is protected","protected":true}"""
private val PROMPTLY = Duration.ofSeconds(5)

/** Segredo de leitura da URL (§1 do item 12): proteção, cabeçalho, cookie de desbloqueio, limite de falhas e formato. */
@ApiTest
@DisplayName("Segredo de leitura da URL")
class ReadSecretApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
    private val registry: MeterRegistry,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun protectedToken(secret: String = SECRET): String = api.tokenId("""{"read_secret":"$secret"}""")

    private fun get(
        path: String,
        headers: Map<String, String> = emptyMap(),
    ): HttpResponse<String> = api.send("GET", path, headers = JSON_CLIENT + headers)

    private fun withSecret(secret: String) = mapOf(SECRET_HEADER to secret)

    private fun withCookie(value: String) = mapOf("Cookie" to "$ACCESS_COOKIE=$value")

    private fun unlock(
        tokenId: String,
        secret: String,
        headers: Map<String, String> = emptyMap(),
    ): HttpResponse<String> = api.send("POST", "/token/$tokenId/unlock", """{"secret":"$secret"}""".toByteArray(), JSON_BODY + headers)

    private fun put(
        tokenId: String,
        json: String,
        headers: Map<String, String> = emptyMap(),
    ): HttpResponse<String> = api.send("PUT", "/token/$tokenId", json.toByteArray(), JSON_BODY + headers)

    /** O valor do `wh_access` no `Set-Cookie` do unlock certo. */
    private fun cookieOf(response: HttpResponse<String>): String =
        response
            .headers()
            .firstValue("Set-Cookie")
            .orElseThrow()
            .substringAfter("$ACCESS_COOKIE=")
            .substringBefore(';')

    @Nested
    @DisplayName("Definir, trocar e remover")
    inner class Settings {
        @Test
        @DisplayName(
            "Dado um POST /token com read_secret, quando cria, então responde protected true e nunca o segredo nem o hash",
        )
        fun criar_comSegredo_deveResponderProtegidoSemSegredo() {
            val response = api.send("POST", "/token", """{"read_secret":"$SECRET"}""".toByteArray(), JSON_BODY)

            val token = api.json(response)
            assertThat(response.statusCode()).isEqualTo(201)
            assertThat(token["protected"].asBoolean()).isTrue()
            assertThat(response.body()).doesNotContain(SECRET, "read_secret", "hash", "salt", "secret_version")
            val read = get("/token/${token["uuid"].asString()}", withSecret(SECRET))
            assertThat(read.body()).doesNotContain(SECRET, "read_secret", "hash", "salt", "secret_version")
            assertThat(api.json(read)["protected"].asBoolean()).isTrue()
        }

        @Test
        @DisplayName(
            "Dado um segredo definido, quando o Redis guarda o token, então é PBKDF2-HMAC-SHA256 com 210000 iterações, sal de " +
                "16 bytes, hash de 32 e versão 1, sem o texto",
        )
        fun redis_segredo_deveGuardarSoOPbkdf2() {
            val tokenId = protectedToken()

            val raw = redis.opsForValue().get("token:$tokenId").orEmpty()
            val stored = api.tree(raw)
            val hash = stored["read_secret_hash"]
            assertThat(raw).doesNotContain(SECRET)
            assertThat(hash["algorithm"].asString()).isEqualTo("PBKDF2WithHmacSHA256")
            assertThat(hash["iterations"].asInt()).isGreaterThanOrEqualTo(210_000)
            assertThat(Base64.getDecoder().decode(hash["salt"].asString())).hasSize(16)
            assertThat(Base64.getDecoder().decode(hash["hash"].asString())).hasSize(32)
            assertThat(stored["secret_version"].asLong()).isEqualTo(1)
        }

        @Test
        @DisplayName("Dado o mesmo segredo em duas URLs, quando grava, então o sal e o hash são diferentes (sal aleatório)")
        fun redis_mesmoSegredo_deveTerSalDiferente() {
            val first = api.tree(redis.opsForValue().get("token:${protectedToken()}").orEmpty())["read_secret_hash"]
            val second = api.tree(redis.opsForValue().get("token:${protectedToken()}").orEmpty())["read_secret_hash"]

            assertThat(first["salt"]).isNotEqualTo(second["salt"])
            assertThat(first["hash"]).isNotEqualTo(second["hash"])
        }

        @ParameterizedTest(name = "[{index}] {0}")
        @ValueSource(strings = ["""{"read_secret":"curto77"}""", """{"read_secret":""}""", """{"read_secret":12345678}"""])
        @DisplayName("Dado um read_secret fora de 8..256 ou que não é texto, quando cria, então 422 sem repetir o valor")
        fun criar_segredoInvalido_deveResponder422(body: String) {
            val response = api.send("POST", "/token", body.toByteArray(), JSON_BODY)

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)["read_secret"][0].asString()).startsWith("The read secret must be")
            assertThat(response.body()).doesNotContain("curto77", "12345678")
        }

        @Test
        @DisplayName("Dado um read_secret de 257 caracteres, quando cria, então 422; com 8 e com 256, 201")
        fun criar_limitesDoTamanho() {
            val tooLong = api.send("POST", "/token", """{"read_secret":"${"a".repeat(257)}"}""".toByteArray(), JSON_BODY)
            val min = api.send("POST", "/token", """{"read_secret":"12345678"}""".toByteArray(), JSON_BODY)
            val max = api.send("POST", "/token", """{"read_secret":"${"b".repeat(256)}"}""".toByteArray(), JSON_BODY)

            assertThat(tooLong.statusCode()).isEqualTo(422)
            assertThat(api.json(tooLong)["read_secret"][0].asString()).isEqualTo("The read secret must be between 8 and 256 characters.")
            assertThat(min.statusCode()).isEqualTo(201)
            assertThat(max.statusCode()).isEqualTo(201)
        }

        @Test
        @DisplayName(
            "Dado o read_secret na query, quando cria, então 422 (segredo só no corpo) e nenhuma URL fica achando que está protegida",
        )
        fun criar_segredoNaQuery_deveResponder422() {
            val response = api.send("POST", "/token?read_secret=$SECRET", "{}".toByteArray(), JSON_BODY)

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)["read_secret"][0].asString()).isEqualTo("The read secret must be sent in the request body.")
        }

        @Test
        @DisplayName("Dado uma URL protegida, quando o PUT vem sem read_secret, então mantém a proteção (exceção deliberada)")
        fun put_semCampo_deveManterProtecao() {
            val tokenId = protectedToken()

            val updated = put(tokenId, """{"default_status":201}""", withSecret(SECRET))

            assertThat(updated.statusCode()).isEqualTo(200)
            assertThat(api.json(updated)["protected"].asBoolean()).isTrue()
            assertThat(get("/token/$tokenId").statusCode()).isEqualTo(401)
            assertThat(get("/token/$tokenId", withSecret(SECRET)).statusCode()).isEqualTo(200)
        }

        @Test
        @DisplayName("Dado uma URL protegida, quando o PUT manda read_secret null, então remove: a URL abre sem segredo")
        fun put_nulo_deveRemoverProtecao() {
            val tokenId = protectedToken()

            val updated = put(tokenId, """{"read_secret":null}""", withSecret(SECRET))

            assertThat(api.json(updated)["protected"].asBoolean()).isFalse()
            assertThat(get("/token/$tokenId").statusCode()).isEqualTo(200)
            assertThat(api.tree(redis.opsForValue().get("token:$tokenId").orEmpty())["secret_version"].asLong()).isEqualTo(2)
        }

        @Test
        @DisplayName("Dado uma URL protegida, quando o PUT troca o segredo, então o antigo deixa de valer e o novo vale")
        fun put_texto_deveTrocarSegredo() {
            val tokenId = protectedToken()

            put(tokenId, """{"read_secret":"$OTHER_SECRET"}""", withSecret(SECRET))

            assertThat(get("/token/$tokenId", withSecret(SECRET)).statusCode()).isEqualTo(401)
            assertThat(get("/token/$tokenId", withSecret(OTHER_SECRET)).statusCode()).isEqualTo(200)
        }

        @Test
        @DisplayName("Dado uma URL sem proteção, quando o PUT define um segredo, então passa a exigir o segredo")
        fun put_definir_deveProteger() {
            val tokenId = api.tokenId()

            val updated = put(tokenId, """{"read_secret":"$SECRET"}""")

            assertThat(api.json(updated)["protected"].asBoolean()).isTrue()
            assertThat(get("/token/$tokenId").statusCode()).isEqualTo(401)
        }
    }

    @Nested
    @DisplayName("Acesso pelo cabeçalho")
    inner class Header {
        @Test
        @DisplayName(
            "Dado uma URL protegida, quando lê sem nada, com o segredo errado e com o certo, então 401, 401 e 200; a captura continua 200",
        )
        fun acesso_cabecalho_deveExigirOSegredoCerto() {
            val tokenId = protectedToken()

            val without = get("/token/$tokenId")
            val wrong = get("/token/$tokenId", withSecret("errado-errado"))
            val right = get("/token/$tokenId/requests", withSecret(SECRET))
            val capture = api.send("POST", "/$tokenId/qualquer", "oi".toByteArray())

            assertThat(without.statusCode()).isEqualTo(401)
            assertThat(without.body()).isEqualTo(PROTECTED)
            assertThat(without.headers().firstValue("Content-Type")).hasValue("application/json")
            assertThat(wrong.statusCode()).isEqualTo(401)
            assertThat(wrong.body()).isEqualTo(PROTECTED)
            assertThat(right.statusCode()).isEqualTo(200)
            assertThat(capture.statusCode()).isEqualTo(200)
            assertThat(api.json(get("/token/$tokenId/requests", withSecret(SECRET)))["total"].asInt()).isEqualTo(1)
        }

        @Test
        @DisplayName("Dado um segredo com acento, quando o CLI o manda em UTF-8 no cabeçalho, então confere")
        fun acesso_cabecalhoUtf8_deveConferir() {
            val secret = "senha-çãõ-ü-123"
            val tokenId = protectedToken(secret)
            val header = String(secret.toByteArray(UTF_8), ISO_8859_1)

            val response = rawHttp(port, "GET /token/$tokenId HTTP/1.1", listOf("$SECRET_HEADER: $header", "Accept: application/json"))

            assertThat(response.status).isEqualTo(200)
        }

        @Test
        @DisplayName("Dado uma URL que não existe, quando lê com ou sem segredo, então 410 de sempre")
        fun acesso_urlInexistente_deveResponder410() {
            val id = UUID.randomUUID()

            assertThat(get("/token/$id").statusCode()).isEqualTo(410)
            assertThat(get("/token/$id", withSecret(SECRET)).statusCode()).isEqualTo(410)
        }
    }

    @Nested
    @DisplayName("Desbloqueio por cookie")
    inner class Cookie {
        @Test
        @DisplayName(
            "Dado o segredo certo, quando desbloqueia, então 204 com cookie HttpOnly, SameSite=Strict, Path da URL, 30 dias e " +
                "sem Secure em HTTP",
        )
        fun unlock_certo_deveDarCookie() {
            val tokenId = protectedToken()

            val response = unlock(tokenId, SECRET)

            val cookie = response.headers().firstValue("Set-Cookie").orElseThrow()
            assertThat(response.statusCode()).isEqualTo(204)
            assertThat(cookie).startsWith("$ACCESS_COOKIE=")
            assertThat(cookie.split("; ")).contains("Path=/token/$tokenId", "Max-Age=2592000", "HttpOnly", "SameSite=Strict")
            assertThat(cookie).doesNotContain("Secure", SECRET)
        }

        @Test
        @DisplayName("Dado um proxy HTTPS (X-Forwarded-Proto: https), quando desbloqueia, então o cookie é Secure")
        fun unlock_https_deveMarcarSecure() {
            val tokenId = protectedToken()

            val response = unlock(tokenId, SECRET, mapOf("X-Forwarded-Proto" to "https"))

            assertThat(
                response
                    .headers()
                    .firstValue("Set-Cookie")
                    .orElseThrow()
                    .split("; "),
            ).contains("Secure")
        }

        @Test
        @DisplayName("Dado o cookie do desbloqueio, quando lê a URL, as mensagens e o raw, então 200; o cookie é HMAC(chave, id:versão)")
        fun cookie_deveDarAcessoEValerOHmac() {
            val tokenId = protectedToken()
            val requestId =
                api
                    .send("POST", "/$tokenId", "oi".toByteArray())
                    .headers()
                    .firstValue("X-Request-Id")
                    .orElseThrow()

            val cookie = cookieOf(unlock(tokenId, SECRET))

            assertThat(get("/token/$tokenId", withCookie(cookie)).statusCode()).isEqualTo(200)
            assertThat(get("/token/$tokenId/requests", withCookie(cookie)).statusCode()).isEqualTo(200)
            assertThat(get("/token/$tokenId/request/$requestId/raw", withCookie(cookie)).body()).isEqualTo("oi")
            assertThat(cookie).isEqualTo(expectedCookie(tokenId, version = 1))
            assertThat(redis.getExpire(SERVER_KEY)).isEqualTo(-1)
        }

        @Test
        @DisplayName("Dado o cookie de uma URL, quando lê outra URL protegida, então 401")
        fun cookie_deOutraUrl_naoDeveAbrir() {
            val first = protectedToken()
            val second = protectedToken()

            val cookie = cookieOf(unlock(first, SECRET))

            assertThat(get("/token/$second", withCookie(cookie)).statusCode()).isEqualTo(401)
        }

        @Test
        @DisplayName("Dado o cookie, quando assina o SSE, então recebe o request.created; sem ele, 401")
        fun cookie_deveAbrirOSse() {
            val tokenId = protectedToken()
            val cookie = cookieOf(unlock(tokenId, SECRET))

            SseClient("${api.base}/token/$tokenId/stream").use { denied ->
                assertThat(denied.response.statusCode()).isEqualTo(401)
            }
            SseClient("${api.base}/token/$tokenId/stream", withCookie(cookie)).use { client ->
                assertThat(client.response.statusCode()).isEqualTo(200)
                api.send("POST", "/$tokenId", "pelo-sse".toByteArray())
                await().atMost(PROMPTLY).until { client.events.isNotEmpty() }
                assertThat(client.events.first().data).contains("pelo-sse")
            }
        }

        @Test
        @DisplayName("Dado um SSE aberto com o cookie, quando o segredo muda, então o servidor fecha a conexão")
        fun sse_segredoTrocado_deveFechar() {
            val tokenId = protectedToken()
            val cookie = cookieOf(unlock(tokenId, SECRET))

            SseClient("${api.base}/token/$tokenId/stream", withCookie(cookie)).use { client ->
                assertThat(client.isOpen()).isTrue()
                put(tokenId, """{"read_secret":"$OTHER_SECRET"}""", withCookie(cookie))
                await().atMost(PROMPTLY).until { !client.isOpen() }
            }
        }

        @Test
        @DisplayName("Dado o segredo trocado, quando usa o cookie antigo, então 401; remover e definir de novo também não o revive")
        fun cookie_segredoTrocado_deveDeixarDeValer() {
            val tokenId = protectedToken()
            val cookie = cookieOf(unlock(tokenId, SECRET))

            put(tokenId, """{"read_secret":"$OTHER_SECRET"}""", withCookie(cookie))
            val afterChange = get("/token/$tokenId", withCookie(cookie))
            put(tokenId, """{"read_secret":null}""", withSecret(OTHER_SECRET))
            put(tokenId, """{"read_secret":"$SECRET"}""")
            val afterReprotect = get("/token/$tokenId", withCookie(cookie))

            assertThat(afterChange.statusCode()).isEqualTo(401)
            assertThat(afterReprotect.statusCode()).isEqualTo(401)
        }

        @Test
        @DisplayName("Dado o lock, quando responde, então 204 e o cookie é apagado (vazio, Max-Age=0, mesmo Path)")
        fun lock_deveApagarOCookie() {
            val tokenId = protectedToken()

            val response = api.send("POST", "/token/$tokenId/lock")

            val cookie = response.headers().firstValue("Set-Cookie").orElseThrow()
            assertThat(response.statusCode()).isEqualTo(204)
            assertThat(cookie.split("; ")).contains("$ACCESS_COOKIE=", "Path=/token/$tokenId", "Max-Age=0", "HttpOnly", "SameSite=Strict")
        }

        @Test
        @DisplayName("Dado o segredo errado ou ausente, quando desbloqueia, então 401 sem cookie ou 422")
        fun unlock_erradoOuAusente() {
            val tokenId = protectedToken()

            val wrong = unlock(tokenId, "errado-errado")
            val missing = api.send("POST", "/token/$tokenId/unlock", "{}".toByteArray(), JSON_BODY)

            assertThat(wrong.statusCode()).isEqualTo(401)
            assertThat(wrong.body()).isEqualTo("""{"error":"Wrong secret"}""")
            assertThat(wrong.headers().firstValue("Set-Cookie")).isEmpty()
            assertThat(missing.statusCode()).isEqualTo(422)
            assertThat(api.json(missing)["secret"][0].asString()).isEqualTo("The secret field is required.")
        }

        @Test
        @DisplayName("Dado uma URL sem proteção, quando desbloqueia, então 204 sem cookie; URL inexistente, 410")
        fun unlock_semProtecaoOuInexistente() {
            val open = unlock(api.tokenId(), SECRET)
            val gone = unlock(UUID.randomUUID().toString(), SECRET)

            assertThat(open.statusCode()).isEqualTo(204)
            assertThat(open.headers().firstValue("Set-Cookie")).isEmpty()
            assertThat(gone.statusCode()).isEqualTo(410)
        }
    }

    @Nested
    @DisplayName("Limite de falhas")
    inner class Limit {
        @Test
        @DisplayName("Dado 10 segredos errados no minuto, quando vem a 11ª tentativa, então 429 com Retry-After, mesmo com o segredo certo")
        fun limite_11aFalha_deveResponder429() {
            val tokenId = protectedToken()

            val failures = (1..10).map { unlock(tokenId, "errado-$it-errado").statusCode() }
            val eleventh = unlock(tokenId, "errado-11-errado")
            val rightButLocked = unlock(tokenId, SECRET)
            val headerLocked = get("/token/$tokenId", withSecret(SECRET))

            assertThat(failures).containsOnly(401)
            assertThat(eleventh.statusCode()).isEqualTo(429)
            assertThat(
                eleventh
                    .headers()
                    .firstValue("Retry-After")
                    .orElseThrow()
                    .toLong(),
            ).isBetween(1, 60)
            assertThat(rightButLocked.statusCode()).isEqualTo(429)
            assertThat(headerLocked.statusCode()).isEqualTo(429)
            assertThat(headerLocked.headers().firstValue("Retry-After")).isPresent()
        }

        @Test
        @DisplayName("Dado 10 falhas somando cabeçalho errado e unlock, quando vem a 11ª, então 429: o contador é um só por URL")
        fun limite_cabecalhoEUnlock_devemSomar() {
            val tokenId = protectedToken()

            repeat(5) { get("/token/$tokenId", withSecret("errado-cab-$it")) }
            repeat(5) { unlock(tokenId, "errado-unl-$it") }

            assertThat(get("/token/$tokenId", withSecret("errado-final")).statusCode()).isEqualTo(429)
        }

        @Test
        @DisplayName("Dado acertos repetidos, quando confere o segredo, então nenhum acerto conta como falha")
        fun limite_acertos_naoDevemContar() {
            val tokenId = protectedToken()

            val statuses = (1..15).map { get("/token/$tokenId", withSecret(SECRET)).statusCode() } + unlock(tokenId, SECRET).statusCode()

            assertThat(statuses.dropLast(1)).containsOnly(200)
            assertThat(statuses.last()).isEqualTo(204)
        }

        @Test
        @DisplayName("Dado o cookie válido, quando a URL está no limite de falhas, então o cookie continua abrindo")
        fun limite_cookie_naoDeveSerAfetado() {
            val tokenId = protectedToken()
            val cookie = cookieOf(unlock(tokenId, SECRET))

            repeat(11) { unlock(tokenId, "errado-$it-errado") }

            assertThat(get("/token/$tokenId", withCookie(cookie)).statusCode()).isEqualTo(200)
        }
    }

    @Nested
    @DisplayName("Formato persistido")
    inner class Legacy {
        @Test
        @DisplayName("Dado um token gravado antes do segredo (JSON cru no Redis), quando lê, então abre sem segredo com protected false")
        fun tokenAntigo_deveAbrirComoNaoProtegido() {
            val tokenId = UUID.randomUUID().toString()
            redis.opsForValue().set(
                "token:$tokenId",
                """{"uuid":"$tokenId","ip":"1.2.3.4","user_agent":null,"default_content":"","default_status":200,""" +
                    """"default_content_type":"text\/plain","timeout":0,"cors":false,"created_at":"2026-09-26 00:41:18",""" +
                    """"updated_at":"2026-09-26 00:41:18","retry_after":null,"auto_cleanup":null,"signature":null,"schema":null}""",
            )

            val read = get("/token/$tokenId")
            val requests = get("/token/$tokenId/requests")

            assertThat(read.statusCode()).isEqualTo(200)
            assertThat(api.json(read)["protected"].asBoolean()).isFalse()
            assertThat(requests.statusCode()).isEqualTo(200)
        }
    }

    @Nested
    @DisplayName("Segredo fora do log e métricas")
    @ExtendWith(OutputCaptureExtension::class)
    inner class Observability {
        private fun unlocks(outcome: String): Double =
            registry
                .find("webhook.privacy.unlock")
                .tag("outcome", outcome)
                .counters()
                .sumOf { it.count() }

        @Test
        @DisplayName("Dado criar, errar, desbloquear, trocar e remover o segredo, quando o app loga, então o segredo nunca aparece")
        fun log_fluxoCompleto_naoDeveMostrarOSegredo(output: CapturedOutput) {
            val tokenId = protectedToken()
            get("/token/$tokenId", withSecret(OTHER_SECRET))
            unlock(tokenId, OTHER_SECRET)
            unlock(tokenId, SECRET)
            api.send("POST", "/token", """{"read_secret":"$OTHER_SECRET","timeout":99}""".toByteArray(), JSON_BODY)
            put(tokenId, """{"read_secret":"$OTHER_SECRET"}""", withSecret(SECRET))
            put(tokenId, """{"read_secret":null}""", withSecret(OTHER_SECRET))

            assertThat(output.all).doesNotContain(SECRET, OTHER_SECRET)
        }

        @Test
        @DisplayName("Dado unlock certo, errado e no limite, quando mede, então webhook.privacy.unlock conta cada resultado")
        fun metricas_unlock_devemContarPorResultado() {
            val tokenId = protectedToken()
            val before = listOf("ok", "wrong", "limited").associateWith(::unlocks)

            unlock(tokenId, SECRET)
            repeat(10) { unlock(tokenId, "errado-$it-errado") }
            unlock(tokenId, SECRET)

            assertThat(unlocks("ok") - checkNotNull(before["ok"])).isEqualTo(1.0)
            assertThat(unlocks("wrong") - checkNotNull(before["wrong"])).isEqualTo(10.0)
            assertThat(unlocks("limited") - checkNotNull(before["limited"])).isEqualTo(1.0)
            assertThat(registry.meters.flatMap { it.id.tags }.map { it.value }).doesNotContain(tokenId, SECRET)
        }
    }

    /** O cookie que a §1 manda: HMAC-SHA256(chave do servidor, "id:versão"), em Base64 URL sem `=`. */
    private fun expectedCookie(
        tokenId: String,
        version: Long,
    ): String {
        val key = Base64.getDecoder().decode(redis.opsForValue().get(SERVER_KEY).orEmpty())
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal("$tokenId:$version".toByteArray(UTF_8)))
    }

    private companion object {
        const val SERVER_KEY = "webhook:server-key"
    }
}
