package site.webhook.privacy

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.TestPropertySource
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import site.webhook.support.RawResponse
import site.webhook.support.rawHttp
import tools.jackson.databind.json.JsonMapper

private const val SECRET = "segredo-da-refutacao-K3m"
private const val HIJACKED = "segredo-do-atacante-P9q"

/** Uma página em outra porta do mesmo nome (`localhost:1`): mesmo site para o cookie, `Origin` aceito pela lista. */
private const val OTHER_LOCAL_PORT_ORIGIN = "http://localhost:1"

/**
 * Refutação independente do item 12 (privacidade): cada teste aqui prova uma garantia da §1 que o código NÃO cumpre.
 * Ficam vermelhos de propósito até a correção. Com `WEBHOOK_ALLOWED_HOSTS` como no compose da 8084.
 */
@ApiTest
@TestPropertySource(properties = ["webhook.allowed-hosts=localhost,127.0.0.1,[::1],host.docker.internal"])
@DisplayName("Refutação da privacidade")
class PrivacyRefutationApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun protectedToken(): String = api.tokenId("""{"read_secret":"$SECRET"}""")

    private fun captureId(tokenId: String): String =
        api
            .send("POST", "/$tokenId/pedido?token=abc", "corpo".toByteArray())
            .headers()
            .firstValue("X-Request-Id")
            .orElseThrow()

    private fun unlockCookie(tokenId: String): String =
        api
            .send("POST", "/token/$tokenId/unlock", """{"secret":"$SECRET"}""".toByteArray(), JSON_BODY)
            .headers()
            .firstValue("Set-Cookie")
            .orElseThrow()
            .substringBefore(';')

    /** Um POST de formulário como um `<form>` auto-enviado de outra página: sem preflight, com os cabeçalhos de sempre. */
    private fun formPost(
        path: String,
        form: String,
        headers: List<String>,
    ): RawResponse {
        val body = form.toByteArray()
        return rawHttp(
            port,
            "POST $path HTTP/1.1",
            headers + listOf("Content-Type: application/x-www-form-urlencoded", "Content-Length: ${body.size}", "Accept: */*"),
            body,
        )
    }

    @Nested
    @DisplayName("Link só-leitura (§1: compartilhar UMA mensagem)")
    inner class Share {
        @Test
        @DisplayName(
            "Dado um link só-leitura com máscara de uma URL protegida, quando o público abre, então o UUID da URL não aparece " +
                "(nem em token_id nem em url): o link é de UMA mensagem, não da URL inteira",
        )
        fun share_comMascara_naoDeveRevelarOUuidDaUrl() {
            val tokenId = protectedToken()
            val requestId = captureId(tokenId)
            val created =
                api.send(
                    "POST",
                    "/token/$tokenId/request/$requestId/share",
                    "{}".toByteArray(),
                    JSON_BODY + mapOf(SECRET_HEADER to SECRET),
                )
            val shareId = api.json(created)["id"].asString()

            val public = api.send("GET", "/share/$shareId", headers = JSON_CLIENT)

            assertThat(public.statusCode()).isEqualTo(200)
            assertThat(public.body())
                .`as`("o UUID da URL no link público: quem o tem sabe onde enviar, esgota o limite e, numa URL aberta, lê tudo")
                .doesNotContain(tokenId)
        }
    }

    @Nested
    @DisplayName("CSRF de outra porta local (§1: página maliciosa no navegador não usa a API)")
    inner class SameSiteOtherPort {
        @Test
        @DisplayName(
            "Dado o cookie de desbloqueio no navegador e uma página em outra porta de localhost, quando ela envia um formulário " +
                "_method=PUT com read_secret, então 403 e o segredo da URL não muda",
        )
        fun origin_outraPortaLocalComCookie_naoDeveTrocarOSegredo() {
            val tokenId = protectedToken()
            val cookie = unlockCookie(tokenId)

            val response =
                formPost(
                    "/token/$tokenId",
                    "_method=PUT&read_secret=$HIJACKED",
                    listOf("Origin: $OTHER_LOCAL_PORT_ORIGIN", "Cookie: $cookie"),
                )

            assertThat(response.status).`as`("resposta ao formulário de outra porta: %s", response.body).isEqualTo(403)
            assertThat(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT + mapOf(SECRET_HEADER to SECRET)).statusCode())
                .`as`("o segredo do dono continua abrindo")
                .isEqualTo(200)
            assertThat(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT + mapOf(SECRET_HEADER to HIJACKED)).statusCode())
                .`as`("o segredo do atacante não abre")
                .isEqualTo(401)
        }

        @Test
        @DisplayName(
            "Dado uma URL aberta e uma página em outra porta de localhost, quando ela envia um formulário _method=DELETE, " +
                "então 403 e a URL continua existindo",
        )
        fun origin_outraPortaLocal_naoDeveApagarAUrl() {
            val tokenId = api.tokenId()

            val response = formPost("/token/$tokenId", "_method=DELETE", listOf("Origin: $OTHER_LOCAL_PORT_ORIGIN"))

            assertThat(response.status).`as`("resposta ao formulário de outra porta: %s", response.body).isEqualTo(403)
            assertThat(api.send("GET", "/token/$tokenId", headers = JSON_CLIENT).statusCode()).isEqualTo(200)
        }
    }
}
