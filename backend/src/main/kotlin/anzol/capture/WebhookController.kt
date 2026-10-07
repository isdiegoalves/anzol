package anzol.capture

import anzol.STATUS_IN_PATH
import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.e2ee.E2eeReceiver
import anzol.http.PHP_DEFAULT_CONTENT_TYPE
import anzol.http.clientConnection
import anzol.http.rawPath
import anzol.legacy.phpIntval
import anzol.legacy.urlDecode
import anzol.rules.Decision
import anzol.rules.Dribble
import anzol.rules.Fault
import anzol.rules.NearMiss
import anzol.rules.RuleRef
import anzol.rules.RuleResponse
import anzol.rules.RuleStore
import anzol.rules.ScenarioStore
import anzol.rules.TemplateInput
import anzol.rules.dribblePieces
import anzol.rules.rendered
import anzol.rules.toMatchInput
import anzol.rules.toTemplateRequest
import anzol.stream.RequestStream
import anzol.telemetry.AnzolTelemetry
import anzol.telemetry.CaptureOutcome
import anzol.telemetry.CaptureStopwatch
import anzol.token.Token
import anzol.token.TokenStore
import anzol.token.findOrGone
import anzol.token.headerValue
import anzol.token.toLegacyDateTime
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestMethod
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Clock
import java.time.Duration

/** Os 4 cabeçalhos de `Controller::corsHeaders`. */
val CORS_HEADERS =
    linkedMapOf(
        "Access-Control-Allow-Origin" to "*",
        "Access-Control-Allow-Methods" to "GET, PUT, PATCH, POST, OPTIONS",
        "Access-Control-Allow-Headers" to "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range",
        "Access-Control-Expose-Headers" to "Content-Length,Content-Range",
    )

/**
 * Toda resposta da captura roda numa origem opaca: a tela e a API servem pelo mesmo endereço, e uma página que a URL
 * responda (HTML com script) leria o `localStorage` da tela e chamaria a API com o cookie de acesso. Sem
 * `allow-same-origin`, de propósito. Vai com `addHeader` depois dos cabeçalhos da regra: um CSP da regra se soma a este
 * (o navegador aplica os dois), nunca o substitui.
 */
const val CAPTURE_SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-modals"
const val CSP_HEADER = "Content-Security-Policy"

/** Caminho de captura (`/{uuid}` e `/{uuid}/…`): toda resposta dele, de sucesso ou de erro, sai com o [CAPTURE_SANDBOX]. */
private val CAPTURE_PATH = Regex("^/$UUID_PATTERN(/.*)?$", RegexOption.IGNORE_CASE)

fun HttpServletRequest.isCapturePath(): Boolean = CAPTURE_PATH.matches(requestURI)

/** Acrescenta o [CAPTURE_SANDBOX] se ele ainda não está entre os CSP da resposta (um CSP da regra se soma a ele). */
fun HttpServletResponse.addCaptureSandbox() {
    if (CAPTURE_SANDBOX !in getHeaders(CSP_HEADER)) addHeader(CSP_HEADER, CAPTURE_SANDBOX)
}

/** `charset_types` padrão do nginx que não começam com `text/` (esses o Symfony já cobre). */
private val NGINX_CHARSET_TYPES = setOf("application/javascript", "application/rss+xml")
private val VALID_FINAL_STATUS = 200..599
private const val FALLBACK_STATUS = 200

/**
 * Status da resposta: o 2º segmento do caminho quando contém `[1-5][0-9][0-9]` e o `(int)` dele
 * é um status válido, senão o padrão do token, senão 200. O app antigo respondia 500 nos dois
 * últimos casos (ex.: `/12345`, `default_status` 999); o contrato exige que não quebre.
 */
fun responseStatus(
    pathSegment: String?,
    defaultStatus: Long,
): Int {
    val fromPath = pathSegment?.takeIf { STATUS_IN_PATH.containsMatchIn(it) }?.let(::phpIntval)
    return listOfNotNull(fromPath, defaultStatus).firstOrNull { it in VALID_FINAL_STATUS }?.toInt() ?: FALLBACK_STATUS
}

/**
 * Content-Type da resposta: o Symfony acrescenta `; charset=UTF-8` a `text/...` sem charset e o
 * nginx acrescenta `; charset=utf-8` aos seus `charset_types`. Vazio ou 304: sem cabeçalho. No 204
 * o Symfony remove o cabeçalho e o PHP-FPM põe o padrão dele (`default_mimetype`).
 */
