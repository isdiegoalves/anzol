package site.webhook.token

import org.springframework.stereotype.Component
import site.webhook.TokenId
import site.webhook.capture.RequestStore
import site.webhook.http.LegacyInput
import site.webhook.rules.Parsed
import site.webhook.signature.MISSING_SECRET
import site.webhook.signature.SignatureConfig
import site.webhook.signature.SignatureDraft
import site.webhook.stream.RequestStream
import site.webhook.telemetry.WebhookTelemetry
import java.time.Clock
import java.util.UUID

/**
 * Criar, editar e apagar a URL, com a validação do `POST`/`PUT /token`: o que a API HTTP e as ferramentas do MCP
 * fazem igual. O token volta como está no Redis; quem o devolve ao cliente mascara o segredo ([Token.forApi]).
 */
@Component
class TokenService(
    private val tokens: TokenStore,
    private val requests: RequestStore,
    private val clock: Clock,
    private val stream: RequestStream,
    private val telemetry: WebhookTelemetry,
) {
    fun create(
        input: LegacyInput,
        ip: String?,
        userAgent: String?,
    ): Parsed<Token> {
        val errors = input.validateTokenSettings()
        if (errors.isNotEmpty()) return Parsed.Invalid(errors)
        val now = clock.legacyNow()
        val settings = input.toTokenSettings()
        return withSignature(settings.signature, current = null) { signature ->
            tokens.store(
                Token(
                    uuid = TokenId(UUID.randomUUID()),
                    ip = ip,
                    userAgent = userAgent,
                    defaultContent = settings.defaultContent,
                    defaultStatus = settings.defaultStatus,
                    defaultContentType = settings.defaultContentType,
                    timeout = settings.timeout,
                    cors = false,
                    createdAt = now,
                    updatedAt = now,
                    retryAfter = settings.retryAfter,
                    autoCleanup = settings.autoCleanup,
                    signature = signature,
                    schema = settings.schema,
                ).withReadSecret(settings.readSecret),
            )
        }
    }

    /**
     * Validação antes da busca: token inexistente com dado inválido responde 422, como no app antigo.
     * Limite menor corta as mensagens excedentes na hora. Assinatura sem segredo novo mantém o atual; sem
     * nenhum, 422. Trocar o segredo de leitura fecha o SSE e as esperas abertas: quem voltar passa de novo pelo
     * acesso, com o segredo novo (o cookie antigo deixou de valer).
     */
    fun update(
        id: TokenId,
        input: LegacyInput,
    ): Parsed<Token> {
        val errors = input.validateTokenSettings()
        if (errors.isNotEmpty()) return Parsed.Invalid(errors)
        val current = tokens.findOrGone(id)
        val settings = input.toTokenSettings()
        return withSignature(settings.signature, current.signature) { signature ->
            val updated = tokens.store(current.withSettings(settings, signature).withReadSecret(settings.readSecret))
            telemetry.cleanupRemoved(requests.trim(updated).size)
            if (updated.secretVersion != current.secretVersion) stream.disconnect(id)
            updated
        }
    }

    /** Apagar encerra as esperas do `requests/wait` na URL, com o que já tiverem. */
    fun delete(id: TokenId) {
        tokens.delete(tokens.findOrGone(id))
        stream.end(id)
    }

    /** [save] com a assinatura resolvida contra a atual, ou o 422 quando não há segredo novo nem atual. */
    private fun withSignature(
        draft: SignatureDraft?,
        current: SignatureConfig?,
        save: (SignatureConfig?) -> Token,
    ): Parsed<Token> {
        val resolved = draft?.resolve(current)
        return if (draft != null && resolved == null) Parsed.Invalid(MISSING_SECRET) else Parsed.Valid(save(resolved))
    }
}
