package anzol.token

import anzol.TokenId
import anzol.capture.RequestStore
import anzol.capture.anyDecrypted
import anzol.capture.highestSeq
import anzol.http.LegacyInput
import anzol.rules.Parsed
import anzol.share.ShareStore
import anzol.signature.MASKED_SECRET
import anzol.signature.MISSING_SECRET
import anzol.signature.SignatureConfig
import anzol.signature.SignatureDraft
import anzol.stream.RequestStream
import anzol.telemetry.AnzolTelemetry
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.server.ResponseStatusException
import java.time.Clock
import java.util.UUID

/** Cada tentativa perdida é outra gravação da mesma URL que chegou antes; esgotar é erro (500), nunca mudança perdida. */
private const val MAX_CHANGE_ATTEMPTS = 50

private val E2EE_WITHOUT_READ_SECRET = mapOf("e2ee" to listOf("The e2ee requires a read secret on this URL (read_secret)."))

private val DECRYPTED_WITHOUT_READ_SECRET =
    mapOf("read_secret" to listOf("The read secret cannot be removed while this URL has decrypted requests; delete them first."))

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
    private val shares: ShareStore,
    private val telemetry: AnzolTelemetry,
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
        val built =
            withSignature(settings.signature, current = null) { signature ->
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
                    e2ee = settings.e2ee,
                ).withReadSecret(settings.readSecret)
            }.withReadSecretForE2ee()
        if (built is Parsed.Valid) tokens.store(built.value)
        return built
    }

    /**
     * Validação antes da busca: token inexistente com dado inválido responde 422, como no app antigo.
     * Limite menor corta as mensagens excedentes na hora. Assinatura sem segredo novo mantém o atual; sem
     * nenhum, 422. Trocar o segredo de leitura (definir, trocar, remover) fecha o SSE e as esperas abertas — quem
     * voltar passa de novo pelo acesso, com o segredo novo (o cookie antigo deixou de valer) — e revoga todos os
     * links só-leitura da URL: quem troca o segredo quer cortar quem tinha acesso, e um link é acesso.
     *
     * O que o `PUT` mantém (cors, segredo de assinatura omitido, segredo de leitura) sai do token lido, e a gravação
     * só vale se ninguém gravou a URL desde a leitura ([changing]).
     */
    fun update(
        id: TokenId,
        input: LegacyInput,
    ): Parsed<Token> {
        val errors = input.validateTokenSettings()
        return if (errors.isNotEmpty()) Parsed.Invalid(errors) else changing(id) { changed(it, input) }
    }

    /**
     * Muda só parte da configuração (o `update_url` do MCP): [body] monta o corpo do `PUT` a partir do token de agora.
     * Duas mudanças simultâneas de campos diferentes ficam as duas. A validação e os efeitos são os de [update].
     */
    fun patch(
        id: TokenId,
        body: (Token) -> LegacyInput,
    ): Parsed<Token> = changing(id) { changed(it, body(it)) }

    /** Liga e desliga o CORS da URL. O app antigo só ligava (`isset` em atributo mágico); o contrato exige o toggle real. */
    fun toggleCors(id: TokenId): Token =
        when (val toggled = changing(id) { Parsed.Valid(it.copy(cors = !it.cors)) }) {
            is Parsed.Valid -> toggled.value
            is Parsed.Invalid -> error("toggle do CORS não valida nada: ${toggled.errors}")
        }

    /**
     * Toda mudança de uma URL que existe: lê o token, calcula o novo com [change] e grava só se o que está no Redis
     * ainda é o que foi lido ([TokenStore.replace]); se outra gravação chegou antes, relê e calcula de novo. Nenhuma
     * mudança simultânea se perde nem se mistura com um token velho, também entre instâncias. URL inexistente: 410.
     */
    fun changing(
        id: TokenId,
        change: (Token) -> Parsed<Token>,
    ): Parsed<Token> {
        repeat(MAX_CHANGE_ATTEMPTS) {
            val read = tokens.read(id) ?: throw ResponseStatusException(HttpStatus.GONE, "Token not found")
            // Antes de [change], que confere as mensagens: o que chegar depois a troca confere no Redis.
            val since = if (read.token.isProtected()) requests.highestSeq(read.token) else null
            val changed = change(read.token)
            if (changed !is Parsed.Valid) return changed
            val removesSecret = since != null && !changed.value.isProtected()
            if (tokens.replace(read, changed.value, decryptedAfter = since.takeIf { removesSecret })) {
                applied(read.token, changed.value)
                return changed
            }
        }
        error("token $id changed on $MAX_CHANGE_ATTEMPTS attempts in a row")
    }

    /** [current] com a configuração de [input], validada e com a assinatura resolvida; nada é gravado. */
    private fun changed(
        current: Token,
        input: LegacyInput,
    ): Parsed<Token> {
        val errors = input.validateTokenSettings()
        if (errors.isNotEmpty()) return Parsed.Invalid(errors)
        val settings = input.toTokenSettings()
        return withSignature(settings.signature, current.signature) { current.changed(settings, it) }
            .withReadSecretForE2ee()
            .withReadSecretForDecrypted(current, requests)
    }

    /** A decifra sem segredo de leitura deixaria o texto aberto à vista de quem tem a URL: 422 em `e2ee`. */
    private fun Parsed<Token>.withReadSecretForE2ee(): Parsed<Token> =
        if (this is Parsed.Valid && value.e2ee != null && !value.isProtected()) Parsed.Invalid(E2EE_WITHOUT_READ_SECRET) else this

    private fun Token.changed(
        settings: TokenSettings,
        signature: SignatureConfig?,
    ): Token = withSettings(settings, signature).withReadSecret(settings.readSecret)

    /** Depois de gravar: o limite menor corta as mensagens excedentes, e o segredo de leitura trocado corta os acessos. */
    private fun applied(
        current: Token,
        updated: Token,
    ) {
        telemetry.cleanupRemoved(requests.trim(updated).size)
        if (updated.secretVersion != current.secretVersion) {
            shares.revokeAll(updated.uuid)
            stream.disconnect(updated.uuid)
        }
    }

    /** Apagar encerra as esperas do `requests/wait` na URL, com o que já tiverem. */
    fun delete(id: TokenId) {
        tokens.delete(tokens.findOrGone(id))
        stream.end(id)
    }

    /**
     * [build] com a assinatura resolvida contra a atual, ou o 422: o segredo enviado é uma máscara que não é a do atual,
     * ou não há segredo novo nem atual.
     */
    private fun withSignature(
        draft: SignatureDraft?,
        current: SignatureConfig?,
        build: (SignatureConfig?) -> Token,
    ): Parsed<Token> {
        val resolved = draft?.resolve(current)
        return when {
            draft != null && draft.hasForeignMask(current) -> Parsed.Invalid(MASKED_SECRET)
            draft != null && resolved == null -> Parsed.Invalid(MISSING_SECRET)
            else -> Parsed.Valid(build(resolved))
        }
    }
}

/**
 * O atributo decifrado fica gravado na mensagem: sem o segredo, sairia para quem só tem a URL, também com a decifra
 * desligada. Enquanto houver um, 422 em `read_secret`.
 */
private fun Parsed<Token>.withReadSecretForDecrypted(
    current: Token,
    requests: RequestStore,
): Parsed<Token> {
    val removesSecret = this is Parsed.Valid && current.isProtected() && !value.isProtected()
    return if (removesSecret && requests.anyDecrypted(current)) Parsed.Invalid(DECRYPTED_WITHOUT_READ_SECRET) else this
}
