package site.webhook.capture

import org.assertj.core.api.Assertions.assertThat
import org.awaitility.Awaitility.await
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.TIMESTAMP_PATTERN
import site.webhook.support.ApiClient
import site.webhook.support.ApiTest
import site.webhook.support.JSON_CLIENT
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode
import java.time.Duration
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

@ApiTest
@DisplayName("API de mensagens")
class RequestApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun tokenWith(messages: Int): String = api.tokenId().also { id -> repeat(messages) { api.send("GET", "/$id") } }

    @ParameterizedTest(name = "{0} → {1}")
    @DisplayName("Dado 7 mensagens, quando lista uma página, então repete a aritmética do PHP inclusive além do fim")
    @CsvSource(
        delimiter = '|',
        textBlock = """
        ''                  | {"total":7,"per_page":50,"current_page":1,"is_last_page":true,"from":1,"to":7}
        per_page=3&page=2   | {"total":7,"per_page":3,"current_page":2,"is_last_page":false,"from":4,"to":6}
        per_page=3&page=3   | {"total":7,"per_page":3,"current_page":3,"is_last_page":true,"from":7,"to":7}
        per_page=3&page=6   | {"total":7,"per_page":3,"current_page":6,"is_last_page":true,"from":16,"to":7}
        per_page=abc        | {"total":7,"per_page":0,"current_page":1,"is_last_page":false,"from":1,"to":0}""",
    )
    fun all_paginas_deveRepetirAritmeticaDoPhp(
        query: String,
        expected: String,
    ) {
        val tokenId = tokenWith(7)

        val page = api.json(api.send("GET", "/token/$tokenId/requests?$query"))

        val meta = (page.deepCopy() as ObjectNode).apply { remove("data") }
        assertThat(meta).isEqualTo(api.tree(expected))
        assertThat(page.propertyNames().toList()).containsExactly("data", "total", "per_page", "current_page", "is_last_page", "from", "to")
    }

    @Test
    @DisplayName("Dado mensagens em segundos diferentes, quando ordena, então oldest é o padrão e newest inverte")
    fun all_ordenacao_deveRespeitarCreatedAt() {
        val tokenId = api.tokenId()
        val first = api.capture(tokenId)
        // created_at tem resolução de segundo: espera o relógio virar antes da segunda mensagem.
        val firstSecond = LocalDateTime.parse(first["created_at"].asString(), DateTimeFormatter.ofPattern(TIMESTAMP_PATTERN))
        await().atMost(Duration.ofSeconds(3)).until { LocalDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.SECONDS) > firstSecond }
        val ids = listOf(first["uuid"].asString(), api.capture(tokenId)["uuid"].asString())

        fun uuids(query: String): List<String> =
            api.json(api.send("GET", "/token/$tokenId/requests?$query"))["data"].toList().map {
                it["uuid"].asString()
            }

        assertThat(uuids("")).containsExactlyElementsOf(ids)
        assertThat(uuids("sorting=qualquer")).containsExactlyElementsOf(ids)
        assertThat(uuids("sorting=newest")).containsExactlyElementsOf(ids.reversed())
    }

    @ParameterizedTest(name = "{0} → {1}")
    @DisplayName("Dado o Content-Type gravado, quando pede o corpo cru, então só application/json exato volta como JSON")
    @CsvSource(
        delimiter = '|',
        value = [
            "application/json | application/json",
            "application/json; charset=utf-8 | text/plain;charset=UTF-8",
            "text/plain | text/plain;charset=UTF-8",
        ],
    )
    fun raw_contentTypeGravado_deveEscolherTipo(
        sent: String,
        expected: String,
    ) {
        val tokenId = api.tokenId()
        val stored = api.capture(tokenId, "POST", body = """{"a":1}""".toByteArray(), headers = mapOf("Content-Type" to sent))

        val raw = api.send("GET", "/token/$tokenId/request/${stored["uuid"].asString()}/raw")

        assertThat(raw.headers().firstValue("Content-Type")).hasValue(expected)
        assertThat(raw.body()).isEqualTo("""{"a":1}""")
    }

    @Test
    @DisplayName("Dado uma mensagem apagada, quando lê ou apaga de novo, então responde 404 Request not found")
    fun delete_mensagemApagada_deveResponder404() {
        val tokenId = api.tokenId()
        val requestId = api.capture(tokenId)["uuid"].asString()

        val deleted = api.send("DELETE", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT)
        val again = api.send("DELETE", "/token/$tokenId/request/$requestId", headers = JSON_CLIENT)

        assertThat(api.json(deleted)).isEqualTo(api.tree("""{"status":true}"""))
        assertThat(again.statusCode()).isEqualTo(404)
        assertThat(api.json(again)).isEqualTo(api.tree("""{"success":false,"error":{"message":"Request not found","id":null}}"""))
    }

    @Test
    @DisplayName("Dado mensagens, quando apaga todas duas vezes, então responde true e depois false, e o token continua")
    fun deleteAll_duasVezes_deveResponderTrueEDepoisFalse() {
        val tokenId = tokenWith(2)

        val first = api.json(api.send("DELETE", "/token/$tokenId/request", headers = JSON_CLIENT))
        val second = api.json(api.send("DELETE", "/token/$tokenId/request", headers = JSON_CLIENT))

        assertThat(first).isEqualTo(api.tree("""{"status":true}"""))
        assertThat(second).isEqualTo(api.tree("""{"status":false}"""))
        assertThat(api.send("GET", "/token/$tokenId").statusCode()).isEqualTo(200)
    }

    @ParameterizedTest(name = "{0} {1} → {2}")
    @DisplayName("Dado rota inexistente ou método errado, quando o cliente pede JSON, então responde o envelope com mensagem vazia")
    @CsvSource(
        "GET, /nao-existe, 404",
        "GET, /token/abc, 404",
        "GET, /token, 405",
        "DELETE, /token/00000000-0000-4000-8000-000000000000/requests, 405",
    )
    fun roteamento_rotaOuMetodoInvalido_deveResponderEnvelope(
        method: String,
        path: String,
        status: Int,
    ) {
        val response = api.send(method, path, headers = JSON_CLIENT)

        assertThat(response.statusCode()).isEqualTo(status)
        assertThat(api.json(response)).isEqualTo(api.tree("""{"success":false,"error":{"message":"","id":null}}"""))
    }
}
