package anzol.search

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import anzol.support.WHOLE_HASH_COMMANDS
import anzol.support.commandCalls
import anzol.support.resetCommandStats
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.MethodSource
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.util.HexFormat
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

private const val SECRET = "segredo-da-busca"
private const val EXPIRY_SECONDS = 604_800L

/** URL que verifica a assinatura (genérica, `X-Signature`) e valida o corpo contra um schema que exige `id`. */
private const val VERIFYING_TOKEN =
    """{"signature":{"provider":"generic","secret":"$SECRET","header":"X-Signature"},""" +
        """"schema":{"type":"object","required":["id"]}}"""

private fun signed(body: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(SECRET.toByteArray(UTF_8), "HmacSHA256"))
    return HexFormat.of().formatHex(mac.doFinal(body.toByteArray(UTF_8)))
}

/** Mensagem com o texto procurado num campo só, e o texto como é procurado (em outra caixa). */
data class TextCase(
    val field: String,
    val method: String,
    val suffix: String,
    val text: String,
    val headers: Map<String, String> = emptyMap(),
    val body: String = "",
) {
    override fun toString(): String = field
}

/**
 * Nome e valor de query vão com escape (`%C3%A7`, `%20`): a `url` gravada os guarda assim e só o campo
 * `query`, decodificado, tem o texto procurado.
 */
fun textCases(): List<TextCase> =
    listOf(
        TextCase("corpo", "POST", "/x", "ped-7781", body = """{"pedido":"PED-7781"}"""),
        TextCase("nome de header", "GET", "/x", "x-RASTREIO-unico", headers = mapOf("X-Rastreio-Unico" to "1")),
        TextCase("valor de header", "GET", "/x", "MARIA@exemplo.COM", headers = mapOf("X-Cliente" to "Maria@Exemplo.com")),
        TextCase("nome de query", "GET", "/x?promo%C3%A7%C3%A3o=1", "PROMOÇÃO"),
        TextCase("valor de query", "GET", "/x?q=Laranja%20Lima", "laranja LIMA"),
        TextCase("valor de query aninhada", "GET", "/x?filtro%5Bcor%5D=Azul%20Claro", "azul claro"),
        TextCase("URL gravada", "GET", "/Pedidos/Novos", "pedidos/NOVOS"),
        TextCase("método", "PATCH", "/x", "pAtCh"),
    )

