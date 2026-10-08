package anzol.e2ee.lab

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
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.http.HttpResponse

@ApiTest
@DisplayName("Rodada de cenários numa URL de laboratório E2EE")
class LabRunApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    private fun lab(): JsonNode = api.json(api.send("POST", "/e2ee-lab", "{}".toByteArray(), JSON_BODY))

    private fun id(lab: JsonNode): String = lab["token"]["uuid"].asString()

    private fun secret(lab: JsonNode) = mapOf(SECRET_HEADER to lab["read_secret"].asString())

    private fun run(
        lab: JsonNode,
        body: String = "{}",
    ): HttpResponse<String> = api.send("POST", "/token/${id(lab)}/e2ee-lab/run", body.toByteArray(), JSON_BODY + secret(lab))

    private fun delete(lab: JsonNode) = api.send("DELETE", "/token/${id(lab)}", headers = JSON_CLIENT + secret(lab))

    @Test
    @DisplayName("Dado uma URL de laboratório, quando roda todos os cenários, então os 27 conferem com o esperado e nada vem aberto")
    fun run_todos_devemConferir() {
        val lab = lab()

        val response = run(lab)
        val report = api.json(response)

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(report["total"].asInt()).isEqualTo(27)
        assertThat(report["results"].toList().filterNot { it["ok"].asBoolean() }.map { it.toString() }).isEmpty()
        assertThat(report["matched"].asInt()).isEqualTo(27)
        val p3b = report["results"].toList().first { it["code"].asString() == "P3b" }
        assertThat(p3b["actual"]["data_matches"].asBoolean()).isTrue()
        assertThat(response.body()).doesNotContain("\"decrypted\"", "ação concluída")
        delete(lab)
    }

    @Test
    @DisplayName("Dado só P1 e N4, quando roda, então o relatório tem os dois, com o 202 e o 500 e o uuid de cada mensagem")
    fun run_escolhidos_deveRodarSoEles() {
        val lab = lab()

        val report = api.json(run(lab, """{"scenarios":["P1","n4"]}"""))
        val results = report["results"].toList()

        assertThat(results.map { it["code"].asString() }).containsExactly("P1", "N4")
        assertThat(results.map { it["actual"]["status"].asInt() }).containsExactly(202, 500)
        assertThat(results.map { it["request_id"].asString() }).allMatch { it.matches(Regex("[0-9a-f-]{36}")) }
        delete(lab)
    }

    @Test
    @DisplayName("Dado o app comparado com caixa depois do PUT, quando roda P5, então o esperado vira app_mismatch e confere")
    fun run_politicaMudada_deveEsperarComAPoliticaDeAgora() {
        val lab = lab()
        val e2ee = lab["token"]["e2ee"].deepCopy() as tools.jackson.databind.node.ObjectNode
        (e2ee["bindings"] as tools.jackson.databind.node.ObjectNode).put("app", "$.servico.nome")
        api.send(
            "PUT",
            "/token/${id(lab)}",
            """{"default_status":202,"e2ee":$e2ee,"signature":${lab["token"]["signature"]}}""".toByteArray(),
            JSON_BODY + secret(lab),
        )

        val result = api.json(run(lab, """{"scenarios":["P5"]}"""))["results"][0]

        assertThat(result["expected"]["reason"].asString()).isEqualTo("app_mismatch")
        assertThat(result["ok"].asBoolean()).isTrue()
        delete(lab)
    }

    @Test
    @DisplayName("Dado uma URL comum, um código desconhecido ou nenhum segredo, quando roda, então 422, 422 e 401")
    fun run_recusas_devemResponder() {
        val lab = lab()
        val common = api.tokenId()

        val notLab = api.send("POST", "/token/$common/e2ee-lab/run", "{}".toByteArray(), JSON_BODY)
        val unknown = run(lab, """{"scenarios":["P1","Z9"]}""")
        val noSecret = api.send("POST", "/token/${id(lab)}/e2ee-lab/run", "{}".toByteArray(), JSON_BODY)

        assertThat(notLab.statusCode()).isEqualTo(422)
        assertThat(api.json(notLab).has("lab")).isTrue()
        assertThat(unknown.statusCode()).isEqualTo(422)
        assertThat(api.json(unknown).has("scenarios.1")).isTrue()
        assertThat(noSecret.statusCode()).isEqualTo(401)
        delete(lab)
    }

    @Test
    @DisplayName("Dado seis rodadas no minuto, quando vem a sétima, então 429 com Retry-After")
    fun run_acimaDoLimite_deveSer429() {
        val lab = lab()
        repeat(6) { run(lab, """{"scenarios":["P1"]}""") }

        val limited = run(lab, """{"scenarios":["P1"]}""")

        assertThat(limited.statusCode()).isEqualTo(429)
        assertThat(limited.headers().firstValue("Retry-After")).isPresent()
        delete(lab)
    }

    @Test
    @DisplayName("Dado o catálogo, quando é lido, então tem os 27 com o esperado da política padrão")
    fun catalogo_deveListarOs27() {
        val catalog = api.json(api.send("GET", "/e2ee-lab/scenarios", headers = JSON_CLIENT)).toList()

        assertThat(catalog).hasSize(27)
        assertThat(catalog.first { it["code"].asString() == "P5" }["expected"]["state"].asString()).isEqualTo("valid")
        assertThat(catalog.first { it["code"].asString() == "Xe" }["expected"]["reason"].asString()).isEqualTo("evt_mismatch")
        assertThat(catalog.first { it["code"].asString() == "N7a" }["expected"]["status"].asInt()).isEqualTo(401)
    }
}
