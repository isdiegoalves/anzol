package anzol.e2ee.lab

import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.http.requireJsonObject
import anzol.http.validationFailure
import anzol.rules.Parsed
import anzol.token.TokenStore
import anzol.token.findOrGone
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController

/** Erro do 429 das rodadas. */
data class LabRunsError(
    val error: String,
)

/** URLs de laboratório E2EE: criar uma pronta ([LabService]), listar os cenários e rodá-los ([LabRunner]). */
@RestController
class LabController(
    private val labs: LabService,
    private val runner: LabRunner,
    private val tokens: TokenStore,
) {
    @PostMapping("/e2ee-lab")
    fun create(request: HttpServletRequest): ResponseEntity<Any> =
        when (val created = labs.create(request.requireJsonObject().inputBag(), request.remoteAddr, request.getHeader("User-Agent"))) {
            is Parsed.Valid -> ResponseEntity.status(HttpStatus.CREATED).body(created.value)
            is Parsed.Invalid -> request.validationFailure(created.errors)
        }

    /** O catálogo com o esperado da política padrão (P5 e Xe mudam se a URL mudar o `ignore_case`). */
    @GetMapping("/e2ee-lab/scenarios")
    fun scenarios(): List<ScenarioView> = LabRunner.catalog(DEFAULT_LAB_POLICY)

    /** `{"scenarios"?: ["P1", …]}`; sem a lista, todos. URL que não é de laboratório: 422; seis rodadas no minuto: 429. */
    @PostMapping("/token/{tokenId:$UUID_PATTERN}/e2ee-lab/run")
    fun run(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        val codes = request.requireJsonObject().inputBag()["scenarios"]
        if (codes != null && (codes !is List<*> || codes.any { it !is String })) {
            return request.validationFailure(mapOf("scenarios" to listOf("The scenarios must be a list of codes.")))
        }
        return when (val run = runner.run(token, (codes as? List<*>).orEmpty().map { it.toString() })) {
            is LabRun.Done -> {
                ResponseEntity.ok(run.report)
            }

            is LabRun.Invalid -> {
                request.validationFailure(run.errors)
            }

            is LabRun.Limited -> {
                ResponseEntity
                    .status(HttpStatus.TOO_MANY_REQUESTS)
                    .header(HttpHeaders.RETRY_AFTER, run.retryAfterSeconds.toString())
                    .body(LabRunsError("Too many lab runs for this URL; try again later"))
            }
        }
    }
}
