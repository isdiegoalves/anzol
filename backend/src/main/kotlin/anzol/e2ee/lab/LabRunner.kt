package anzol.e2ee.lab

import anzol.RedisKeys
import anzol.RequestId
import anzol.capture.RequestStore
import anzol.countInWindow
import anzol.e2ee.DecryptionState
import anzol.e2ee.E2eePolicy
import anzol.rules.sameJson
import anzol.token.Token
import org.springframework.core.env.Environment
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Component
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Clock
import java.time.Duration
import java.util.UUID

/** Rodadas de cenários por URL de laboratório no minuto. */
private const val MAX_RUNS_PER_MINUTE = 6
private val SEND_TIMEOUT: Duration = Duration.ofSeconds(10)

/** O que a captura deu num cenário; [dataMatches] só nos que abrem, e diz se o `data` aberto é o enviado. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class Actual(
    val status: Int,
    val state: DecryptionState?,
    val reason: String?,
    val kid: String?,
    val dataMatches: Boolean?,
)

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class LabResult(
    val code: String,
    val description: String,
    val expected: Expected,
    val actual: Actual,
    val ok: Boolean,
    val requestId: RequestId?,
)

/** A rodada: quantos conferem e o resultado de cada cenário, na ordem do catálogo. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class LabReport(
    val total: Int,
    val matched: Int,
    val results: List<LabResult>,
)

/** O fim de uma rodada: o relatório, os erros do pedido (422) ou o limite da URL (429). */
sealed interface LabRun {
    data class Done(
        val report: LabReport,
    ) : LabRun

    data class Invalid(
        val errors: Map<String, List<String>>,
    ) : LabRun

    data class Limited(
        val retryAfterSeconds: Long,
    ) : LabRun
}

/** Um cenário do catálogo como a API o lista. */
data class ScenarioView(
    val code: String,
    val description: String,
    val expected: Expected,
)

/**
 * Roda os cenários numa URL de laboratório: gera cada vetor ([LabVectors]), entrega pela captura de verdade (o HMAC,
 * a decifra e as regras da URL) por loopback, e compara o status e a decifra gravada com o esperado. Só URL `lab`;
 * o relatório nunca traz o texto aberto, só se ele é igual ao enviado.
 */
@Component
class LabRunner(
    private val requests: RequestStore,
    private val redis: StringRedisTemplate,
    private val environment: Environment,
    private val clock: Clock,
) {
    private val http: HttpClient = HttpClient.newBuilder().connectTimeout(SEND_TIMEOUT).build()

    /** [codes] vazio roda todos. URL que não é de laboratório ou código desconhecido: 422; acima do limite: 429. */
    fun run(
        token: Token,
        codes: List<String>,
    ): LabRun {
        val chosen = codes.map { it to LabScenario.of(it) }
        val unknown = chosen.withIndex().filter { it.value.second == null }
        val policy = token.e2ee
        return when {
            token.lab == null -> {
                LabRun.Invalid(NOT_A_LAB)
            }

            policy == null -> {
                LabRun.Invalid(NO_POLICY)
            }

            unknown.isNotEmpty() -> {
                LabRun.Invalid(
                    unknown.associate {
                        "scenarios.${it.index}" to
                            listOf("The selected scenario ${it.value.first} is invalid.")
                    },
                )
            }

            else -> {
                limited(token) ?: LabRun.Done(report(token, chosen.mapNotNull { it.second }.ifEmpty { LabScenario.entries }))
            }
        }
    }

    private fun limited(token: Token): LabRun.Limited? =
        redis
            .countInWindow(
                RedisKeys.labRuns(token.uuid),
                Duration.ofMinutes(1),
                MAX_RUNS_PER_MINUTE,
            )?.let { LabRun.Limited(it.retryAfterSeconds) }

    private fun report(
        token: Token,
        scenarios: List<LabScenario>,
    ): LabReport {
        val vectors = LabVectors(checkNotNull(token.e2ee), token.e2eeKeys, checkNotNull(token.lab).signer, token.signature, clock.instant())
        val results = scenarios.map { result(token, it, vectors) }
        return LabReport(results.size, results.count { it.ok }, results)
    }

    private fun result(
        token: Token,
        scenario: LabScenario,
        vectors: LabVectors,
    ): LabResult {
        val expected = scenario.expected(checkNotNull(token.e2ee))
        val request = vectors.request(scenario)
        val response = deliver(token, request)
        val requestId =
            response
                .headers()
                .firstValue("X-Request-Id")
                .map { RequestId(UUID.fromString(it)) }
                .orElse(null)
        val message = requestId?.let { requests.find(token, it) }
        val decryption = message?.decryption
        val opened = message?.decrypted
        val matches = if (opened != null && request.data != null) sameJson(request.data, opened) else null
        val actual = Actual(response.statusCode(), decryption?.state, decryption?.reason, decryption?.kid, matches)
        val ok =
            actual.status == expected.status &&
                actual.state == expected.state &&
                actual.reason == expected.reason &&
                (expected.kid == null || actual.kid == expected.kid) &&
                matches != false
        return LabResult(scenario.code, scenario.description, expected, actual, ok, requestId)
    }

    /** A requisição pela porta do próprio servidor, como chegaria de fora. */
    private fun deliver(
        token: Token,
        request: LabRequest,
    ): HttpResponse<String> {
        val port = checkNotNull(environment.getProperty("local.server.port")) { "porta do servidor desconhecida" }
        val builder =
            HttpRequest
                .newBuilder(URI.create("http://127.0.0.1:$port/${token.uuid}"))
                .timeout(SEND_TIMEOUT)
                .POST(HttpRequest.BodyPublishers.ofString(request.body))
        request.headers.forEach { (name, value) -> builder.header(name, value) }
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString())
    }

    companion object {
        /** O catálogo com o esperado da política padrão do laboratório. */
        fun catalog(policy: E2eePolicy): List<ScenarioView> =
            LabScenario.entries.map { ScenarioView(it.code, it.description, it.expected(policy)) }
    }
}

private val NOT_A_LAB = mapOf("lab" to listOf("This is not a lab URL: create one with POST /e2ee-lab."))
private val NO_POLICY = mapOf("e2ee" to listOf("The lab URL has no e2ee policy anymore: create a new lab URL."))
