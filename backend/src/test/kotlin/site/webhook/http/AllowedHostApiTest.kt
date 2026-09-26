package site.webhook.http

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.TestPropertySource
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import site.webhook.support.RawResponse
import site.webhook.support.rawHttp
import site.webhook.support.routes
import tools.jackson.databind.json.JsonMapper

private const val EVIL = "evil.example"
private const val HOST_DENIED = """{"error":"host not allowed"}"""
private const val ORIGIN_DENIED = """{"error":"origin not allowed"}"""
private const val FORM_DENIED = """{"error":"form not allowed"}"""
private const val METHOD_FIELD_DENIED = """{"error":"_method not allowed"}"""

/** Com `WEBHOOK_ALLOWED_HOSTS` definido, como no compose da 8084 e do CI. */
@ApiTest
@TestPropertySource(
    properties = [
        "webhook.allowed-hosts=localhost,127.0.0.1,[::1],host.docker.internal",
        "webhook.mcp.enabled=true",
    ],
)
@DisplayName("Host e Origin nas rotas de gestão (DNS rebinding e CSRF)")
class AllowedHostApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
    @param:Qualifier("requestMappingHandlerMapping") private val mapping: RequestMappingHandlerMapping,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun raw(
        request: String,
        host: String = "localhost:$port",
        headers: List<String> = emptyList(),
        body: String = "",
    ): RawResponse {
        val withBody = if (body.isEmpty()) headers else headers + listOf("Content-Type: application/json", "Content-Length: ${body.length}")
        return rawHttp(port, "$request HTTP/1.1", withBody + "Accept: application/json", body.toByteArray(), host = host)
    }

    @Test
    @DisplayName("Dado um Host fora da lista, quando chama /token, /token/{id}, /share/{id} e /mcp, então 403 host not allowed")
    fun host_deFora_deveResponder403NaGestao() {
        val tokenId = api.tokenId()

        val answers =
            listOf(
                raw("POST /token", host = EVIL, body = "{}"),
                raw("GET /token/$tokenId", host = EVIL),
                raw("GET /token/$tokenId/requests", host = "$EVIL:$port"),
                raw("GET /share/qualquer", host = EVIL),
                raw("POST /mcp", host = EVIL, body = "{}"),
            )

        assertThat(answers).allSatisfy {
            assertThat(it.status).isEqualTo(403)
            assertThat(it.body).isEqualTo(HOST_DENIED)
        }
    }

    @Test
    @DisplayName("Dado um Host fora da lista, quando chega um webhook ou pede a tela, então nada muda: 200")
    fun host_deFora_capturaETelaNaoMudam() {
        val tokenId = api.tokenId()

        val capture = raw("POST /$tokenId/x?y=1", host = EVIL, body = "{}")
        val stray = raw("GET /$tokenId/abc%", host = EVIL)
        val index = raw("GET /", host = EVIL)
        val script = raw("GET /main-TESTE123.js", host = EVIL)

        assertThat(listOf(capture, stray, index, script).map { it.status }).containsOnly(200)
        assertThat(api.json(api.send("GET", "/token/$tokenId/requests", headers = JSON_CLIENT))["total"].asInt()).isEqualTo(2)
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @ValueSource(strings = ["localhost", "localhost:9999", "127.0.0.1:8084", "[::1]:8084", "host.docker.internal:8084", "LOCALHOST"])
    @DisplayName("Dado um Host da lista (com ou sem porta, qualquer caixa), quando chama a gestão, então passa")
    fun host_daLista_devePassar(host: String) {
        assertThat(raw("POST /token", host = host, body = "{}").status).isEqualTo(201)
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @ValueSource(
        strings = ["evil.localhost", "127.0.0.1.evil.example", "localhost.evil.example:8084", "localhost:8084.evil.example", ""],
    )
    @DisplayName("Dado um Host parecido com um da lista, quando chama a gestão, então 403")
    fun host_parecido_deveResponder403(host: String) {
        assertThat(raw("GET /token/00000000-0000-4000-8000-000000000000", host = host).status).isEqualTo(403)
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @ValueSource(strings = ["/token;x=1/{id}", "/%74oken/{id}", "//token/{id}", "/TOKEN/{id}", "/share;a=b/x"])
    @DisplayName("Dado um Host de fora e o caminho disfarçado, quando chama a gestão, então 403 do mesmo jeito")
    fun host_caminhoDisfarcado_deveResponder403(path: String) {
        val tokenId = api.tokenId()

        val response = raw("GET ${path.replace("{id}", tokenId)}", host = EVIL)

        assertThat(response.status).isEqualTo(403)
    }

    @Test
    @DisplayName("Dado um POST com Origin de outro site, quando cria ou apaga, então 403 origin not allowed e nada muda")
    fun origin_deFora_deveResponder403() {
        val tokenId = api.tokenId()

        val create = raw("POST /token", headers = listOf("Origin: https://$EVIL"), body = "{}")
        val delete = raw("DELETE /token/$tokenId", headers = listOf("Origin: https://$EVIL"))
        val nullOrigin = raw("PUT /token/$tokenId", headers = listOf("Origin: null"), body = "{}")
        val override = raw("POST /token/$tokenId", headers = listOf("Origin: https://$EVIL", "X-HTTP-Method-Override: GET"), body = "{}")

        assertThat(listOf(create, delete, nullOrigin, override)).allSatisfy {
            assertThat(it.status).isEqualTo(403)
            assertThat(it.body).isEqualTo(ORIGIN_DENIED)
        }
        assertThat(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT).statusCode()).isEqualTo(200)
    }

    @Test
    @DisplayName(
        "Dado o Origin da própria tela (também por outro nome do loopback, ou pelo proxy do ng serve, que mantém o Host) ou " +
            "nenhum (CLI), quando muda estado, então passa; GET com Origin de fora também",
    )
    fun origin_permitidoOuAusente_devePassar() {
        val tokenId = api.tokenId()

        val screen = raw("POST /token", headers = listOf("Origin: http://localhost:$port"), body = "{}")
        val loopback = raw("PUT /token/$tokenId", headers = listOf("Origin: http://127.0.0.1:$port"), body = "{}")
        val devServer = raw("PUT /token/$tokenId", host = "localhost:4200", headers = listOf("Origin: http://localhost:4200"), body = "{}")
        val cli = raw("POST /token", body = "{}")
        val read = raw("GET /token/$tokenId", headers = listOf("Origin: https://$EVIL"))

        assertThat(screen.status).isEqualTo(201)
        assertThat(loopback.status).isEqualTo(200)
        assertThat(devServer.status).isEqualTo(200)
        assertThat(cli.status).isEqualTo(201)
        assertThat(read.status).isEqualTo(200)
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @ValueSource(strings = ["http://localhost:4200", "http://localhost:1", "http://127.0.0.1:1", "http://localhost", "https://localhost"])
    @DisplayName(
        "Dado um Origin de outra porta de um nome da lista (outro app local; o SameSite do cookie não separa portas), quando " +
            "muda estado, então 403 origin not allowed e nada muda",
    )
    fun origin_outraPortaDoMesmoNome_deveResponder403(origin: String) {
        val tokenId = api.tokenId()

        val response = raw("DELETE /token/$tokenId", headers = listOf("Origin: $origin"))

        assertThat(response.status).isEqualTo(403)
        assertThat(response.body).isEqualTo(ORIGIN_DENIED)
        assertThat(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT).statusCode()).isEqualTo(200)
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @ValueSource(strings = ["application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "text/plain; charset=utf-8"])
    @DisplayName(
        "Dado um corpo de formulário com Origin (um <form> do navegador), mesmo da própria tela, quando chama a gestão, então " +
            "403 form not allowed e nada muda",
    )
    fun form_comOrigin_deveResponder403(contentType: String) {
        val tokenId = api.tokenId()
        val body =
            if (contentType.startsWith("multipart")) "--x\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\n1\r\n--x--\r\n" else "a=1"

        val response =
            rawHttp(
                port,
                "PUT /token/$tokenId HTTP/1.1",
                listOf("Origin: http://localhost:$port", "Content-Type: $contentType", "Content-Length: ${body.length}"),
                body.toByteArray(),
            )

        assertThat(response.status).isEqualTo(403)
        assertThat(response.body).isEqualTo(FORM_DENIED)
    }

    @ParameterizedTest(name = "[{index}] {0}")
    @ValueSource(strings = ["corpo", "query"])
    @DisplayName(
        "Dado um POST com _method (no corpo do formulário ou na query), mesmo sem Origin, quando chama a gestão, então 403 e nada muda",
    )
    fun metodoPorCampo_deveResponder403(where: String) {
        val tokenId = api.tokenId()
        val (target, body) = if (where == "corpo") "/token/$tokenId" to "_method=DELETE" else "/token/$tokenId?_method=DELETE" to ""

        val response =
            rawHttp(
                port,
                "POST $target HTTP/1.1",
                listOf("Content-Type: application/x-www-form-urlencoded", "Content-Length: ${body.length}", "Accept: application/json"),
                body.toByteArray(),
            )

        assertThat(response.status).isEqualTo(403)
        assertThat(response.body).isEqualTo(METHOD_FIELD_DENIED)
        assertThat(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT).statusCode()).isEqualTo(200)
    }

    @Test
    @DisplayName(
        "Dado um formulário sem Origin (CLI, scripts, como no app antigo) na gestão e um formulário com Origin e _method na " +
            "captura, quando chegam, então passam",
    )
    fun form_semOriginOuNaCaptura_devePassar() {
        val tokenId = api.tokenId()
        val headers = listOf("Content-Type: application/x-www-form-urlencoded", "Content-Length: 18", "Accept: application/json")

        val cli = rawHttp(port, "PUT /token/$tokenId HTTP/1.1", headers, "default_status=203".toByteArray())
        val capture =
            rawHttp(port, "POST /$tokenId/x HTTP/1.1", headers + "Origin: https://$EVIL", "_method=DELETE&a=1".toByteArray())

        assertThat(cli.status).isEqualTo(200)
        assertThat(api.json(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT))["default_status"].asInt()).isEqualTo(203)
        assertThat(capture.status).isEqualTo(203)
    }

    @Test
    @DisplayName("Dado o /mcp com Origin de fora, quando chama, então 403 origin not allowed (no MCP vale em todo método)")
    fun mcp_originDeFora_deveResponder403() {
        val response = raw("POST /mcp", headers = listOf("Origin: https://$EVIL"), body = "{}")

        assertThat(response.status).isEqualTo(403)
        assertThat(response.body).isEqualTo(ORIGIN_DENIED)
    }

    @Test
    @DisplayName("Dado um Host de fora, quando chama cada rota mapeada em /token e /share, então 403 em todas")
    fun varredura_todasAsRotasDeGestao_devemConferirOHost() {
        val tokenId = api.tokenId()
        val values = mapOf("tokenId" to tokenId, "requestId" to "00000000-0000-4000-8000-000000000000")
        val routes =
            mapping.routes().filter {
                it.pattern == "/token" || it.pattern.startsWith("/token/") ||
                    it.pattern.startsWith("/share/")
            }

        val answers = routes.associateWith { raw("${it.method} ${it.path(values)}", host = EVIL, body = "{}").status }

        assertThat(routes).hasSizeGreaterThanOrEqualTo(25)
        assertThat(answers.filterValues { it != 403 }).isEmpty()
    }

    @Test
    @DisplayName("Dado um cliente comum, quando usa a API pelo localhost, então nada muda")
    fun clienteComum_devePassar() {
        val created = api.send("POST", "/token", "{}".toByteArray(), JSON_BODY)

        assertThat(created.statusCode()).isEqualTo(201)
    }
}
