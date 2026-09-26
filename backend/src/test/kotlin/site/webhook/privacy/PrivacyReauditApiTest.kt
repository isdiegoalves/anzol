package site.webhook.privacy

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import site.webhook.support.RawResponse
import site.webhook.support.rawHttp
import site.webhook.support.routes
import tools.jackson.databind.json.JsonMapper
import java.net.URLEncoder
import java.net.http.HttpResponse
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.text.Charsets.UTF_8

private const val SECRET = "segredo-da-reauditoria-R2d"
private const val SENSITIVE_VALUE = "valor-sensivel-Q7w"
private const val SERVER_KEY = "webhook:server-key"

/** Os `GET` da gestão, todos só de leitura; um `GET` novo aqui passa a ser alvo de `<img src>` de qualquer página. */
private val READ_ONLY_GETS =
    setOf(
        "/",
        "/error",
        "/share/{shareId}",
        "/token/{tokenId}",
        "/token/{tokenId}/outbound",
        "/token/{tokenId}/request/{requestId}",
        "/token/{tokenId}/request/{requestId}/raw",
        "/token/{tokenId}/requests",
        "/token/{tokenId}/rules",
        "/token/{tokenId}/scenarios",
        "/token/{tokenId}/shares",
        "/token/{tokenId}/stream",
    )

/**
 * Reauditoria das correções da refutação do item 12 (privacidade): cada teste confere uma das decisões (a)–(g) da
 * fatia 05 por um caminho que a correção não cobriu de propósito ou por descuido. Sem `webhook.allowed-hosts`
 * definido: o que vale é o padrão do app, que a decisão (c) manda ser fechado.
 */
