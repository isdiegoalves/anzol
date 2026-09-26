package site.webhook.signature

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonValue
import site.webhook.rules.Parsed

/** O que o GET mostra no lugar do segredo, antes dos últimos caracteres. */
const val SECRET_MASK = "••••"
private const val VISIBLE_SECRET_CHARS = 4

/**
 * Segredo HMAC da URL. Vai inteiro só ao Redis (para verificar); [toString] mascara, para que nenhum
 * log o mostre por acidente, e a API devolve [masked].
 */
@JvmInline
value class Secret(
    val value: String,
) {
    /** `••••` e os 4 últimos; nunca mais que a metade, para que um segredo curto não saia inteiro. */
    fun masked(): String = SECRET_MASK + value.takeLast(minOf(VISIBLE_SECRET_CHARS, value.length / 2))

    override fun toString(): String = masked()

    fun bytes(): ByteArray = value.toByteArray(Charsets.UTF_8)
}

/** Algoritmo do provedor genérico; [id] é o valor no JSON e [jca] o nome do `Mac`. */
enum class HmacAlgorithm(
    val id: String,
    val jca: String,
) {
    SHA1("sha1", "HmacSHA1"),
    SHA256("sha256", "HmacSHA256"),
    SHA512("sha512", "HmacSHA512"),
}

/** Como o provedor genérico escreve a assinatura no cabeçalho. */
enum class SignatureEncoding(
    val id: String,
) {
    HEX("hex"),
    BASE64("base64"),
}

/** Os cinco provedores da §1: cabeçalho, conteúdo assinado e formato de cada um estão em [verify]. */
sealed interface SignatureProvider {
    data class Stripe(
        val toleranceSeconds: Long,
    ) : SignatureProvider

    data object GitHub : SignatureProvider

    data object Shopify : SignatureProvider

    data class Slack(
        val toleranceSeconds: Long,
    ) : SignatureProvider

    data class Generic(
        val header: String,
        val algorithm: HmacAlgorithm,
        val encoding: SignatureEncoding,
        val prefix: String?,
    ) : SignatureProvider

    /** O nome no JSON (`provider`) e no resultado gravado na mensagem. */
    fun id(): String =
        when (this) {
            is Stripe -> "stripe"
            GitHub -> "github"
            Shopify -> "shopify"
            is Slack -> "slack"
            is Generic -> "generic"
        }

    /** Os campos próprios do provedor, depois de `provider` e `secret`. */
    fun settings(): Map<String, Any> =
        when (this) {
            is Stripe -> {
                mapOf("toleranceSeconds" to toleranceSeconds)
            }

            GitHub, Shopify -> {
                emptyMap()
            }

            is Slack -> {
                mapOf("toleranceSeconds" to toleranceSeconds)
            }

            is Generic -> {
                listOfNotNull(
                    "header" to header,
                    "algorithm" to algorithm.id,
                    "encoding" to encoding.id,
                    prefix?.let {
                        "prefix" to
                            it
                    },
                ).toMap()
            }
        }
}

/**
 * `signature` do token: o provedor e o segredo. No JSON é um objeto só,
 * `{provider, secret, header?, algorithm?, encoding?, prefix?, toleranceSeconds?}`, com os padrões preenchidos.
 */
data class SignatureConfig(
    val provider: SignatureProvider,
    val secret: Secret,
) {
    @JsonValue
    fun toJson(): Map<String, Any> = linkedMapOf<String, Any>("provider" to provider.id(), "secret" to secret.value) + provider.settings()

    /** A configuração como a API a devolve: o segredo no lugar vira a máscara. */
    fun masked(): SignatureConfig = copy(secret = Secret(secret.masked()))

    companion object {
        /** Lê o JSON gravado no Redis, com a mesma leitura da API. */
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun fromJson(value: Map<String, Any?>): SignatureConfig {
            val draft =
                when (val parsed = readSignature(value)) {
                    is Parsed.Valid -> parsed.value
                    is Parsed.Invalid -> null
                }
            val secret = draft?.secret
            require(draft != null && secret != null) { "signature inválida no Redis: ${draft?.provider}" }
            return SignatureConfig(draft.provider, Secret(secret))
        }
    }
}
