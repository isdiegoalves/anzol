package anzol.defense.lab

import anzol.e2ee.json
import anzol.privacy.SECRET_HEADER
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.JSON_BODY
import anzol.support.JSON_CLIENT
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.data.redis.core.StringRedisTemplate
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.http.HttpResponse

private const val UNKNOWN_ROUND = "00000000-0000-4000-8000-000000000000"
private const val LEGITIMATE = 18
private const val ATTACKS = 4

/** O que o piso sabe fazer sozinho: barrar o que a assinatura reprova. */
private const val FLOOR_RULES =
    """[{"name":"signature: invalid → 401","match":{"signature":"invalid"},"response":{"status":401}},""" +
        """{"name":"signature: absent → 401","match":{"signature":"absent"},"response":{"status":401}}]"""

private const val BLOCK_EVERYTHING = """[{"name":"all → 403","response":{"status":403}}]"""

@ApiTest
@DisplayName("Rodada numa URL de laboratório de defesa")
class DefenseRoundApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    private val redis: StringRedisTemplate,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun lab(): JsonNode = api.json(api.send("POST", "/defense-lab", "{}".toByteArray(), JSON_BODY))

    private fun id(lab: JsonNode): String = lab["token"]["uuid"].asString()

    private fun secret(lab: JsonNode) = mapOf(SECRET_HEADER to lab["read_secret"].asString())

    private fun post(
        lab: JsonNode,
        suffix: String,
        body: String = "{}",
    ): HttpResponse<String> = api.send("POST", "/token/${id(lab)}/defense-lab/rounds$suffix", body.toByteArray(), JSON_BODY + secret(lab))

    private fun start(
        lab: JsonNode,
        body: String = "{}",
    ): HttpResponse<String> = post(lab, "", body)

    private fun started(lab: JsonNode): String = api.json(start(lab))["round_id"].asString()

    private fun finish(
        lab: JsonNode,
        round: String,
    ): HttpResponse<String> = post(lab, "/$round/finish")

    private fun report(
        lab: JsonNode,
        round: String,
    ): HttpResponse<String> = api.send("GET", "/token/${id(lab)}/defense-lab/rounds/$round", headers = JSON_CLIENT + secret(lab))

    private fun messages(lab: JsonNode): List<JsonNode> =
        api.json(api.send("GET", "/token/${id(lab)}/requests?per_page=100", headers = JSON_CLIENT + secret(lab)))["data"].toList()

    private fun verdicts(
        lab: JsonNode,
        round: String,
        requests: List<JsonNode>,
    ): HttpResponse<String> =
        post(
            lab,
            "/$round/verdicts",
            json(mapOf("verdicts" to requests.map { attack(it["uuid"].asString()) })),
        )

    private fun attack(requestId: String) = mapOf("request_id" to requestId, "verdict" to "attack", "family" to "integrity")

    private fun rules(
        lab: JsonNode,
        rules: String,
    ) = api.send("PUT", "/token/${id(lab)}/rules", rules.toByteArray(), JSON_BODY + secret(lab))

    private fun delete(lab: JsonNode) = api.send("DELETE", "/token/${id(lab)}", headers = JSON_CLIENT + secret(lab))

    @Test
    @DisplayName(
        "Dado o defensor do piso (marca o que a assinatura reprova e barra com regra), quando roda, então detecta e barra os " +
            "4 ataques e as 18 legítimas passam",
    )
    fun rodada_defensorDoPiso_deveDetectarEBarrarTudo() {
        val lab = lab()
        val opened = start(lab)
        val round = api.json(opened)["round_id"].asString()

        val recorded = verdicts(lab, round, messages(lab).filterNot { it["signature"]["valid"].asBoolean() })
        rules(lab, FLOOR_RULES)
        val response = finish(lab, round)
        val report = api.json(response)

        assertThat(opened.statusCode()).isEqualTo(201)
        assertThat(api.json(opened)["requests"].asInt()).isEqualTo(LEGITIMATE + ATTACKS)
        assertThat(api.json(opened).has("seed")).isFalse()
        assertThat(api.json(recorded)["recorded"].asInt()).isEqualTo(ATTACKS)
        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(report["catalog_version"].asString()).isEqualTo("defense-catalog/1")
        assertThat(report["seed"].asLong()).isBetween(0, MAX_SEED)
        assertThat(report["containment_seconds"].asLong()).isBetween(0, 60)
        assertThat(report["scenarios"].toList().map { it["code"].asString() }).containsExactly("I1", "I2", "I3", "I4")
        assertThat(report["scenarios"].toList().map { it["floor"]["actual"].asString() })
            .containsExactly("invalid", "invalid", "absent", "invalid")
        assertThat(report["scenarios"].toList().filterNot { it["floor"]["ok"].asBoolean() }).isEmpty()
        assertThat(report["detection"].toString()).isEqualTo("""{"attacks":4,"detected":4,"legitimate":18,"false_positives":0}""")
        assertThat(report["containment"].toString()).isEqualTo("""{"attacks":4,"blocked":4,"legitimate":18,"passed":18}""")
        assertThat(report["scenarios"].toList().map { it["containment"]["status"].asInt() }).containsOnly(401)
        assertThat(report["false_positives"].size()).isZero()
        delete(lab)
    }

    @Test
    @DisplayName("Dado nenhum veredicto e nenhuma regra, quando fecha, então nada é detectado nem barrado e as legítimas passam")
    fun rodada_semDefesa_deveContarTudoComoPerdido() {
        val lab = lab()
        val round = started(lab)

        val report = api.json(finish(lab, round))

        assertThat(report["detection"].toString()).isEqualTo("""{"attacks":4,"detected":0,"legitimate":18,"false_positives":0}""")
        assertThat(report["containment"].toString()).isEqualTo("""{"attacks":4,"blocked":0,"legitimate":18,"passed":18}""")
        assertThat(report["scenarios"].toList().map { it["detection"]["verdict"].asString() }).containsOnly("legitimate")
        delete(lab)
    }

    @Test
    @DisplayName(
        "Dado o defensor que marca tudo como ataque e barra tudo, quando fecha, então as 18 legítimas viram falso positivo e " +
            "nenhuma passa",
    )
    fun rodada_defensorQueBarraTudo_deveContarLegitimasPerdidas() {
        val lab = lab()
        val round = started(lab)

        verdicts(lab, round, messages(lab))
        rules(lab, BLOCK_EVERYTHING)
        val report = api.json(finish(lab, round))

        assertThat(report["detection"].toString()).isEqualTo("""{"attacks":4,"detected":4,"legitimate":18,"false_positives":18}""")
        assertThat(report["containment"].toString()).isEqualTo("""{"attacks":4,"blocked":4,"legitimate":18,"passed":0}""")
        assertThat(report["false_positives"].size()).isEqualTo(LEGITIMATE)
        delete(lab)
    }

    @Test
    @DisplayName("Dado um veredicto reenviado como legítima, quando fecha, então vale o último envio")
    fun veredicto_reenviado_deveValerOUltimo() {
        val lab = lab()
        val round = started(lab)
        val attack = messages(lab).first { !it["signature"]["valid"].asBoolean() }

        verdicts(lab, round, listOf(attack))
        post(lab, "/$round/verdicts", """{"verdicts":[{"request_id":"${attack["uuid"].asString()}","verdict":"legitimate"}]}""")
        val report = api.json(finish(lab, round))

        assertThat(report["detection"]["detected"].asInt()).isZero()
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma rodada, quando lê o relatório antes do fim, então 409; depois do fim, o mesmo relatório do finish")
    fun relatorio_antesEDepoisDoFim() {
        val lab = lab()
        val round = started(lab)

        val before = report(lab, round)
        val finished = finish(lab, round)
        val after = report(lab, round)

        assertThat(before.statusCode()).isEqualTo(409)
        assertThat(after.statusCode()).isEqualTo(200)
        assertThat(api.json(after)).isEqualTo(api.json(finished))
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma semente informada, quando roda, então ela volta no relatório")
    fun semente_informada_deveVoltarNoRelatorio() {
        val lab = lab()
        val round = api.json(start(lab, """{"seed":12345}"""))["round_id"].asString()

        val report = api.json(finish(lab, round))

        assertThat(report["seed"].asLong()).isEqualTo(12345)
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma semente que não é inteiro de 0 a 2^53-1, quando abre a rodada, então 422 em seed e nenhuma rodada aberta")
    fun semente_invalida_deveRecusar() {
        val lab = lab()

        val seeds = listOf("\"abc\"", "1.5", "-1", "9007199254740992")

        val answers = seeds.map { start(lab, """{"seed":$it}""") }

        assertThat(answers.map { it.statusCode() }).containsOnly(422)
        assertThat(api.json(answers.first()).has("seed")).isTrue()
        assertThat(start(lab).statusCode()).isEqualTo(201)
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma URL comum, quando abre uma rodada, então 422 em defense_lab")
    fun start_urlComum_deveRecusar() {
        val id = api.tokenId()

        val response = api.send("POST", "/token/$id/defense-lab/rounds", "{}".toByteArray(), JSON_BODY)

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response).has("defense_lab")).isTrue()
    }

    @Test
    @DisplayName("Dado uma rodada aberta, quando abre outra, então 409 e nenhuma requisição nova chega")
    fun start_comRodadaAberta_deveRecusar() {
        val lab = lab()
        started(lab)
        val before = messages(lab).size

        val second = start(lab)

        assertThat(second.statusCode()).isEqualTo(409)
        assertThat(messages(lab)).hasSize(before)
        delete(lab)
    }

    @Test
    @DisplayName("Dado um veredicto de requisição que não é da rodada, quando envia, então 422 no índice dele e nada é gravado")
    fun veredicto_deFora_deveRecusar() {
        val lab = lab()
        val round = started(lab)
        val body = """{"verdicts":[{"request_id":"$UNKNOWN_ROUND","verdict":"attack"}]}"""

        val response = post(lab, "/$round/verdicts", body)

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response).has("verdicts.0.request_id")).isTrue()
        assertThat(redis.hasKey("token:${id(lab)}:defense:verdicts")).isFalse()
        delete(lab)
    }

    @Test
    @DisplayName("Dado veredictos mal formados, quando envia, então 422 com a chave de cada campo")
    fun veredicto_malFormado_deveApontarOCampo() {
        val lab = lab()
        val round = started(lab)
        val body = """{"verdicts":[{"request_id":"x","verdict":"maybe","family":"other"},7]}"""

        val response = post(lab, "/$round/verdicts", body)
        val notAList = post(lab, "/$round/verdicts", """{"verdicts":"all"}""")

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(api.json(response).propertyNames())
            .containsExactlyInAnyOrder("verdicts.0.request_id", "verdicts.0.verdict", "verdicts.0.family", "verdicts.1")
        assertThat(api.json(notAList).propertyNames()).containsExactly("verdicts")
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma rodada fechada, quando fecha de novo ou envia veredicto, então 409")
    fun rodadaFechada_deveRecusarFimEVeredicto() {
        val lab = lab()
        val round = started(lab)
        val request = messages(lab).first()
        finish(lab, round)

        val again = finish(lab, round)
        val late = verdicts(lab, round, listOf(request))

        assertThat(again.statusCode()).isEqualTo(409)
        assertThat(late.statusCode()).isEqualTo(409)
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma rodada que não existe, quando envia veredicto, fecha ou lê, então 404")
    fun rodadaInexistente_deveDar404() {
        val lab = lab()

        val answers =
            listOf(
                post(lab, "/$UNKNOWN_ROUND/verdicts", """{"verdicts":[]}"""),
                finish(lab, UNKNOWN_ROUND),
                report(lab, UNKNOWN_ROUND),
            )

        assertThat(answers.map { it.statusCode() }).containsOnly(404)
        delete(lab)
    }

    @Test
    @DisplayName("Dado seis rodadas no minuto, quando abre a sétima, então 429 com Retry-After")
    fun start_acimaDoLimite_deveDar429() {
        val lab = lab()
        repeat(6) { finish(lab, started(lab)) }

        val seventh = start(lab)

        assertThat(seventh.statusCode()).isEqualTo(429)
        assertThat(
            seventh
                .headers()
                .firstValue("Retry-After")
                .orElseThrow()
                .toLong(),
        ).isBetween(1, 60)
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma rodada sem o segredo de leitura, quando chama as rotas dela, então 401")
    fun rotas_semSegredo_devemDar401() {
        val lab = lab()
        val round = started(lab)
        val path = "/token/${id(lab)}/defense-lab/rounds"

        val answers =
            listOf(
                api.send("POST", path, "{}".toByteArray(), JSON_BODY),
                api.send("POST", "$path/$round/verdicts", """{"verdicts":[]}""".toByteArray(), JSON_BODY),
                api.send("POST", "$path/$round/finish", "{}".toByteArray(), JSON_BODY),
                api.send("GET", "$path/$round", headers = JSON_CLIENT),
            )

        assertThat(answers.map { it.statusCode() }).containsOnly(401)
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma URL de laboratório com rodadas, quando é apagada, então as chaves das rodadas somem")
    fun delete_deveApagarAsRodadas() {
        val lab = lab()
        val round = started(lab)
        verdicts(lab, round, messages(lab).take(1))
        val before = redis.keys("token:${id(lab)}:defense:*").orEmpty()

        delete(lab)

        assertThat(before).hasSize(4)
        assertThat(redis.keys("token:${id(lab)}:defense:*")).isEmpty()
    }
}