@ApiTest
@DisplayName("Reauditoria da privacidade")
class PrivacyReauditApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
    @param:Qualifier("requestMappingHandlerMapping") private val mapping: RequestMappingHandlerMapping,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun protectedToken(): String = api.tokenId("""{"read_secret":"$SECRET"}""")

    private fun withSecret(secret: String = SECRET) = mapOf(SECRET_HEADER to secret)

    private fun withCookie(value: String) = mapOf("Cookie" to "$ACCESS_COOKIE=$value")

    private fun get(
        path: String,
        headers: Map<String, String> = emptyMap(),
    ): HttpResponse<String> = api.send("GET", path, headers = JSON_CLIENT + headers)

    private fun put(
        tokenId: String,
        json: String,
        headers: Map<String, String> = emptyMap(),
    ): HttpResponse<String> = api.send("PUT", "/token/$tokenId", json.toByteArray(), JSON_BODY + headers)

    /** Dispara o webhook e devolve o id da mensagem; falha se a captura não respondeu 200. */
    private fun captureId(
        tokenId: String,
        suffix: String = "",
        body: String = "",
        headers: Map<String, String> = emptyMap(),
    ): String {
        val response = api.send(if (body.isEmpty()) "GET" else "POST", "/$tokenId$suffix", body.toByteArray(), headers)
        assertThat(response.statusCode()).`as`("captura de %s: %s", suffix, response.body()).isEqualTo(200)
        return response.headers().firstValue("X-Request-Id").orElseThrow()
    }

    private fun shareId(
        tokenId: String,
        requestId: String,
        json: String = "{}",
    ): String {
        val created = api.send("POST", "/token/$tokenId/request/$requestId/share", json.toByteArray(), JSON_BODY + withSecret())
        assertThat(created.statusCode()).`as`("criar o link: %s", created.body()).isEqualTo(201)
        return api.json(created)["id"].asString()
    }

    private fun view(shareId: String): HttpResponse<String> = api.send("GET", "/share/$shareId", headers = JSON_CLIENT)

    /** `HMAC-SHA256(chave do servidor, texto)` em Base64 URL sem `=`, como o servidor assina o cookie. */
    private fun hmac(text: String): String {
        val key = Base64.getDecoder().decode(redis.opsForValue().get(SERVER_KEY).orEmpty())
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(text.toByteArray(UTF_8)))
    }

    private fun today(): Long = LocalDate.now(ZoneOffset.UTC).toEpochDay()

    @Nested
    @DisplayName("(a) O link só-leitura não entrega o UUID da URL por nenhum campo")
    inner class ShareWithoutUuid {
        @Test
        @DisplayName(
            "Dado uma mensagem cujo Referer e um cabeçalho comum trazem a própria URL (um formulário servido pela captura, um " +
                "callback), quando o público abre o link mascarado, então o UUID não aparece em headers",
        )
        fun share_uuidNosCabecalhos_naoDeveRevelar() {
            val tokenId = protectedToken()
            val requestId =
                captureId(
                    tokenId,
                    suffix = "/pagina",
                    headers =
                        mapOf(
                            "Referer" to "http://localhost:$port/$tokenId/formulario",
                            "X-Callback-Url" to "http://localhost:$port/$tokenId",
                        ),
                )

            val public = view(shareId(tokenId, requestId))

            assertThat(public.statusCode()).isEqualTo(200)
            assertThat(public.body())
                .`as`("o UUID escapa por headers.referer e por cabeçalho comum: (a) só troca o UUID em url e apaga token_id")
                .doesNotContain(tokenId)
        }

        @Test
        @DisplayName(
            "Dado uma mensagem cuja query ecoa a própria URL (redirect_uri de um callback OAuth), quando o público abre o " +
                "link mascarado, então o UUID não aparece em query nem em request",
        )
        fun share_uuidNaQuery_naoDeveRevelar() {
            val tokenId = protectedToken()
            val self = URLEncoder.encode("http://localhost:$port/$tokenId", UTF_8)
            val requestId = captureId(tokenId, suffix = "/callback?redirect_uri=$self&code=abc")

            val public = view(shareId(tokenId, requestId))

            assertThat(public.statusCode()).isEqualTo(200)
            assertThat(public.body())
                .`as`("o UUID escapa por query.redirect_uri e request.redirect_uri: só a url é varrida")
                .doesNotContain(tokenId)
        }

        @Test
        @DisplayName(
            "Dado uma mensagem cujo corpo traz a própria URL (o ping do GitHub manda hook.config.url), quando o público abre " +
                "o link mascarado, então o UUID não aparece em content: o UUID é do servidor, não dado do remetente",
        )
        fun share_uuidNoCorpo_naoDeveRevelar() {
            val tokenId = protectedToken()
            val ping = """{"zen":"Keep it logically awesome.","hook":{"config":{"url":"http://localhost:$port/$tokenId"}}}"""
            val requestId = captureId(tokenId, body = ping, headers = mapOf("Content-Type" to "application/json"))

            val public = view(shareId(tokenId, requestId))

            assertThat(public.statusCode()).isEqualTo(200)
            assertThat(public.body())
                .`as`("o UUID escapa por content; a decisão de não mascarar o corpo é sobre dados do remetente")
                .doesNotContain(tokenId)
        }

        @ParameterizedTest(name = "[{index}] {0}")
        @ValueSource(strings = ["hífen percent-encoded (%2D)", "maiúsculas"])
        @DisplayName(
            "Dado uma captura cujo caminho escreve o UUID de outra forma, quando o público abre o link, então o UUID não " +
                "aparece nem assim na url (que guarda o caminho cru)",
        )
        fun share_uuidDisfarcadoNoCaminho_naoDeveRevelar(form: String) {
            val tokenId = protectedToken()
            val disguised = if (form == "maiúsculas") tokenId.uppercase() else tokenId.replaceFirst("-", "%2D")
            val captured = api.send("GET", "/$disguised/x")
            assumeTrue(captured.statusCode() == 200, "a captura não aceita $form ($disguised): não há o que vazar por aqui")
            val requestId = captured.headers().firstValue("X-Request-Id").orElseThrow()

            val public = view(shareId(tokenId, requestId))

            assertThat(public.statusCode()).isEqualTo(200)
            assertThat(public.body().lowercase())
                .`as`("a url guarda o caminho como chegou; a máscara só casa o UUID hifenizado inteiro")
                .doesNotContain(tokenId.substring(9))
        }
    }

    @Nested
    @DisplayName("(b) Nenhum caminho de navegador de outra origem muda estado na gestão")
    inner class Csrf {
        private fun browserPost(
            contentType: String?,
            body: String,
            origin: String?,
        ): RawResponse {
            val bytes = body.toByteArray()
            val headers =
                buildList {
                    origin?.let { add("Origin: $it") }
                    contentType?.let { add("Content-Type: $it") }
                    add("Content-Length: ${bytes.size}")
                    add("Accept: */*")
                }
            return rawHttp(port, "POST /token HTTP/1.1", headers, bytes)
        }

        @ParameterizedTest(name = "[{index}] {0}")
        @CsvSource(
            delimiter = '|',
            value = [
                "form com Origin null (no-referrer ou redirect 307 de outro site)|application/x-www-form-urlencoded|a=1|null",
                "fetch no-cors ou sendBeacon text/plain de outro site|text/plain;charset=UTF-8|{\"a\":1}|https://evil.example",
                "form multipart de outro site|multipart/form-data; boundary=xx|--xx--|https://evil.example",
                "fetch no-cors com Blob JSON (o navegador tira o Content-Type)||{\"a\":1}|https://evil.example",
                "form de outra porta do mesmo nome|application/x-www-form-urlencoded|a=1|http://localhost:1",
                "form de outro nome do loopback em outra porta|application/x-www-form-urlencoded|a=1|http://127.0.0.1:1",
                "form da própria origem (a tela só manda JSON)|application/x-www-form-urlencoded|a=1|http://localhost:{port}",
                "navegação top-level por POST de outro site|application/x-www-form-urlencoded|a=1|https://evil.example",
            ],
        )
        @DisplayName("Dado o que um navegador manda sem preflight de outra origem, quando cria uma URL, então 403")
        fun navegador_deOutraOrigem_naoDeveCriarUrl(
            case: String,
            contentType: String?,
            body: String,
            origin: String,
        ) {
            val response = browserPost(contentType, body, origin.replace("{port}", port.toString()))

            assertThat(response.status).`as`("%s: %s", case, response.body).isEqualTo(403)
        }

        @Test
        @DisplayName(
            "Dado <img src>, <link> ou navegação GET de qualquer página, quando aponta para a gestão, então não há rota GET " +
                "que mude estado: a lista de GETs é a de leitura conhecida (um GET novo entra aqui por decisão)",
        )
        fun rotasGet_saoSoDeLeitura() {
            val names = mapOf("tokenId" to "{tokenId}", "requestId" to "{requestId}", "shareId" to "{shareId}")
            val gets =
                mapping
                    .routes()
                    .filter { it.method == "GET" }
                    .map { it.path(names) }
                    .filterNot { it.startsWith("/{tokenId}") }
                    .toSet()

            assertThat(gets).isEqualTo(READ_ONLY_GETS)
        }
    }

    @Nested
    @DisplayName("(d) O cookie com dia de emissão não se estende nem se forja")
    inner class AccessCookie {
        @ParameterizedTest(name = "[{index}] dia {0}")
        @ValueSource(longs = [-1, 0, 1, Long.MAX_VALUE, Long.MIN_VALUE])
        @DisplayName("Dado um cookie bem assinado com dia negativo, zero, antigo ou extremo, quando lê a URL, então 401")
        fun cookie_diaExtremoAssinado_naoDeveAbrir(day: Long) {
            val tokenId = protectedToken()
            val cookie = "$day.${hmac("$tokenId:1:$day")}"

            assertThat(get("/token/$tokenId", withCookie(cookie)).statusCode()).isEqualTo(401)
        }

        @Test
        @DisplayName(
            "Dado o cookie de hoje com o dia reescrito (+dia, 0dia, sem dia, dois pontos, sufixo) ou com HMAC de outro dia " +
                "ou versão, quando lê a URL, então 401 em todos e 200 só no original",
        )
        fun cookie_formatoAlterado_naoDeveAbrir() {
            val tokenId = protectedToken()
            val day = today()
            val mac = hmac("$tokenId:1:$day")
            val original = "$day.$mac"

            val answers =
                mapOf(
                    "+dia" to "+$day.$mac",
                    "0dia" to "0$day.$mac",
                    "sem dia" to ".$mac",
                    "só o HMAC" to mac,
                    "dois pontos" to "$day..$mac",
                    "sufixo" to "$original.x",
                    "HMAC de outro dia" to "$day.${hmac("$tokenId:1:${day - 1}")}",
                    "HMAC de outra versão" to "$day.${hmac("$tokenId:2:$day")}",
                ).mapValues { (_, cookie) -> get("/token/$tokenId", withCookie(cookie)).statusCode() }

            assertThat(answers.values).`as`("%s", answers).containsOnly(401)
            assertThat(get("/token/$tokenId", withCookie(original)).statusCode()).isEqualTo(200)
        }
    }

    @Nested
    @DisplayName("(e) Definir, trocar e remover o segredo revogam os links; manter não revoga")
    inner class Revocation {
        @Test
        @DisplayName(
            "Dado um link de uma URL aberta, quando define o segredo, então 404; um link novo sobrevive ao PUT sem read_secret " +
                "e morre ao remover o segredo",
        )
        fun links_seguemAVersaoDoSegredo() {
            val tokenId = api.tokenId()
            val requestId = captureId(tokenId)
            val first = shareId(tokenId, requestId)
            assertThat(view(first).statusCode()).isEqualTo(200)

            put(tokenId, """{"read_secret":"$SECRET"}""")
            val afterSet = view(first).statusCode()
            val second = shareId(tokenId, requestId)
            put(tokenId, """{"default_status":201}""", withSecret())
            val afterKeep = view(second).statusCode()
            put(tokenId, """{"read_secret":null}""", withSecret())
            val afterRemove = view(second).statusCode()

            assertThat(listOf(afterSet, afterKeep, afterRemove)).containsExactly(404, 200, 404)
        }
    }

    @Nested
    @DisplayName("(f) A máscara por nome pega as variações óbvias")
    inner class HeaderMask {
        @ParameterizedTest(name = "[{index}] {0}")
        @ValueSource(
            strings = [
                "X-Auth", "Authorization-Token", "ApiKey", "Api_Key", "X-Access-Token", "X-Vault-Token", "X-Client-Secret",
                "X-Amz-Security-Token", "X-Password", "WWW-Authenticate",
            ],
        )
        @DisplayName("Dado um cabeçalho com credencial de nome variado, quando o público abre o link mascarado, então [redacted]")
        fun share_cabecalhoPorNome_deveMascarar(name: String) {
            val tokenId = protectedToken()
            val requestId = captureId(tokenId, headers = mapOf(name to SENSITIVE_VALUE))

            val public = view(shareId(tokenId, requestId))

            val stored = name.lowercase().replace('_', '-')
            assertThat(api.json(public)["headers"][stored][0].asString()).isEqualTo("[redacted]")
            assertThat(public.body()).doesNotContain(SENSITIVE_VALUE)
        }
    }

    @Nested
    @DisplayName("Captura que responde HTML no endereço da API")
    inner class SameOriginHtml {
        @Test
        @DisplayName(
            "Dado uma URL cuja resposta padrão é HTML com script, quando o navegador a abre, então a resposta vem com " +
                "Content-Security-Policy: sandbox (sem allow-same-origin): a página não é a origem da tela nem da API",
        )
        fun captura_html_deveSairEmSandbox() {
            val page = "<script>fetch('/token/'+JSON.parse(localStorage.token).uuid+'/requests')</script>"
            val tokenId = api.tokenId("""{"default_content_type":"text/html","default_content":"$page"}""")

            val response = api.send("GET", "/$tokenId/pagina")

            assertThat(response.statusCode()).isEqualTo(200)
            assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("text/html")
            assertThat(response.headers().allValues("Content-Security-Policy"))
                .`as`("sem sandbox, o script roda na origem da tela: lê o localStorage (UUID da vítima) e chama a API com o cookie")
                .anyMatch { "sandbox" in it && "allow-same-origin" !in it }
        }
    }
}