fun responseContentType(
    configured: String,
    status: Int,
): String? {
    val mediaType = configured.substringBefore(';').trim().lowercase()
    val hasCharset = configured.contains("charset", ignoreCase = true)
    return when {
        status == HttpServletResponse.SC_NO_CONTENT -> PHP_DEFAULT_CONTENT_TYPE
        configured.isEmpty() || status == HttpServletResponse.SC_NOT_MODIFIED -> null
        configured.startsWith("text/", ignoreCase = true) && !hasCharset -> "$configured; charset=UTF-8"
        mediaType in NGINX_CHARSET_TYPES && !hasCharset -> "$configured; charset=utf-8"
        else -> configured
    }
}

/**
 * `$request->segment(2)`: segmentos decodificados sem os vazios. O filtro do Laravel 5.4 é
 * `$v != ''`, então `"0"` fica (`/{token}/0/404` usa o status padrão).
 */
private fun HttpServletRequest.secondSegment(): String? =
    urlDecode(rawPath())
        .split('/')
        .filter { it.isNotEmpty() }
        .getOrNull(1)

// Cada dependência é um passo da captura (token, mensagens, regras, cenários, conexões presas, hora, tempo real,
// métricas e decifra); agrupá-las só para caber no limite criaria um tipo sem outro uso.
@Suppress("LongParameterList")
@RestController
class WebhookController(
    private val tokens: TokenStore,
    private val requests: RequestStore,
    private val rules: RuleStore,
    private val scenarios: ScenarioStore,
    private val held: HeldConnections,
    private val clock: Clock,
    private val stream: RequestStream,
    private val telemetry: AnzolTelemetry,
    private val e2ee: E2eeReceiver,
) {
    /**
     * `any {tokenId}/{statusCode?}` e `any {tokenId}/{any}` de `routes.php`. A primeira regra ativa que
     * casa responde (e muda o estado do cenário dela, junto com a escolha); sem ela, a resposta padrão da
     * URL de sempre (`default_*`, `timeout`, `retry_after` e o status pelo caminho). A mensagem grava qual
     * regra respondeu, ou a mais próxima. Cada captura respondida conta nas métricas de negócio, com o tempo
     * gasto pelo app (sem as esperas programadas). A falha que prende a conexão só vale com vaga ([HeldConnections]);
     * sem ela, a mensagem grava o 503 que o cliente recebe.
     */
    @RequestMapping(
        path = ["/{tokenId:$UUID_PATTERN}", "/{tokenId:$UUID_PATTERN}/**"],
        method = [
            RequestMethod.GET, RequestMethod.HEAD, RequestMethod.POST, RequestMethod.PUT,
            RequestMethod.PATCH, RequestMethod.DELETE, RequestMethod.OPTIONS,
        ],
    )
    fun capture(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ) {
        val stopwatch = CaptureStopwatch()
        val token = tokens.findOrGone(tokenId)
        val receivedAt = clock.instant()
        val received = e2ee.open(token, request.toCapturedRequest(tokenId, receivedAt, token.signature, token.schema), receivedAt)
        val decision = scenarios.decide(tokenId, rules.find(tokenId), received.toMatchInput())
        val waits = decision is Decision.Unmatched && token.timeout > 0
        if (waits) stopwatch.sleep(Duration.ofSeconds(token.timeout))
        // O created_at é a hora com que a janela das regras foi julgada; só a espera do timeout o adia.
        val arrival = if (waits) clock.instant() else receivedAt
        val fault = decision.fault()
        val defaultStatus = responseStatus(request.secondSegment(), token.defaultStatus)
        (if (fault?.holds == true) held.reserve(tokenId) else HoldSlot.NONE).use { slot ->
            val captured =
                received.copy(
                    createdAt = arrival.toLegacyDateTime(),
                    updatedAt = arrival.toLegacyDateTime(),
                    rule = decision.ruleRef(),
                    nearMiss = decision.nearMiss(),
                    response = decision.recordedResponse(defaultStatus, slot.refused),
                )
            val stored = requests.store(token, captured, arrival)
            telemetry.cleanupRemoved(stored.removed.size)
            stream.publish(captured.copy(seq = stored.seq), stored.removed) { requests.count(token) }
            // Status dado ao cliente; nulo quando a falha de rede da regra derrubou a conexão (nada mais vale).
            val status =
                when (decision) {
                    is Decision.Matched -> {
                        val answer = decision.rule.response
                        answerMatched(request, response, token, captured.copy(seq = stored.seq), answer, slot.refused, stopwatch)
                    }

                    is Decision.Unmatched -> {
                        defaultStatus.also { response.writeConfiguredResponse(token, captured, it) }
                    }
                }
            val outcome =
                CaptureOutcome(
                    method = request.method,
                    status = status,
                    ruleMatched = decision is Decision.Matched,
                    signature = captured.signature?.state(),
                    schema = captured.schema?.state(),
                    fault = fault.takeIf { slot.refused == null },
                )
            telemetry.captured(request, tokenId, outcome, stopwatch.elapsed())
        }
    }

    /**
     * Resposta da regra que casou: o 503 do teto de conexões presas ([refused]), a resposta dela ([answerByRule]) ou a
     * falha de rede, depois do status e dos cabeçalhos nas que começam a resposta. Devolve o status dado, ou nulo com a
     * falha.
     */
    @Suppress("LongParameterList")
    private fun answerMatched(
        request: HttpServletRequest,
        response: HttpServletResponse,
        token: Token,
        captured: CapturedRequest,
        answer: RuleResponse,
        refused: HoldLimit?,
        stopwatch: CaptureStopwatch,
    ): Int? {
        val fault = answer.fault
        return when {
            fault != null && refused != null -> {
                response.writeHoldRefusal(token, captured, fault, refused)
                HttpServletResponse.SC_SERVICE_UNAVAILABLE
            }

            fault == null -> {
                answerByRule(response, token, captured, answer, stopwatch)
            }

            else -> {
                if (fault.startsResponse) response.writeStartedResponse(token, captured, render(response, token, captured, answer), fault)
                request.clientConnection().fail(fault, captured, held.holdMax, stopwatch)
                null
            }
        }
    }

    /**
     * Resposta da regra sem `fault`: espera o `delay` (a mensagem já está gravada; a thread da requisição é
     * virtual) e responde, com o corpo de uma vez ou pingando (`dribble`). Devolve o status dado.
     *
     * O template que não compila ou estoura os tetos ao responder vira o erro de sempre (500, pelo `LegacyErrorAdvice`):
     * antes de relançar, a mensagem é regravada com o status desse erro no `response`, o realmente respondido. O evento
     * `request.created` já saiu com o status da regra e não é corrigido; a listagem, o `GET` e a busca trazem o 500. O 500
     * leva o `X-Request-Id` da mensagem, como as outras respostas da captura.
     */
    private fun answerByRule(
        response: HttpServletResponse,
        token: Token,
        captured: CapturedRequest,
        answer: RuleResponse,
        stopwatch: CaptureStopwatch,
    ): Int {
        answer.delay?.let { stopwatch.sleep(Duration.ofMillis(it.millis())) }
        val rendered = render(response, token, captured, answer)
        response.writeRuleResponse(token, captured, rendered, stopwatch)
        return rendered.status
    }

    private fun render(
        response: HttpServletResponse,
        token: Token,
        captured: CapturedRequest,
        answer: RuleResponse,
    ): RuleResponse {
        val input = TemplateInput(captured.toTemplateRequest(), checkNotNull(captured.seq), clock.instant(), token.signature)
        return try {
            answer.rendered(input)
        } catch (e: ResponseStatusException) {
            requests.replace(token, captured.copy(response = RecordedResponse(status = e.statusCode.value())))
            response.setHeader("X-Request-Id", captured.uuid.toString())
            throw e
        }
    }

    private fun HttpServletResponse.writeConfiguredResponse(
        token: Token,
        captured: CapturedRequest,
        status: Int,
    ) {
        this.status = status
        responseContentType(token.defaultContentType, status)?.let { contentType = it }
        setHeader("X-Request-Id", captured.uuid.toString())
        setHeader("X-Token-Id", token.uuid.toString())
        if (token.cors) CORS_HEADERS.forEach(::setHeader)
        token.retryAfter?.let { setHeader("Retry-After", it.headerValue()) }
        addCaptureSandbox()
        writeBody(token.defaultContent)
    }

    /**
     * Status, cabeçalhos e corpo da regra, sem mexer no Content-Type; identificação e CORS da URL continuam (a regra
     * sobrescreve). O [CAPTURE_SANDBOX] vem depois e a regra não o tira.
     */
    private fun HttpServletResponse.writeRuleResponse(
        token: Token,
        captured: CapturedRequest,
        answer: RuleResponse,
        stopwatch: CaptureStopwatch,
    ) {
        writeRuleHead(token, captured, answer.status, answer.headers)
        val dribble = answer.dribble
        if (dribble == null) writeBody(answer.body) else writeDribbled(answer.body, dribble, stopwatch)
    }

    private fun HttpServletResponse.writeRuleHead(
        token: Token,
        captured: CapturedRequest,
        status: Int,
        headers: Map<String, String>,
    ) {
        this.status = status
        setHeader("X-Request-Id", captured.uuid.toString())
        setHeader("X-Token-Id", token.uuid.toString())
        if (token.cors) CORS_HEADERS.forEach(::setHeader)
        headers.forEach(::setHeader)
        addCaptureSandbox()
    }

    /**
     * Status e cabeçalhos da regra, com o `Content-Length` do corpo inteiro e, no `truncated_body`, a primeira metade
     * dele; o resto é a falha na conexão.
     */
    private fun HttpServletResponse.writeStartedResponse(
        token: Token,
        captured: CapturedRequest,
        answer: RuleResponse,
        fault: Fault,
    ) {
        val body = answer.body.toByteArray(UTF_8)
        writeRuleHead(token, captured, answer.status, answer.headers)
        setContentLengthLong(body.size.toLong())
        if (fault == Fault.TRUNCATED_BODY) outputStream.write(body, 0, body.size / 2)
        flushBuffer()
    }

    /** O 503 no lugar da falha que prenderia a conexão além do teto ([limit]). */
    private fun HttpServletResponse.writeHoldRefusal(
        token: Token,
        captured: CapturedRequest,
        fault: Fault,
        limit: HoldLimit,
    ) {
        val headers = mapOf("Content-Type" to "text/plain", "X-Fault-Limit" to limit.reason)
        writeRuleHead(token, captured, HttpServletResponse.SC_SERVICE_UNAVAILABLE, headers)
        writeBody("The ${fault.value} fault was not applied: ${limit.reason}.")
    }

    /**
     * Cabeçalhos na hora e o corpo em `chunks` pedaços, cada um depois de `durationMs / chunks` e com
     * flush: sem Content-Length, o Tomcat manda chunked (HTTP/1.1).
     */
    private fun HttpServletResponse.writeDribbled(
        body: String,
        dribble: Dribble,
        stopwatch: CaptureStopwatch,
    ) {
        flushBuffer()
        if (status == HttpServletResponse.SC_NO_CONTENT || status == HttpServletResponse.SC_NOT_MODIFIED) return
        val interval = dribble.durationMs.toLong() / dribble.chunks
        dribblePieces(body.toByteArray(UTF_8), dribble.chunks).forEach { piece ->
            stopwatch.sleep(Duration.ofMillis(interval))
            outputStream.write(piece)
            outputStream.flush()
        }
    }

    private fun HttpServletResponse.writeBody(body: String) {
        if (status != HttpServletResponse.SC_NO_CONTENT && status != HttpServletResponse.SC_NOT_MODIFIED) {
            outputStream.write(body.toByteArray(UTF_8))
        }
    }
}

