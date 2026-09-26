package site.webhook.capture

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestMethod
import org.springframework.web.bind.annotation.RestController
import site.webhook.STATUS_IN_PATH
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.http.PHP_DEFAULT_CONTENT_TYPE
import site.webhook.http.clientConnection
import site.webhook.http.rawPath
import site.webhook.legacy.phpIntval
import site.webhook.legacy.urlDecode
import site.webhook.rules.Decision
import site.webhook.rules.Dribble
import site.webhook.rules.Fault
import site.webhook.rules.NearMiss
import site.webhook.rules.RuleRef
import site.webhook.rules.RuleResponse
import site.webhook.rules.RuleStore
import site.webhook.rules.ScenarioStore
import site.webhook.rules.TemplateInput
import site.webhook.rules.dribblePieces
import site.webhook.rules.rendered
import site.webhook.rules.toMatchInput
import site.webhook.rules.toTemplateRequest
import site.webhook.stream.RequestStream
import site.webhook.telemetry.CaptureOutcome
import site.webhook.telemetry.CaptureStopwatch
import site.webhook.telemetry.WebhookTelemetry
import site.webhook.token.Token
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import site.webhook.token.headerValue
import site.webhook.token.toLegacyDateTime
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

// Cada dependência é um passo da captura (token, mensagens, regras, cenários, hora, tempo real e métricas);
// agrupá-las só para caber no limite criaria um tipo sem outro uso.
@Suppress("LongParameterList")
@RestController
class WebhookController(
    private val tokens: TokenStore,
    private val requests: RequestStore,
    private val rules: RuleStore,
    private val scenarios: ScenarioStore,
    private val clock: Clock,
    private val stream: RequestStream,
    private val telemetry: WebhookTelemetry,
) {
    /**
     * `any {tokenId}/{statusCode?}` e `any {tokenId}/{any}` de `routes.php`. A primeira regra ativa que
     * casa responde (e muda o estado do cenário dela, junto com a escolha); sem ela, a resposta padrão da
     * URL de sempre (`default_*`, `timeout`, `retry_after` e o status pelo caminho). A mensagem grava qual
     * regra respondeu, ou a mais próxima. Cada captura respondida conta nas métricas de negócio, com o tempo
     * gasto pelo app (sem as esperas programadas).
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
        val received = request.toCapturedRequest(tokenId, clock.instant(), token.signature, token.schema)
        val decision = scenarios.decide(tokenId, rules.find(tokenId), received.toMatchInput())
        if (decision is Decision.Unmatched && token.timeout > 0) stopwatch.sleep(Duration.ofSeconds(token.timeout))
        val arrival = clock.instant()
        val captured =
            received.copy(
                createdAt = arrival.toLegacyDateTime(),
                updatedAt = arrival.toLegacyDateTime(),
                rule = decision.ruleRef(),
                nearMiss = decision.nearMiss(),
            )
        val stored = requests.store(token, captured, arrival)
        telemetry.cleanupRemoved(stored.removed.size)
        stream.publish(captured.copy(seq = stored.seq), stored.removed) { requests.count(token) }
        val fault = decision.fault()
        // Status dado ao cliente; nulo quando a falha de rede da regra derrubou a conexão (nada mais vale).
        val status =
            when (decision) {
                is Decision.Matched -> {
                    if (fault != null) {
                        request.clientConnection().fail(fault, captured)
                        null
                    } else {
                        answerByRule(response, token, captured.copy(seq = stored.seq), decision.rule.response, stopwatch)
                    }
                }

                is Decision.Unmatched -> {
                    responseStatus(request.secondSegment(), token.defaultStatus).also {
                        response.writeConfiguredResponse(token, captured, it)
                    }
                }
            }
        val outcome =
            CaptureOutcome(
                method = request.method,
                status = status,
                ruleMatched = decision is Decision.Matched,
                signature = captured.signature?.state(),
                schema = captured.schema?.state(),
                fault = fault,
            )
        telemetry.captured(request, tokenId, outcome, stopwatch.elapsed())
    }

    /**
     * Resposta da regra sem `fault`: espera o `delay` (a mensagem já está gravada; a thread da requisição é
     * virtual) e responde, com o corpo de uma vez ou pingando (`dribble`). Devolve o status dado.
     */
    private fun answerByRule(
        response: HttpServletResponse,
        token: Token,
        captured: CapturedRequest,
        answer: RuleResponse,
        stopwatch: CaptureStopwatch,
    ): Int {
        answer.delay?.let { stopwatch.sleep(Duration.ofMillis(it.millis())) }
        val input = TemplateInput(captured.toTemplateRequest(), checkNotNull(captured.seq), clock.instant())
        val rendered = answer.rendered(input)
        response.writeRuleResponse(token, captured, rendered, stopwatch)
        return rendered.status
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
        addHeader(CSP_HEADER, CAPTURE_SANDBOX)
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
        status = answer.status
        setHeader("X-Request-Id", captured.uuid.toString())
        setHeader("X-Token-Id", token.uuid.toString())
        if (token.cors) CORS_HEADERS.forEach(::setHeader)
        answer.headers.forEach(::setHeader)
        addHeader(CSP_HEADER, CAPTURE_SANDBOX)
        val dribble = answer.dribble
        if (dribble == null) writeBody(answer.body) else writeDribbled(answer.body, dribble, stopwatch)
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

private fun Decision.nearMiss(): NearMiss? =
    when (this) {
        is Decision.Matched -> null
        is Decision.Unmatched -> nearMiss
    }
