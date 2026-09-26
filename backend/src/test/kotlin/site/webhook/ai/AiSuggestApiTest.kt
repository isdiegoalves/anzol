package site.webhook.ai

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.boot.test.web.server.LocalServerPort
import site.webhook.support.AiApiTest
import site.webhook.support.ApiClient
import site.webhook.support.FakeLlm
import site.webhook.support.JSON_BODY
import site.webhook.support.JSON_CLIENT
import site.webhook.support.TEST_AI_KEY
import site.webhook.support.TEST_MODEL_JSON
import tools.jackson.databind.json.JsonMapper
import java.net.http.HttpResponse
import java.util.concurrent.CompletableFuture

private const val VALID_RULE =
    """{"rule": {"name": "pagamento limitado", "match": {"method": ["POST"], "path": {"equals": "/pagamentos"}},
    "response": {"status": 429, "headers": {"Retry-After": "5"}}}, "explanation": "Responde 429 aos POST em /pagamentos."}"""
private const val BAD_REGEX = """{"rule": {"name": "x", "match": {"path": {"regex": "(["}}}, "explanation": "?"}"""
private const val NO_NAME = """{"rule": {"match": {"method": ["GET"]}}, "explanation": "?"}"""
private const val BAD_STATUS = """{"rule": {"name": "y", "response": {"status": 700}}, "explanation": "?"}"""

