package site.webhook.share

import com.fasterxml.jackson.annotation.JsonFormat
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController
import site.webhook.RequestId
import site.webhook.TIMESTAMP_PATTERN
import site.webhook.TokenId
import site.webhook.UUID_PATTERN
import site.webhook.capture.RequestStore
import site.webhook.capture.findOrNotFound
import site.webhook.http.PHP_DEFAULT_CONTENT_TYPE
import site.webhook.http.legacyInput
import site.webhook.rules.Parsed
import site.webhook.telemetry.WebhookTelemetry
import site.webhook.token.Token
import site.webhook.token.TokenStore
import site.webhook.token.findOrGone
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/** O 404 do link público: igual para id inexistente, expirado, revogado, URL apagada e mensagem apagada. */
const val SHARE_NOT_FOUND_BODY = """{"error":"This shared link does not exist or has expired"}"""

private const val HEX = 16

private val TIMESTAMP: DateTimeFormatter = DateTimeFormatter.ofPattern(TIMESTAMP_PATTERN)

/** O que o `POST .../share` pede, já validado. */
data class ShareRequest(
    val expiry: ShareExpiry,
    val redact: Boolean,
)

/** Resposta do `POST .../share`. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class CreatedShare(
    val id: String,
    val url: String,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val expiresAt: LocalDateTime,
    val redact: Boolean,
)

/** Um link ativo, no `GET /token/{id}/shares`. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class ShareSummary(
    val id: String,
    val url: String,
    val requestId: RequestId,
    val redact: Boolean,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val createdAt: LocalDateTime,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val expiresAt: LocalDateTime,
)

/**
 * O [uuid] como aparece em qualquer texto: cada caractere é ele mesmo ou `%hh` (o byte em hexadecimal), sem diferenciar
 * maiúsculas. Casa só dígitos hexadecimais, `-` e `%`, que o JSON nunca escapa: trocar no JSON serializado não o quebra.
 */
fun uuidPattern(uuid: String): Regex =
    Regex(
        uuid.lowercase().asIterable().joinToString("") { c ->
            val encoded = c.code.toString(HEX).padStart(2, '0')
            "(?:${Regex.escape(c.toString())}|%$encoded)"
        },
        RegexOption.IGNORE_CASE,
    )

/** O endereço do link na tela (rota do Angular). */
fun shareUrl(id: String): String = "/#/share/$id"

/**
 * `{"expires_in": "1h"|"1d"|"7d"|"30d", "redact": bool}`; ausente ou nulo usa o padrão (7d, mascarar). Outro valor: 422
 * com as mensagens do Laravel.
 */
fun parseShareRequest(body: Map<String, Any?>): Parsed<ShareRequest> {
    val expiresIn = body["expires_in"]
    val redact = body["redact"]
    val errors =
        buildMap {
            if (expiresIn != null && ShareExpiry.of(expiresIn) == null) put("expires_in", listOf("The selected expires in is invalid."))
            if (redact != null && redact !is Boolean) put("redact", listOf("The redact field must be true or false."))
        }
    if (errors.isNotEmpty()) return Parsed.Invalid(errors)
    return Parsed.Valid(ShareRequest(expiry = ShareExpiry.of(expiresIn) ?: ShareExpiry.WEEK, redact = redact as? Boolean ?: true))
}

/**
 * Links só-leitura de UMA mensagem. As rotas de gestão ficam em `/token/{id}/...` (com o controle de acesso da URL);
 * o link público `GET /share/{id}` não pede acesso nenhum: quem tem o link lê a mensagem até expirar ou ser revogado.
 */
