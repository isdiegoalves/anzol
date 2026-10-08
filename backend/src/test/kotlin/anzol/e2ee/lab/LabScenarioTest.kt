package anzol.e2ee.lab

import anzol.e2ee.E2eeKey
import anzol.e2ee.E2eePolicy
import anzol.e2ee.ecKey
import anzol.e2ee.open
import anzol.e2ee.policy
import anzol.e2ee.readE2ee
import anzol.rules.Parsed
import anzol.rules.sameJson
import anzol.signature.HmacAlgorithm
import anzol.signature.Secret
import anzol.signature.SignatureConfig
import anzol.signature.SignatureEncoding
import anzol.signature.SignatureProvider
import anzol.signature.verify
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EnumSource
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.time.LocalDateTime

@DisplayName("Cenários do laboratório E2EE contra a verificação do Anzol")
class LabScenarioTest {
    private val now = Instant.now()
    private val signer = ecKey(LAB_SIGNER_KID)
    private val keys = listOf("enc-v1", "enc-v2").map { E2eeKey.generate(it, LocalDateTime.now()) }
    private val signature =
        SignatureConfig(
            SignatureProvider.Generic("X-Signature", HmacAlgorithm.SHA256, SignatureEncoding.HEX, null),
            Secret("segredo-hmac-lab"),
        )

    private fun labPolicy(
        appIgnoreCase: Boolean = true,
        path: String = "$.payload",
    ): E2eePolicy {
        val map = policy(signer, appIgnoreCase = appIgnoreCase) + mapOf("path" to path)
        val bindings =
            mapOf(
                "jti" to "$.eventId",
                "evt" to "$.tipoEvento.nome",
                "app" to if (appIgnoreCase) mapOf("path" to "$.servico.nome", "ignore_case" to true) else "$.servico.nome",
            )
        return when (val parsed = readE2ee(map + ("bindings" to bindings))) {
            is Parsed.Valid -> parsed.value
            is Parsed.Invalid -> error(parsed.errors)
        }
    }

    /** O que a captura faria: o HMAC sobre os bytes e a decifra do corpo. */
    private fun outcome(
        scenario: LabScenario,
        policy: E2eePolicy = labPolicy(),
    ): Pair<Expected, Expected> {
        val request = LabVectors(policy, keys, signer, signature, now).request(scenario)
        val hmac =
            signature.verify({ name ->
                request.headers.entries
                    .firstOrNull {
                        it.key.equals(name, true)
                    }?.value
            }, request.body.toByteArray(UTF_8), now)
        val opening = policy.open(request.body, hmac, keys, now)
        val expected = scenario.expected(policy)
        val result = opening.result
        val got = Expected(expected.status, result.state, result.reason, result.kid.takeIf { expected.kid != null })
        if (opening.data != null && request.data != null) {
            assertThat(sameJson(request.data, opening.data)).`as`("data de ${scenario.code}").isTrue()
        }
        return expected to got
    }

    @ParameterizedTest(name = "{0}")
    @EnumSource(LabScenario::class)
    @DisplayName("Dado cada cenário gerado, quando a verificação o abre, então dá o estado e o motivo esperados")
    fun cenario_gerado_deveDarOEsperado(scenario: LabScenario) {
        val (expected, got) = outcome(scenario)

        assertThat(got).isEqualTo(expected)
    }

    @Test
    @DisplayName("Dado o app comparado com caixa, quando roda P5, então o esperado passa a ser app_mismatch e confere")
    fun cenario_p5SemIgnorarCaixa_deveEsperarMismatch() {
        val policy = labPolicy(appIgnoreCase = false)

        val (expected, got) = outcome(LabScenario.P5, policy)

        assertThat(expected.reason).isEqualTo("app_mismatch")
        assertThat(got).isEqualTo(expected)
    }

    @Test
    @DisplayName("Dado o atributo em outro caminho ($.payload.conteudo), quando roda P1, então o gerador escreve nele e abre")
    fun cenario_outroCaminho_deveAbrir() {
        val (expected, got) = outcome(LabScenario.P1, labPolicy(path = "$.payload.conteudo"))

        assertThat(got).isEqualTo(expected)
    }

    @Test
    @DisplayName("Dado os códigos, quando procura sem caixa, então acha; código desconhecido é null")
    fun of_codigo_deveAchar() {
        assertThat(LabScenario.of("p3B")).isEqualTo(LabScenario.P3B)
        assertThat(LabScenario.of("Z9")).isNull()
        assertThat(LabScenario.entries).hasSize(27)
    }
}
