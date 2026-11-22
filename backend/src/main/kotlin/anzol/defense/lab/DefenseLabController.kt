package anzol.defense.lab

import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.e2ee.lab.LabRunsError
import anzol.http.legacyError
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

private val REQUEST_ID = Regex(UUID_PATTERN)
private const val ROUND = "/token/{tokenId:$UUID_PATTERN}/defense-lab/rounds/{roundId:$UUID_PATTERN}"

/** URLs de laboratório de defesa: criar uma pronta ([DefenseLabService]), listar o catálogo e conduzir a rodada ([DefenseRunner]). */
@RestController
class DefenseLabController(
    private val labs: DefenseLabService,
    private val runner: DefenseRunner,
    private val tokens: TokenStore,
) {
    /** Não há campo a escolher; o corpo só é lido para recusar JSON quebrado, como nas demais rotas de gestão. */
    @PostMapping("/defense-lab")
    fun create(request: HttpServletRequest): ResponseEntity<Any> {
        request.requireJsonObject()
        return when (val created = labs.create(request.remoteAddr, request.getHeader("User-Agent"))) {
            is Parsed.Valid -> ResponseEntity.status(HttpStatus.CREATED).body(created.value)
            is Parsed.Invalid -> request.validationFailure(created.errors)
        }
    }

    /** O catálogo é público e não diz qual requisição de uma rodada é de qual cenário. */
    @GetMapping("/defense-lab/scenarios")
    fun scenarios(): List<DefenseScenarioView> = DefenseScenario.entries.map { it.view() }

    /** `{"seed"?: inteiro}`; sem a semente, o servidor sorteia. Entrega a onda 1 antes de responder. */
    @PostMapping("/token/{tokenId:$UUID_PATTERN}/defense-lab/rounds")
    fun start(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        val given = request.requireJsonObject().inputBag()["seed"]
        val seed = (given as? Number)?.takeIf { it.toDouble() == it.toLong().toDouble() && it.toLong() in 0..MAX_SEED }?.toLong()
        if (given != null && seed == null) {
            return request.validationFailure(mapOf("seed" to listOf("The seed must be an integer between 0 and $MAX_SEED.")))
        }
        return request.respond(runner.start(token, seed), HttpStatus.CREATED)
    }

    /** `{"verdicts": [{request_id, verdict, family?}]}`; pode vir em partes, e para o mesmo id vale o último. */
    @PostMapping("$ROUND/verdicts")
    fun verdicts(
        @PathVariable tokenId: TokenId,
        @PathVariable roundId: String,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        return when (val parsed = readVerdicts(request.requireJsonObject().inputBag()["verdicts"])) {
            is Parsed.Valid -> request.respond(runner.verdicts(token, roundId, parsed.value))
            is Parsed.Invalid -> request.validationFailure(parsed.errors)
        }
    }

    @PostMapping("$ROUND/finish")
    fun finish(
        @PathVariable tokenId: TokenId,
        @PathVariable roundId: String,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        request.requireJsonObject()
        return request.respond(runner.finish(token, roundId))
    }

    @GetMapping(ROUND)
    fun report(
        @PathVariable tokenId: TokenId,
        @PathVariable roundId: String,
        request: HttpServletRequest,
    ): ResponseEntity<Any> = request.respond(runner.report(tokens.findOrGone(tokenId), roundId))
}

private fun <T : Any> HttpServletRequest.respond(
    outcome: RoundOutcome<T>,
    status: HttpStatus = HttpStatus.OK,
): ResponseEntity<Any> =
    when (outcome) {
        is RoundOutcome.Done -> {
            ResponseEntity.status(status).body(outcome.value)
        }

        is RoundOutcome.Invalid -> {
            validationFailure(outcome.errors)
        }

        RoundOutcome.NotFound -> {
            legacyError(HttpStatus.NOT_FOUND, "Round not found")
        }

        is RoundOutcome.Conflict -> {
            legacyError(HttpStatus.CONFLICT, outcome.message)
        }

        is RoundOutcome.Limited -> {
            ResponseEntity
                .status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, outcome.retryAfterSeconds.toString())
                .body(LabRunsError("Too many defense rounds for this URL; try again later"))
        }
    }

/** A lista de veredictos do pedido, com os erros sob `verdicts.N.campo`. */
private fun readVerdicts(input: Any?): Parsed<List<Pair<String, Verdict>>> {
    val items = input as? List<*> ?: return Parsed.Invalid(mapOf("verdicts" to listOf("The verdicts must be a list.")))
    val errors = items.flatMapIndexed { index, item -> verdictErrors(index, item as? Map<*, *>) }.toMap()
    return if (errors.isEmpty()) Parsed.Valid(items.filterIsInstance<Map<*, *>>().map(::verdictOf)) else Parsed.Invalid(errors)
}

/** Um item já validado por [verdictErrors]. */
private fun verdictOf(item: Map<*, *>): Pair<String, Verdict> {
    val verdict = checkNotNull(VerdictKind.of(item["verdict"].toString()))
    return item["request_id"].toString() to Verdict(verdict, (item["family"] as? String)?.let(DefenseFamily::of))
}

private fun verdictErrors(
    index: Int,
    item: Map<*, *>?,
): List<Pair<String, List<String>>> {
    if (item == null) return listOf("verdicts.$index" to listOf("The verdict must be an object."))
    val requestId = item["request_id"]
    val verdict = item["verdict"]
    val family = item["family"]
    return listOfNotNull(
        ("verdicts.$index.request_id" to listOf("The request_id must be a request UUID."))
            .takeIf { requestId !is String || !REQUEST_ID.matches(requestId) },
        ("verdicts.$index.verdict" to listOf("The verdict must be legitimate or attack."))
            .takeIf { verdict !is String || VerdictKind.of(verdict) == null },
        ("verdicts.$index.family" to listOf("The selected family is invalid."))
            .takeIf { family != null && (family !is String || DefenseFamily.of(family) == null) },
    )
}