@RestController
class ShareController(
    private val tokens: TokenStore,
    private val requests: RequestStore,
    private val shares: ShareStore,
    private val jsonMapper: JsonMapper,
    private val telemetry: WebhookTelemetry,
) {
    /** 201 com o link; 410 sem a URL, 404 sem a mensagem, 422 de validação ou com [MAX_ACTIVE_SHARES] ativos. */
    @PostMapping("/token/{tokenId:$UUID_PATTERN}/request/{requestId:$UUID_PATTERN}/share")
    fun create(
        @PathVariable tokenId: TokenId,
        @PathVariable requestId: RequestId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val token = tokens.findOrGone(tokenId)
        requests.findOrNotFound(token, requestId)
        return when (val parsed = parseShareRequest(request.legacyInput().inputBag())) {
            is Parsed.Valid -> create(token, requestId, parsed.value)
            is Parsed.Invalid -> unprocessable(parsed.errors)
        }
    }

    private fun create(
        token: Token,
        requestId: RequestId,
        input: ShareRequest,
    ): ResponseEntity<Any> {
        val share =
            shares.create(token.uuid, token.secretVersion, requestId, input.expiry, input.redact)
                ?: return unprocessable(mapOf("shares" to listOf("A URL can have at most $MAX_ACTIVE_SHARES active shared links.")))
        telemetry.share("create")
        return ResponseEntity.status(HttpStatus.CREATED).body(CreatedShare(share.id, shareUrl(share.id), share.expiresAt, share.redact))
    }

    @GetMapping("/token/{tokenId:$UUID_PATTERN}/shares")
    fun list(
        @PathVariable tokenId: TokenId,
    ): List<ShareSummary> =
        shares.active(tokens.findOrGone(tokenId).uuid).map {
            ShareSummary(it.id, shareUrl(it.id), it.requestId, it.redact, it.createdAt, it.expiresAt)
        }

    /** 204; 404 quando o link não existe, já expirou ou é de outra URL. */
    @DeleteMapping("/token/{tokenId:$UUID_PATTERN}/shares/{shareId}")
    fun revoke(
        @PathVariable tokenId: TokenId,
        @PathVariable shareId: String,
    ): ResponseEntity<Any> {
        tokens.findOrGone(tokenId)
        if (!shares.revoke(tokenId, shareId)) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).contentType(MediaType.APPLICATION_JSON).body(SHARE_NOT_FOUND_BODY)
        }
        telemetry.share("revoke")
        return ResponseEntity.noContent().header(HttpHeaders.CONTENT_TYPE, PHP_DEFAULT_CONTENT_TYPE).build()
    }

    /**
     * O link público: a mensagem como `GET /token/{id}/request/{rid}` a devolve (mascarada se o link pediu), mais
     * `shared_at` e `expires_at`, **sempre sem o UUID da URL** (com ou sem máscara): sem `token_id`, e com toda ocorrência
     * do UUID no JSON inteiro — `url`, cabeçalhos (`referer`), query, `request` e o corpo (o ping do GitHub traz a própria
     * URL) — trocada por [REDACTED], também escrita com maiúsculas ou com caracteres em `%hh`. O UUID é do servidor, não
     * dado do remetente: só ele sai do corpo. O link é de UMA mensagem; com o UUID, quem o tem enviaria à URL e, numa URL
     * aberta, leria tudo. Link de outra `secret_version` (a URL trocou o segredo depois dele) e qualquer ausência dão o
     * mesmo 404, para que o link não diga o que aconteceu.
     */
    @GetMapping("/share/{shareId}")
    fun view(
        @PathVariable shareId: String,
    ): ResponseEntity<Any> {
        val share = shares.find(shareId)
        val token = share?.let { found -> tokens.find(found.tokenId)?.takeIf { it.secretVersion == found.secretVersion } }
        val message = if (share != null && token != null) requests.find(token, share.requestId) else null
        if (share == null || token == null || message == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).contentType(MediaType.APPLICATION_JSON).body(SHARE_NOT_FOUND_BODY)
        }
        val masked = if (share.redact) message.redacted(token.signature) else message
        val tree =
            jsonMapper.valueToTree<ObjectNode>(masked).apply {
                remove("token_id")
                put("shared_at", share.createdAt.format(TIMESTAMP))
                put("expires_at", share.expiresAt.format(TIMESTAMP))
            }
        val body = uuidPattern(token.uuid.toString()).replace(jsonMapper.writeValueAsString(tree), REDACTED)
        telemetry.share("view")
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(body)
    }

    private fun unprocessable(errors: Map<String, List<String>>): ResponseEntity<Any> =
        ResponseEntity.unprocessableContent().contentType(MediaType.APPLICATION_JSON).body(errors)
}