@AiApiTest
@ExtendWith(OutputCaptureExtension::class)
@DisplayName("POST /token/{id}/rules/suggest")
class AiSuggestApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    @BeforeEach
    fun reset() = FakeLlm.reset()

    private fun suggest(
        tokenId: String,
        body: String,
    ): HttpResponse<String> = api.send("POST", "/token/$tokenId/rules/suggest", body.toByteArray(), JSON_BODY)

    private fun prompt(text: String) = """{"prompt": "$text"}"""

    @Test
    @DisplayName("Dada a resposta válida do modelo, quando sugere, então devolve a regra validada sem gravar e pede saída estruturada")
    fun suggest_respostaValida_deveDevolverARegraSemGravar() {
        val tokenId = api.tokenId()
        FakeLlm.answer(VALID_RULE, reasoning = "pensando em voz alta")

        val response = suggest(tokenId, prompt("responda 429 com Retry-After 5 para POST em /pagamentos"))

        assertThat(response.statusCode()).isEqualTo(200)
        val body = api.json(response)
        assertThat(body["attempts"].asInt()).isEqualTo(1)
        assertThat(body["explanation"].asString()).isEqualTo("Responde 429 aos POST em /pagamentos.")
        assertThat(body["rule"]["name"].asString()).isEqualTo("pagamento limitado")
        assertThat(body["rule"]["response"]["status"].asInt()).isEqualTo(429)
        assertThat(body["rule"]["match"]["path"]["equals"].asString()).isEqualTo("/pagamentos")
        assertThat(api.json(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT)).size()).isZero()
        val sent = FakeLlm.received.single()
        assertThat(sent.path).isEqualTo("/v1/chat/completions")
        assertThat(sent.body["model"].asString()).isEqualTo(TEST_MODEL_JSON)
        assertThat(sent.body["temperature"].asDouble()).isZero()
        assertThat(sent.body["response_format"]["type"].asString()).isEqualTo("json_schema")
        assertThat(sent.body["response_format"]["json_schema"]["strict"].asBoolean()).isTrue()
        assertThat(sent.body["response_format"]["json_schema"]["schema"]["properties"].has("rule")).isTrue()
        assertThat(sent.text()).contains("responda 429 com Retry-After 5 para POST em /pagamentos")
    }

    @Test
    @DisplayName("Dadas duas respostas inválidas e uma válida, quando sugere, então cada tentativa leva os erros do parser da anterior")
    fun suggest_duasInvalidasEUmaValida_deveMandarOsErrosAoModelo() {
        val tokenId = api.tokenId()
        FakeLlm.answer(BAD_REGEX)
        FakeLlm.answer(NO_NAME)
        FakeLlm.answer(VALID_RULE)

        val response = suggest(tokenId, prompt("qualquer regra"))

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(api.json(response)["attempts"].asInt()).isEqualTo(3)
        val (first, second, third) = FakeLlm.received
        assertThat(first.text()).doesNotContain("The regex is invalid.")
        assertThat(second.text()).contains("The regex is invalid.")
        assertThat(third.text()).contains("The name field is required.")
    }

    @Test
    @DisplayName("Dadas três respostas inválidas, quando sugere, então 422 com os erros da última, três pedidos e nada gravado")
    fun suggest_tresInvalidas_deveResponder422() {
        val tokenId = api.tokenId()
        FakeLlm.answer("isto não é JSON")
        FakeLlm.answer(BAD_REGEX)
        FakeLlm.answer(BAD_STATUS)

        val response = suggest(tokenId, prompt("qualquer regra"))

        assertThat(response.statusCode()).isEqualTo(422)
        assertThat(response.body()).contains("The status must be between 100 and 599.")
        assertThat(api.json(response)["attempts"].asInt()).isEqualTo(3)
        assertThat(FakeLlm.received).hasSize(3)
        assertThat(FakeLlm.received[1].text()).contains("rule and explanation")
        assertThat(api.json(api.send("GET", "/token/$tokenId/rules", headers = JSON_CLIENT)).size()).isZero()
    }

    @Test
    @DisplayName("Dado o LLM respondendo 500, quando sugere, então 502 com mensagem clara e um pedido só (sem retentativa)")
    fun suggest_llmCom500_deveResponder502() {
        val tokenId = api.tokenId()
        FakeLlm.fail(500)

        val response = suggest(tokenId, prompt("qualquer regra"))

        assertThat(response.statusCode()).isEqualTo(502)
        assertThat(api.json(response)["error"].asString()).isEqualTo("The language model failed: the model server answered HTTP 500.")
        assertThat(FakeLlm.received).hasSize(1)
    }

    @Test
    @DisplayName("Dado o LLM fechando a conexão, quando sugere, então 502")
    fun suggest_llmFechaAConexao_deveResponder502() {
        val tokenId = api.tokenId()
        FakeLlm.hangUp()

        val response = suggest(tokenId, prompt("qualquer regra"))

        assertThat(response.statusCode()).isEqualTo(502)
        assertThat(api.json(response)["error"].asString()).startsWith("The language model failed:")
    }

    @Test
    @DisplayName("Dado prompt ausente, vazio, não texto ou longo demais, quando sugere, então 422 em prompt sem chamar o LLM")
    fun suggest_promptInvalido_deveResponder422() {
        val tokenId = api.tokenId()
        val long = "a".repeat(2001)

        val answers =
            listOf("{}", """{"prompt": ""}""", """{"prompt": 5}""", """{"prompt": "$long"}""", """{"prompt": "x", "lang": "!!"}""")
                .map { api.json(suggest(tokenId, it)) }

        assertThat(answers.map { it.propertyNames().toList() })
            .containsExactly(listOf("prompt"), listOf("prompt"), listOf("prompt"), listOf("prompt"), listOf("lang"))
        assertThat(answers[0]["prompt"][0].asString()).isEqualTo("The prompt field is required.")
        assertThat(answers[2]["prompt"][0].asString()).isEqualTo("The prompt must be a string.")
        assertThat(answers[3]["prompt"][0].asString()).isEqualTo("The prompt may not be greater than 2000 characters.")
        assertThat(FakeLlm.received).isEmpty()
    }

    @Test
    @DisplayName("Dada uma mensagem de exemplo, quando sugere com request_id, então o corpo dela vai ao prompt, delimitado")
    fun suggest_comRequestId_deveMandarAMensagemDelimitada() {
        val tokenId = api.tokenId()
        val requestId = api.capture(tokenId, "POST", "/pagamentos", """{"marcador":"EXEMPLO-42"}""".toByteArray())["uuid"].asString()
        FakeLlm.answer(VALID_RULE)

        val response = suggest(tokenId, """{"prompt": "igual a esta", "request_id": "$requestId"}""")

        assertThat(response.statusCode()).isEqualTo(200)
        val user =
            FakeLlm.received
                .single()
                .messages()
                .last()["content"]
                .asString()
        assertThat(user).containsPattern("(?s)<<<UNTRUSTED_MESSAGE .*EXEMPLO-42.*UNTRUSTED_MESSAGE>>>")
    }

    @Test
    @DisplayName("Dadas 10 chamadas no minuto, quando vem a 11ª, então 429 com Retry-After; outra URL segue")
    fun suggest_onzeChamadasNoMinuto_deveResponder429() {
        val tokenId = api.tokenId()
        repeat(11) { FakeLlm.answer(VALID_RULE) }

        val statuses = (1..10).map { suggest(tokenId, prompt("regra $it")).statusCode() }
        val eleventh = suggest(tokenId, prompt("regra 11"))

        assertThat(statuses).containsOnly(200)
        assertThat(eleventh.statusCode()).isEqualTo(429)
        assertThat(
            eleventh
                .headers()
                .firstValue("Retry-After")
                .orElseThrow()
                .toInt(),
        ).isBetween(1, 60)
        assertThat(api.json(eleventh)["error"].asString()).startsWith("Too many AI calls")
        assertThat(suggest(api.tokenId(), prompt("outra URL")).statusCode()).isEqualTo(200)
    }

    @Test
    @DisplayName("Dadas duas chamadas simultâneas na mesma URL, quando sugerem, então nunca chegam juntas ao LLM")
    fun suggest_duasSimultaneas_deveChamarOLlmUmaDeCadaVez() {
        val tokenId = api.tokenId()
        FakeLlm.answer(VALID_RULE, delayMs = 500)
        FakeLlm.answer(VALID_RULE, delayMs = 500)

        val calls = (1..2).map { CompletableFuture.supplyAsync { suggest(tokenId, prompt("simultânea $it")).statusCode() } }
        val statuses = calls.map { it.join() }

        assertThat(statuses).contains(200)
        assertThat(statuses).allMatch { it == 200 || it == 429 }
        assertThat(FakeLlm.maxInFlight.get()).isEqualTo(1)
    }

    @Test
    @DisplayName(
        "Dada a chave do LLM, quando sugere com sucesso e com falha, então ela vai só no Authorization, nunca no log nem na resposta",
    )
    fun suggest_chave_naoDeveVazar(output: CapturedOutput) {
        val tokenId = api.tokenId()
        FakeLlm.answer(VALID_RULE)
        FakeLlm.fail(401)

        val ok = suggest(tokenId, prompt("com sucesso"))
        val failed = suggest(tokenId, prompt("com falha"))

        assertThat(FakeLlm.received.map { it.authorization }).containsOnly("Bearer $TEST_AI_KEY")
        assertThat(ok.body()).doesNotContain(TEST_AI_KEY)
        assertThat(failed.statusCode()).isEqualTo(502)
        assertThat(failed.body()).doesNotContain(TEST_AI_KEY)
        assertThat(output.all).doesNotContain(TEST_AI_KEY)
    }

    @Test
    @DisplayName("Dada uma URL inexistente, quando sugere, então 410 sem chamar o LLM")
    fun suggest_urlInexistente_deveResponder410() {
        val response = suggest("00000000-0000-4000-8000-000000000000", prompt("x"))

        assertThat(response.statusCode()).isEqualTo(410)
        assertThat(FakeLlm.received).isEmpty()
    }
}