private fun Decision.ruleRef(): RuleRef? =
    when (this) {
        is Decision.Matched -> RuleRef(rule.id, rule.name)
        is Decision.Unmatched -> null
    }

/** A falha de rede da regra que respondeu: com ela, a conexão cai no lugar da resposta. */
private fun Decision.fault(): Fault? =
    when (this) {
        is Decision.Matched -> rule.response.fault
        is Decision.Unmatched -> null
    }

/**
 * O `response` gravado: a falha de rede da regra, o 503 quando o teto de conexões presas a barrou ([refused]), o status
 * dela (que o template não muda) ou o [defaultStatus] da URL quando nenhuma regra respondeu.
 */
private fun Decision.recordedResponse(
    defaultStatus: Int,
    refused: HoldLimit?,
): RecordedResponse =
    when (this) {
        is Decision.Matched -> {
            val fault = rule.response.fault
            when {
                refused != null -> RecordedResponse(status = HttpServletResponse.SC_SERVICE_UNAVAILABLE)
                fault != null -> RecordedResponse(fault = fault)
                else -> RecordedResponse(status = rule.response.status)
            }
        }

        is Decision.Unmatched -> {
            RecordedResponse(status = defaultStatus)
        }
    }

private fun Decision.nearMiss(): NearMiss? =
    when (this) {
        is Decision.Matched -> null
        is Decision.Unmatched -> nearMiss
    }