@ApiTest
@DisplayName("POST /token/{id}/requests/search")
class SearchApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun search(
        tokenId: String,
        body: String,
    ): HttpResponse<String> = api.send("POST", "/token/$tokenId/requests/search", body.toByteArray(), JSON_BODY)

    private fun found(
        tokenId: String,
        body: String,
    ): JsonNode {
        val response = search(tokenId, body)
        assertThat(response.statusCode()).isEqualTo(200)
        return api.json(response)
    }

    private fun uuids(page: JsonNode): List<String> = page["data"].toList().map { it["uuid"].asString() }

    private fun uuid(message: JsonNode): String = message["uuid"].asString()

    /** Mensagem gravada com `decrypted`, como a captura a grava numa URL com a decifra e o segredo de leitura. */
    private fun seedDecrypted(
        tokenId: String,
        id: String,
        decrypted: String,
    ) {
        val json =
            """{"uuid":"$id","token_id":"$tokenId","ip":"10.0.0.1","hostname":"localhost","method":"POST",""" +
                """"user_agent":null,"content":"{}","query":[],"headers":{},"url":"http://localhost/$tokenId",""" +
                """"created_at":"2026-10-09 10:00:00","updated_at":"2026-10-09 10:00:00","decrypted":$decrypted}"""
        redis.opsForHash<String, String>().put("token:$tokenId:requests", id, json)
        redis.opsForZSet().add("token:$tokenId:requests:index", id, 1.0)
    }

    @Nested
    @DisplayName("Texto (CA-1)")
    inner class Text {
        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado uma mensagem com o trecho num campo e outra sem, quando busca em outra caixa, então acha só a primeira")
        @MethodSource("anzol.search.SearchApiTestKt#textCases")
        fun search_textoNumCampo_deveAcharSemDiferenciarMaiusculas(case: TextCase) {
            val tokenId = api.tokenId()
            val target = api.capture(tokenId, case.method, case.suffix, case.body.toByteArray(), case.headers)
            api.capture(tokenId, method = "GET", suffix = "/outro")

            val page = found(tokenId, """{"text":"${case.text}"}""")

            assertThat(uuids(page)).containsExactly(uuid(target))
            assertThat(page["total"].asLong()).isEqualTo(1)
        }

        @Test
        @DisplayName("Dado mensagens sem o trecho, quando busca, então responde 200 com a página vazia e total 0")
        fun search_textoAusente_naoDeveAchar() {
            val tokenId = api.tokenId()
            api.capture(tokenId, method = "POST", suffix = "/pedidos", body = """{"pedido":1}""".toByteArray(), headers = JSON_BODY)

            val page = found(tokenId, """{"text":"inexistente-9f3a"}""")

            assertThat(page).isEqualTo(
                api.tree("""{"data":[],"total":0,"per_page":50,"current_page":1,"is_last_page":true,"from":1,"to":0}"""),
            )
        }

        @Test
        @DisplayName(
            "Dado uma mensagem com o atributo decifrado, quando busca com o segredo por um nome ou valor de dentro dele, " +
                "então acha só ela",
        )
        fun search_valorDecifrado_deveAcharComOSegredo() {
            val tokenId = api.tokenId("""{"read_secret":"$SECRET"}""")
            val access = JSON_BODY + (anzol.privacy.SECRET_HEADER to SECRET)
            val target = UUID.randomUUID().toString()
            seedDecrypted(tokenId, target, """{"pagamento":{"nota":"Cartao-Final-4242"},"itens":[{"sku":"Livro-77"}]}""")
            api.send("POST", "/$tokenId", """{"sem":"cifra"}""".toByteArray(), JSON_BODY)

            val pages =
                listOf("cartao-final", "NOTA", "livro-77").map { text ->
                    api.json(api.send("POST", "/token/$tokenId/requests/search", """{"text":"$text"}""".toByteArray(), access))
                }

            assertThat(pages.map(::uuids)).containsOnly(listOf(target))
        }

        @Test
        @DisplayName("Dado texto vazio ou nulo, quando busca, então não filtra por texto")
        fun search_textoVazio_naoDeveFiltrar() {
            val tokenId = api.tokenId()
            val first = api.capture(tokenId)
            val second = api.capture(tokenId, method = "POST")

            assertThat(uuids(found(tokenId, """{"text":""}"""))).containsExactly(uuid(second), uuid(first))
            assertThat(uuids(found(tokenId, """{"text":null}"""))).containsExactly(uuid(second), uuid(first))
        }
    }

    @Nested
    @DisplayName("Match e texto em E (CA-2)")
    inner class Match {
        /** A URL semeada e a letra de cada mensagem dela, por uuid. */
        private inner class Seeded(
            val tokenId: String,
            private val letters: Map<String, String>,
        ) {
            fun letters(body: String): String = uuids(found(tokenId, body)).joinToString("") { letters.getValue(it) }
        }

        /**
         * Na URL que verifica assinatura e schema: A (POST assinado, corpo com `id`), B (POST com assinatura
         * errada, sem `id`) e C (GET sem assinatura nem corpo), nessa ordem.
         */
        private fun seed(): Seeded {
            val tokenId = api.tokenId(VERIFYING_TOKEN)
            val bodyA = """{"id":1,"status":"pago"}"""
            val bodyB = """{"status":"pago"}"""
            val a =
                api.capture(
                    tokenId,
                    "POST",
                    "/pagamentos",
                    bodyA.toByteArray(),
                    JSON_BODY + mapOf("X-Signature" to signed(bodyA), "X-Tipo" to "cartao"),
                )
            val b = api.capture(tokenId, "POST", "/pagamentos", bodyB.toByteArray(), JSON_BODY + mapOf("X-Signature" to signed("outro")))
            val c = api.capture(tokenId, "GET", "/outro?s=pago")
            return Seeded(tokenId, mapOf(uuid(a) to "A", uuid(b) to "B", uuid(c) to "C"))
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado A, B e C, quando busca com um match, então vêm só as que casam, da mais nova para a mais antiga")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {"method":["POST"]}                              | BA
            {"path":{"equals":"/outro"}}                     | C
            {"headers":{"X-Tipo":{"equals":"cartao"}}}       | A
            {"body":[{"jsonPath":{"path":"$.id"}}]}          | A
            {"signature":"valid"}                            | A
            {"signature":"invalid"}                          | B
            {"signature":"absent"}                           | C
            {"schema":"valid"}                               | A
            {"schema":"invalid"}                             | CB
            {}                                               | CBA""",
        )
        fun search_match_deveFiltrar(
            match: String,
            expected: String,
        ) {
            val seeded = seed()

            assertThat(seeded.letters("""{"match":$match}""")).isEqualTo(expected)
            assertThat(found(seeded.tokenId, """{"match":$match}""")["total"].asInt()).isEqualTo(expected.length)
        }

        @Test
        @DisplayName("Dado texto e match, quando busca, então vêm só as que casam os dois (E)")
        fun search_textoEMatch_deveCombinarEmE() {
            val seeded = seed()

            assertThat(seeded.letters("""{"text":"PAGO"}""")).isEqualTo("CBA")
            assertThat(seeded.letters("""{"text":"PAGO","match":{"method":["POST"]}}""")).isEqualTo("BA")
            assertThat(seeded.letters("""{"text":"PAGO","match":{"method":["POST"],"schema":"valid"}}""")).isEqualTo("A")
            assertThat(seeded.letters("""{"text":"cartao","match":{"method":["GET"]}}""")).isEmpty()
        }
    }

    @Nested
    @DisplayName("Paginação e ordenação (CA-3)")
    inner class Paging {
        @Test
        @DisplayName("Dado 7 mensagens e nenhum filtro, quando busca uma página, então é a mesma página do GET da listagem")
        fun search_semFiltro_deveSerAMesmaPaginaDoGet() {
            val tokenId = api.tokenId()
            repeat(7) { api.capture(tokenId, suffix = "/$it") }

            listOf("oldest", "newest").forEach { sorting ->
                (1..4).forEach { page ->
                    val listed =
                        api.json(
                            api.send("GET", "/token/$tokenId/requests?sorting=$sorting&per_page=3&page=$page", headers = JSON_CLIENT),
                        )

                    val searched = found(tokenId, """{"sorting":"$sorting","per_page":3,"page":$page}""")

                    assertThat(searched).describedAs("$sorting, página $page").isEqualTo(listed)
                }
            }
        }

        @Test
        @DisplayName("Dado 4 de 7 mensagens que casam, quando pagina de 3, então total, from, to e is_last_page contam só as que casam")
        fun search_comFiltro_devePaginarSoAsQueCasam() {
            val tokenId = api.tokenId()
            val posts =
                (1..7).mapNotNull { index ->
                    val method = if (index % 2 == 1) "POST" else "GET"
                    api.capture(tokenId, method = method).takeIf { method == "POST" }?.let(::uuid)
                }
            val filter = """"match":{"method":["POST"]},"per_page":3"""

            val first = found(tokenId, "{$filter}")
            val second = found(tokenId, """{$filter,"page":2}""")
            val oldest = found(tokenId, """{$filter,"sorting":"oldest"}""")
            val beyond = found(tokenId, """{$filter,"page":3}""")

            assertThat(uuids(first)).containsExactlyElementsOf(posts.reversed().take(3))
            assertThat(counters(first)).isEqualTo("total=4 page=1 from=1 to=3 last=false")
            assertThat(uuids(second)).containsExactly(posts.first())
            assertThat(counters(second)).isEqualTo("total=4 page=2 from=4 to=4 last=true")
            assertThat(uuids(oldest)).containsExactlyElementsOf(posts.take(3))
            assertThat(beyond).isEqualTo(
                api.tree("""{"data":[],"total":4,"per_page":3,"current_page":3,"is_last_page":true,"from":7,"to":4}"""),
            )
        }

        private fun counters(page: JsonNode): String =
            "total=${page["total"]} page=${page["current_page"]} from=${page["from"]} to=${page["to"]} last=${page["is_last_page"]}"

        @Test
        @DisplayName("Dado um corpo vazio, quando busca, então vale newest, página 1 e 50 por página")
        fun search_corpoVazio_deveUsarOPadrao() {
            val tokenId = api.tokenId()
            val sent = (1..3).map { uuid(api.capture(tokenId)) }

            val page = api.json(api.send("POST", "/token/$tokenId/requests/search"))

            assertThat(uuids(page)).containsExactlyElementsOf(sent.reversed())
            assertThat(page["per_page"].asInt()).isEqualTo(50)
            assertThat(page["current_page"].asInt()).isEqualTo(1)
        }

        @Test
        @DisplayName("Dado uma página enorme, quando busca, então responde a página vazia sem estourar a conta")
        fun search_paginaEnorme_deveResponderVazia() {
            val tokenId = api.tokenId()
            api.capture(tokenId)

            val page = found(tokenId, """{"page":${Long.MAX_VALUE},"per_page":100}""")

            assertThat(page["data"].isEmpty).isTrue()
            assertThat(page["total"].asInt()).isEqualTo(1)
            assertThat(page["is_last_page"].asBoolean()).isTrue()
            assertThat(page["from"].asLong()).isPositive()
        }

        @Test
        @DisplayName("Dado 250 mensagens, quando busca, então lê pelo índice, em trechos, sem ler a hash inteira")
        fun search_muitasMensagens_naoDeveLerAHashInteira() {
            val tokenId = api.tokenId()
            repeat(250) { api.send("GET", "/$tokenId/$it") }
            found(tokenId, "{}")
            redis.resetCommandStats()

            val page = found(tokenId, """{"text":"/249","sorting":"oldest"}""")

            assertThat(page["total"].asInt()).isEqualTo(1)
            assertThat(redis.commandCalls().filterKeys { it in WHOLE_HASH_COMMANDS }).isEmpty()
            assertThat(redis.commandCalls()["hmget"]).isEqualTo(3)
        }
    }

    @Nested
    @DisplayName("Validação (CA-4)")
    inner class Validation {
        @Test
        @DisplayName("Dado campos inválidos, quando busca, então responde 422 em JSON com a chave de cada campo")
        fun search_camposInvalidos_deveResponder422() {
            val tokenId = api.tokenId()
            val body =
                """{"text":"${"a".repeat(201)}","match":{"path":{"regex":"("}},"sorting":"recentes","page":0,"per_page":101}"""

            val response = search(tokenId, body)

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/json")
            assertThat(api.json(response)).isEqualTo(
                api.tree(
                    """{"text":["The text may not be greater than 200 characters."],"match.path.regex":["The regex is invalid."],""" +
                        """"sorting":["The selected sorting is invalid."],"page":["The page must be at least 1."],""" +
                        """"per_page":["The per page must be between 1 and 100."]}""",
                ),
            )
        }

        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um valor inválido, quando busca, então responde 422 na chave dele")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            {"text":5}                        | text     | The text must be a string.
            {"per_page":0}                    | per_page | The per page must be between 1 and 100.
            {"per_page":"10"}                 | per_page | The per page must be an integer.
            {"page":-1}                       | page     | The page must be at least 1.
            {"sorting":1}                     | sorting  | The selected sorting is invalid.
            {"match":{"method":"POST"}}       | match.method | The method must be an array.
            [1]                               | search   | The search must be an object.
            não é json                        | search   | The search must be an object.""",
        )
        fun search_valorInvalido_deveResponder422(
            body: String,
            key: String,
            message: String,
        ) {
            val response = search(api.tokenId(), body)

            assertThat(response.statusCode()).isEqualTo(422)
            assertThat(api.json(response)).isEqualTo(api.tree("""{"$key":["$message"]}"""))
        }

        @Test
        @DisplayName("Dado 200 caracteres fora do BMP, quando busca, então aceita: o limite conta caracteres, não unidades UTF-16")
        fun search_textoNoLimite_deveAceitar() {
            val response = search(api.tokenId(), """{"text":"${"😀".repeat(200)}","per_page":100,"page":1}""")

            assertThat(response.statusCode()).isEqualTo(200)
        }

        @Test
        @DisplayName("Dado um token inexistente, quando busca, então responde 410 antes de validar")
        fun search_tokenInexistente_deveResponder410() {
            val response = search("00000000-0000-4000-8000-000000000000", """{"per_page":0}""")

            assertThat(response.statusCode()).isEqualTo(410)
            assertThat(api.json(response)["error"]["message"].asString()).isEqualTo("Token not found")
        }
    }

    /**
     * Mensagens gravadas pelo app antigo, só na hash: `created_at` em segundos (muitas com o mesmo score no
     * índice) e valores vazios (mensagem fantasma, score 0). Mais de um trecho da varredura cai no meio de
     * cada empate.
     */
    @Nested
    @DisplayName("Dados do app antigo")
    inner class LegacyData {
        private val tokenId = UUID.randomUUID().toString()

        private fun seed(): List<String> {
            redis.opsForValue().set("token:$tokenId", legacyToken(), Duration.ofSeconds(EXPIRY_SECONDS))
            val ids = (1..250).map { UUID.randomUUID().toString() }
            val messages = ids.mapIndexed { index, id -> id to legacyMessage(id, ip = if (index == 137) "10.20.30.40" else "1.1.1.1") }
            val ghosts = (1..150).map { UUID.randomUUID().toString() to "" }
            redis.opsForHash<String, String>().putAll("token:$tokenId:requests", (messages + ghosts).toMap())
            return ids
        }

        @Test
        @DisplayName("Dado 250 mensagens no mesmo segundo e 150 fantasmas, quando busca sem filtro, então vêm as 250, cada uma uma vez")
        fun search_empatesEFantasmas_deveVarrerTudo() {
            val ids = seed()

            val newest = (1..3).flatMap { uuids(found(tokenId, """{"per_page":100,"page":$it}""")) }
            val oldest = (1..3).flatMap { uuids(found(tokenId, """{"per_page":100,"page":$it,"sorting":"oldest"}""")) }

            assertThat(newest).hasSize(250).doesNotHaveDuplicates().containsExactlyInAnyOrderElementsOf(ids)
            assertThat(oldest).isEqualTo(newest.reversed())
            assertThat(found(tokenId, "{}")["total"].asInt()).isEqualTo(250)
        }

        @Test
        @DisplayName("Dado uma mensagem antiga com outro IP, quando busca pelo IP, então acha só ela")
        fun search_ip_deveAcharPeloIpGravado() {
            val ids = seed()

            val page = found(tokenId, """{"text":"10.20.30.40"}""")

            assertThat(uuids(page)).containsExactly(ids[137])
        }

        private fun legacyToken() =
            """{"uuid":"$tokenId","ip":"1.1.1.1","user_agent":null,"default_content":"","default_status":200,""" +
                """"default_content_type":"text\/plain","timeout":0,"created_at":"2025-12-01 00:00:00","updated_at":"2025-12-01 00:00:00"}"""

        private fun legacyMessage(
            id: String,
            ip: String,
        ): String =
            """{"uuid":"$id","token_id":"$tokenId","ip":"$ip","hostname":"localhost","method":"GET",""" +
                """"user_agent":null,"content":"","query":null,"headers":{"host":["localhost"]},""" +
                """"url":"http:\/\/localhost\/$tokenId","created_at":"2026-01-01 00:00:00","updated_at":"2026-01-01 00:00:00","request":null}"""
    }
}
