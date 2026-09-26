package site.webhook.share

import io.micrometer.core.instrument.MeterRegistry
import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import site.webhook.support.rawHttp
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode
import java.net.http.HttpResponse
import java.time.Duration
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.UUID

private const val SECRET = "segredo-do-link-9Qe"
private const val NOT_FOUND = """{"error":"This shared link does not exist or has expired"}"""
private val TIMESTAMP: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
private val BASIC = Base64.getEncoder().encodeToString("usuario:senha-basic".toByteArray())

/** Um de cada cabeçalho que o link mascarado esconde, mais um comum (`X-Normal`). */
private val SENSITIVE_HEADERS =
    listOf(
        "Authorization: Basic $BASIC",
        "Proxy-Authorization: Basic cHJveHk=",
        "Cookie: sessao=abc",
        "Set-Cookie: a=b",
        "X-Api-Key: chave-api",
        "X-Webhook-Secret: segredo-x",
        "X-Hub-Signature-256: sha256=00ff",
        "X-Normal: fica",
        "Content-Type: application/json",
    )

/** Links só-leitura de uma mensagem (§1 do item 12). */
@ApiTest
@DisplayName("Links só-leitura")
class ShareApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
    private val registry: MeterRegistry,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun captureId(
        tokenId: String,
        suffix: String = "",
        headers: Map<String, String> = emptyMap(),
        body: String = "",
    ): String =
        api
            .send(if (body.isEmpty()) "GET" else "POST", "/$tokenId$suffix", body.toByteArray(), headers)
            .headers()
            .firstValue("X-Request-Id")
            .orElseThrow()

    private fun share(
        tokenId: String,
        requestId: String,
        json: String = "{}",
        headers: Map<String, String> = emptyMap(),
    ): HttpResponse<String> = api.send("POST", "/token/$tokenId/request/$requestId/share", json.toByteArray(), JSON_BODY + headers)

    private fun shareId(
        tokenId: String,
        requestId: String,
        json: String = "{}",
    ): String = api.json(share(tokenId, requestId, json))["id"].asString()

    private fun view(id: String): HttpResponse<String> = api.send("GET", "/share/$id", headers = JSON_CLIENT)

    private fun message(
        tokenId: String,
        requestId: String,
    ): JsonNode = api.json(api.send("GET", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT))

    @Nested
    @DisplayName("Criar, listar e revogar")
    inner class Lifecycle {
        @Test
        @DisplayName(
            "Dado uma mensagem, quando cria o link sem opções, então 201 com id de 22 caracteres base62, url da tela, 7 dias e " +
                "redact true; o Redis guarda share:{id} com esse TTL e o índice da URL",
        )
        fun criar_padrao_deveDurar7DiasEMascarar() {
            val tokenId = api.tokenId()
            val requestId = captureId(tokenId)

            val response = share(tokenId, requestId)

            val created = api.json(response)
            val id = created["id"].asString()
            assertThat(response.statusCode()).isEqualTo(201)
            assertThat(created.propertyNames().toList()).containsExactly("id", "url", "expires_at", "redact")
            assertThat(id).matches("[0-9A-Za-z]{22}")
            assertThat(created["url"].asString()).isEqualTo("/#/share/$id")
            assertThat(created["redact"].asBoolean()).isTrue()
            assertThat(LocalDateTime.parse(created["expires_at"].asString(), TIMESTAMP))
                .isBetween(nowUtc().plusDays(7).minusMinutes(1), nowUtc().plusDays(7).plusMinutes(1))
            assertThat(redis.getExpire("share:$id")).isBetween(Duration.ofDays(7).seconds - 5, Duration.ofDays(7).seconds)
            assertThat(redis.opsForZSet().range("token:$tokenId:shares", 0, -1)).containsExactly(id)
        }

        @ParameterizedTest(name = "[{index}] {0}")
        @CsvSource("1h,3600", "1d,86400", "7d,604800", "30d,2592000")
        @DisplayName("Dado um expires_in aceito, quando cria, então o TTL do link é essa duração")
        fun criar_expiracao_deveVirarTtl(
            expiresIn: String,
            seconds: Long,
        ) {
            val tokenId = api.tokenId()

            val id = shareId(tokenId, captureId(tokenId), """{"expires_in":"$expiresIn","redact":false}""")

            assertThat(redis.getExpire("share:$id")).isBetween(seconds - 5, seconds)
        }

        @Test
        @DisplayName("Dado expires_in e redact inválidos, quando cria, então 422 com as mensagens; mensagem ou URL inexistente, 404 e 410")
        fun criar_invalido() {
            val tokenId = api.tokenId()
            val requestId = captureId(tokenId)

            val invalid = share(tokenId, requestId, """{"expires_in":"2h","redact":"sim"}""")
            val missingMessage = share(tokenId, UUID.randomUUID().toString())
            val missingUrl = share(UUID.randomUUID().toString(), requestId)

            assertThat(invalid.statusCode()).isEqualTo(422)
            assertThat(api.json(invalid)).isEqualTo(
                api.tree("""{"expires_in":["The selected expires in is invalid."],"redact":["The redact field must be true or false."]}"""),
            )
            assertThat(missingMessage.statusCode()).isEqualTo(404)
            assertThat(missingUrl.statusCode()).isEqualTo(410)
        }

        @Test
        @DisplayName("Dado dois links, quando lista e revoga um, então a lista traz os ativos e o revogado responde 404")
        fun listar_revogar() {
            val tokenId = api.tokenId()
            val requestId = captureId(tokenId)
            val first = shareId(tokenId, requestId)
            val second = shareId(tokenId, requestId, """{"expires_in":"1h","redact":false}""")

            val listed = api.json(api.send("GET", "/token/$tokenId/shares", headers = JSON_CLIENT))
            val revoked = api.send("DELETE", "/token/$tokenId/shares/$first")
            val again = api.send("DELETE", "/token/$tokenId/shares/$first", headers = JSON_CLIENT)
            val after = api.json(api.send("GET", "/token/$tokenId/shares", headers = JSON_CLIENT))

            assertThat(listed.toList().map { it["id"].asString() }).containsExactlyInAnyOrder(first, second)
            assertThat(listed[0].propertyNames().toList()).containsExactly("id", "url", "request_id", "redact", "created_at", "expires_at")
            assertThat(listed.toList().first { it["id"].asString() == second }["redact"].asBoolean()).isFalse()
            assertThat(revoked.statusCode()).isEqualTo(204)
            assertThat(again.statusCode()).isEqualTo(404)
            assertThat(after.toList().map { it["id"].asString() }).containsExactly(second)
            assertThat(view(first).statusCode()).isEqualTo(404)
            assertThat(redis.hasKey("share:$first")).isFalse()
        }

        @Test
        @DisplayName("Dado um link de outra URL, quando tenta revogar por esta, então 404 e o link continua valendo")
        fun revogar_deOutraUrl_naoDeveApagar() {
            val owner = api.tokenId()
            val other = api.tokenId()
            val id = shareId(owner, captureId(owner))

            val response = api.send("DELETE", "/token/$other/shares/$id", headers = JSON_CLIENT)

            assertThat(response.statusCode()).isEqualTo(404)
            assertThat(view(id).statusCode()).isEqualTo(200)
        }

        @Test
        @DisplayName("Dado 50 links ativos, quando cria o 51º, então 422; revogando um, cabe de novo")
        fun limite_50Ativos() {
            val tokenId = api.tokenId()
            val requestId = captureId(tokenId)
            val ids = (1..50).map { shareId(tokenId, requestId) }

            val over = share(tokenId, requestId)
            api.send("DELETE", "/token/$tokenId/shares/${ids.first()}")
            val afterRevoke = share(tokenId, requestId)

            assertThat(over.statusCode()).isEqualTo(422)
            assertThat(api.json(over)["shares"][0].asString()).isEqualTo("A URL can have at most 50 active shared links.")
            assertThat(afterRevoke.statusCode()).isEqualTo(201)
        }

        @Test
        @DisplayName("Dado links criados, quando apaga a URL, então share:{id} e o índice saem do Redis")
        fun apagarUrl_deveApagarOsLinks() {
            val tokenId = api.tokenId()
            val ids = (1..3).map { shareId(tokenId, captureId(tokenId)) }

            api.send("DELETE", "/token/$tokenId")

            assertThat(ids.map { redis.hasKey("share:$it") }).containsOnly(false)
            assertThat(redis.hasKey("token:$tokenId:shares")).isFalse()
            assertThat(ids.map { view(it).statusCode() }).containsOnly(404)
        }

        @Test
        @DisplayName("Dado uma URL protegida, quando cria e lista links, então exige o acesso; o link público abre sem nada")
        fun urlProtegida_linkPublicoAbreSemSegredo() {
            val tokenId = api.tokenId("""{"read_secret":"$SECRET"}""")
            val requestId = captureId(tokenId, body = "protegida")

            val denied = share(tokenId, requestId)
            val created = share(tokenId, requestId, headers = mapOf("X-Webhook-Secret" to SECRET))
            val public = view(api.json(created)["id"].asString())

            assertThat(denied.statusCode()).isEqualTo(401)
            assertThat(created.statusCode()).isEqualTo(201)
            assertThat(public.statusCode()).isEqualTo(200)
            assertThat(api.json(public)["content"].asString()).isEqualTo("protegida")
        }
    }

    @Nested
    @DisplayName("Link público")
    inner class Public {
        @Test
        @DisplayName("Dado redact false, quando abre o link, então é a mensagem do GET /request, mais shared_at e expires_at")
        fun ver_semMascara_deveSerAMensagemInteira() {
            val tokenId = api.tokenId()
            val requestId = captureId(tokenId, "?token=abc", mapOf("Authorization" to "Bearer cru"), body = "corpo")

            val id = shareId(tokenId, requestId, """{"redact":false}""")
            val shared = api.json(view(id)) as ObjectNode

            val expected = (message(tokenId, requestId) as ObjectNode).deepCopy()
            expected.put("shared_at", shared["shared_at"].asString())
            expected.put("expires_at", shared["expires_at"].asString())
            assertThat(shared).isEqualTo(expected)
            assertThat(shared.propertyNames().toList().takeLast(2)).containsExactly("shared_at", "expires_at")
        }

        @Test
        @DisplayName(
            "Dado redact true, quando abre o link, então os cabeçalhos sensíveis, o de assinatura do provedor e a query de nome " +
                "sensível viram [redacted] (também na url, no request e no near_miss); o resto e o corpo ficam",
        )
        fun ver_comMascara_deveTrocarSoOsSensiveis() {
            val tokenId = api.tokenId("""{"signature":{"provider":"github","secret":"assinatura-segredo"}}""")
            api.send(
                "PUT",
                "/token/$tokenId/rules",
                """[{"name":"r","match":{"headers":{"authorization":{"equals":"outro"}},"query":{"api_key":{"equals":"outra"}}}}]"""
                    .toByteArray(),
                JSON_BODY,
            )
            val query = "?api_key=k1&Token=t1&normal=n1&my_PASSWORD=p1&sig_signature=s1&a%5Bsecret%5D=x1&keep=1"
            val body = """{"password":"no-corpo"}"""
            // Pelo socket: o HttpClient do JDK não manda o Proxy-Authorization.
            val requestId =
                rawHttp(
                    port,
                    "POST /$tokenId/caminho$query HTTP/1.1",
                    SENSITIVE_HEADERS + "Content-Length: ${body.length}",
                    body.toByteArray(),
                ).headers.getValue("x-request-id")

            val shared = api.json(view(shareId(tokenId, requestId)))

            val h = shared["headers"]
            listOf(
                "authorization",
                "proxy-authorization",
                "cookie",
                "set-cookie",
                "x-api-key",
                "x-webhook-secret",
                "x-hub-signature-256",
                "php-auth-user",
                "php-auth-pw",
            ).forEach { assertThat(h[it]?.get(0)?.asString()).`as`("%s em %s", it, h).isEqualTo("[redacted]") }
            assertThat(h["x-normal"][0].asString()).isEqualTo("fica")
            assertThat(shared["query"]).isEqualTo(
                api.tree(
                    """{"api_key":"[redacted]","Token":"[redacted]","normal":"n1","my_PASSWORD":"[redacted]",""" +
                        """"sig_signature":"[redacted]","a":{"secret":"[redacted]"},"keep":"1"}""",
                ),
            )
            assertThat(shared["url"].asString()).endsWith(
                "/caminho?Token=[redacted]&a%5Bsecret%5D=[redacted]&api_key=[redacted]&keep=1&my_PASSWORD=[redacted]" +
                    "&normal=n1&sig_signature=[redacted]",
            )
            assertThat(shared["content"].asString()).isEqualTo("""{"password":"no-corpo"}""")
            assertThat(shared["near_miss"]["failed"].toList().map { it.asString() })
                .contains("header authorization: [redacted]", "query api_key: [redacted]")
            assertThat(
                shared.toString(),
            ).doesNotContain("senha-basic", "chave-api", "segredo-x", "00ff", "sessao=abc", "k1", "t1", "p1", BASIC)
        }

        @Test
        @DisplayName("Dado um GET com query sensível, quando abre o link mascarado, então o request (a query no GET) também sai mascarado")
        fun ver_getComQuery_requestTambemMascarado() {
            val tokenId = api.tokenId()
            val requestId = captureId(tokenId, "?token=segredo-get&x=1")

            val shared = api.json(view(shareId(tokenId, requestId)))

            assertThat(shared.toString()).doesNotContain("segredo-get")
        }

        @Test
        @DisplayName(
            "Dado um link inexistente, malformado, revogado, expirado, de mensagem apagada e de URL apagada, quando abre, então o " +
                "mesmo 404",
        )
        fun ver_ausencias_devemDarOMesmo404() {
            val tokenId = api.tokenId()
            val revoked = shareId(tokenId, captureId(tokenId))
            api.send("DELETE", "/token/$tokenId/shares/$revoked")
            val expired = shareId(tokenId, captureId(tokenId))
            redis.expire("share:$expired", Duration.ofMillis(1))
            val deletedMessageId = captureId(tokenId)
            val deletedMessage = shareId(tokenId, deletedMessageId)
            api.send("DELETE", "/token/$tokenId/request/$deletedMessageId")
            val otherToken = api.tokenId()
            val deletedUrl = shareId(otherToken, captureId(otherToken))
            redis.delete("token:$otherToken")
            await().atMost(Duration.ofSeconds(2)).until { !redis.hasKey("share:$expired") }

            val answers = listOf("0".repeat(22), "curto", "a.b", revoked, expired, deletedMessage, deletedUrl).map(::view)

            assertThat(answers).allSatisfy {
                assertThat(it.statusCode()).isEqualTo(404)
                assertThat(it.body()).isEqualTo(NOT_FOUND)
            }
        }

        @Test
        @DisplayName("Dado criar, abrir e revogar, quando mede, então webhook.share conta cada ação")
        fun metricas_share() {
            fun count(action: String) =
                registry
                    .find("webhook.share")
                    .tag("action", action)
                    .counters()
                    .sumOf { it.count() }
            val before = listOf("create", "view", "revoke").associateWith(::count)
            val tokenId = api.tokenId()
            val id = shareId(tokenId, captureId(tokenId))

            view(id)
            api.send("DELETE", "/token/$tokenId/shares/$id")

            assertThat(listOf("create", "view", "revoke").map { count(it) - checkNotNull(before[it]) }).containsOnly(1.0)
        }
    }

    @Test
    @DisplayName("Dado mil ids gerados, quando confere, então todos têm 22 caracteres base62 e nenhum se repete")
    fun id_formatoEUnicidade() {
        val ids = (1..1000).map { newShareId() }

        assertThat(ids).allMatch { it.matches(Regex("[0-9A-Za-z]{22}")) }
        assertThat(ids.toSet()).hasSize(1000)
    }

    private fun nowUtc(): LocalDateTime = LocalDateTime.now(ZoneOffset.UTC)
}
