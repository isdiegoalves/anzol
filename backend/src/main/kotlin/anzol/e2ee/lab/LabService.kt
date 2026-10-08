package anzol.e2ee.lab

import anzol.RedisKeys
import anzol.TokenId
import anzol.e2ee.E2eeKey
import anzol.e2ee.E2eePolicy
import anzol.e2ee.readE2ee
import anzol.rules.HEADER_NAME
import anzol.rules.Parsed
import anzol.rules.Rule
import anzol.rules.RuleStore
import anzol.rules.bodyMapper
import anzol.rules.parseRules
import anzol.share.newShareId
import anzol.signature.HmacAlgorithm
import anzol.signature.Secret
import anzol.signature.SignatureConfig
import anzol.signature.SignatureEncoding
import anzol.signature.SignatureProvider
import anzol.token.ReadSecretChange
import anzol.token.Token
import anzol.token.TokenStore
import anzol.token.TokenView
import anzol.token.toLegacyDateTime
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.gen.ECKeyGenerator
import org.springframework.core.io.ClassPathResource
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.data.redis.core.script.RedisScript
import org.springframework.stereotype.Component
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Clock
import java.time.ZoneOffset
import java.util.UUID

private val SLOT =
    RedisScript.of(ClassPathResource("redis/e2ee-lab-slot.lua").getContentAsString(UTF_8), Long::class.javaObjectType)

const val LAB_SIGNER_KID = "lab-sig-1"
const val LAB_STATUS = 202L
private const val DEFAULT_HMAC_HEADER = "X-Signature"
private val LAB_ENCRYPTION_KIDS = listOf("enc-v1", "enc-v2")

/** Caminho que o gerador de cenários sabe escrever: `$.a.b`, só nomes. */
private val SIMPLE_PATH = Regex("\\$(\\.[A-Za-z_][A-Za-z0-9_]*)+")

/** A política padrão do laboratório: o envelope neutro dos testes, com o `app` comparado sem caixa. */
private val DEFAULT_POLICY: Map<String, Any?> =
    linkedMapOf(
        "path" to "$.payload",
        "audience" to "anzol-lab",
        "bindings" to
            linkedMapOf(
                "jti" to "$.eventId",
                "evt" to "$.tipoEvento.nome",
                "app" to linkedMapOf("path" to "$.servico.nome", "ignore_case" to true),
            ),
    )

/** As respostas do laboratório: HMAC 401, `kid` desconhecido 500, outra falha da decifra 400; o resto, o padrão 202. */
private const val LAB_RULES =
    """[{"name":"HMAC invalid","priority":1,"match":{"signature":"invalid"},"response":{"status":401}},""" +
        """{"name":"HMAC absent","priority":1,"match":{"signature":"absent"},"response":{"status":401}},""" +
        """{"name":"Unknown kid","priority":2,"match":{"decryption":"unknown_kid"},"response":{"status":500}},""" +
        """{"name":"Decryption failed","priority":3,"match":{"decryption":"invalid"},"response":{"status":400}}]"""

/** A URL de laboratório criada: o token como a API o devolve e os dois segredos, mostrados só aqui. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class LabCreated(
    val token: TokenView,
    val readSecret: String,
    val hmacSecret: String,
    val hmacHeader: String,
    val jwks: Map<String, Any>,
)

/**
 * Cria URLs de laboratório E2EE prontas: segredo de leitura e de HMAC gerados, as chaves de cifra `enc-v1` e `enc-v2`,
 * o remetente de teste [LAB_SIGNER_KID] (a privada fica só no Redis da URL), a política e as regras do laboratório.
 * Só cria URL nova: nada aqui muda a política de uma URL que já existe.
 */
@Component
class LabService(
    private val tokens: TokenStore,
    private val rules: RuleStore,
    private val redis: StringRedisTemplate,
    private val clock: Clock,
) {
    /**
     * [input] é `{hmac_header?, path?, bindings?, audience?, max_age_seconds?, trusted_signers?}`; os signatários
     * dados entram antes do remetente de teste. Erros com a chave do campo; acima de [MAX_ACTIVE_LABS] ativas, 422 em
     * `lab`.
     */
    fun create(
        input: Map<String, Any?>,
        ip: String?,
        userAgent: String?,
    ): Parsed<LabCreated> {
        val signer = ECKeyGenerator(Curve.P_256).keyID(LAB_SIGNER_KID).generate()
        return when (val parsed = parse(input, signer.toPublicJWK().toJSONObject())) {
            is Parsed.Valid -> {
                created(
                    parsed.value.first,
                    parsed.value.second,
                    LabMark(signer, clock.instant().plus(LAB_LIFETIME).toLegacyDateTime()),
                    ip,
                    userAgent,
                )
            }

            is Parsed.Invalid -> {
                parsed
            }
        }
    }

    /** Reserva a vaga e grava a URL; sem vaga, 422 em `lab`. */
    private fun created(
        header: String,
        policy: E2eePolicy,
        mark: LabMark,
        ip: String?,
        userAgent: String?,
    ): Parsed<LabCreated> {
        val now = clock.instant()
        val uuid = TokenId(UUID.randomUUID())
        val slot =
            redis.execute(
                SLOT,
                listOf(RedisKeys.LABS),
                now.toEpochMilli().toString(),
                mark.expiresAt
                    .toInstant(ZoneOffset.UTC)
                    .toEpochMilli()
                    .toString(),
                uuid.toString(),
                MAX_ACTIVE_LABS.toString(),
            )
        if (slot !=
            1L
        ) {
            return Parsed.Invalid(mapOf("lab" to listOf("There are already $MAX_ACTIVE_LABS active lab URLs; delete one or wait.")))
        }
        val readSecret = newShareId()
        val hmacSecret = newShareId()
        val token =
            Token(
                uuid = uuid,
                ip = ip,
                userAgent = userAgent,
                defaultContent = "",
                defaultStatus = LAB_STATUS,
                defaultContentType = "text/plain",
                timeout = 0,
                createdAt = now.toLegacyDateTime(),
                updatedAt = now.toLegacyDateTime(),
                signature =
                    SignatureConfig(
                        SignatureProvider.Generic(header, HmacAlgorithm.SHA256, SignatureEncoding.HEX, null),
                        Secret(hmacSecret),
                    ),
                e2ee = policy,
                e2eeKeys = LAB_ENCRYPTION_KIDS.map { E2eeKey.generate(it, now.toLegacyDateTime()) },
                lab = mark,
            ).withReadSecret(ReadSecretChange.Set(readSecret))
        tokens.store(token)
        rules.store(uuid, labRules())
        val jwks = mapOf("keys" to token.e2eeKeys.map { it.public().toJSONObject() })
        return Parsed.Valid(LabCreated(token.forApi(), readSecret, hmacSecret, header, jwks))
    }

    /** O cabeçalho do HMAC e a política, com os erros sob o nome do campo (sem o prefixo `e2ee.`). */
    private fun parse(
        input: Map<String, Any?>,
        signer: Map<String, Any>,
    ): Parsed<Pair<String, E2eePolicy>> {
        val header = input["hmac_header"] ?: DEFAULT_HMAC_HEADER
        val headerError = if (header is String && HEADER_NAME.matches(header)) null else "The hmac header is invalid."
        val extra = (input["trusted_signers"] as? List<*>).orEmpty()
        val chosen = DEFAULT_POLICY + input.filterKeys { it in POLICY_FIELDS && input[it] != null }
        val policy = readE2ee(chosen + ("trusted_signers" to extra + listOf(signer)))
        val errors =
            (if (policy is Parsed.Invalid) policy.errors.mapKeys { it.key.removePrefix("e2ee.") } else emptyMap()) +
                listOfNotNull(headerError?.let { "hmac_header" to listOf(it) }) +
                pathErrors(chosen)
        return if (errors.isEmpty() && policy is Parsed.Valid) Parsed.Valid(header as String to policy.value) else Parsed.Invalid(errors)
    }

    /** Os caminhos pedidos que o gerador não sabe escrever (só `$.a.b`); confere o que veio, válido ou não. */
    private fun pathErrors(chosen: Map<String, Any?>): Map<String, List<String>> {
        val bindings = chosen["bindings"] as? Map<*, *>
        val paths =
            mapOf("path" to chosen["path"]) +
                listOf("jti", "evt", "app").associate { name ->
                    val binding = bindings?.get(name)
                    "bindings.$name" to ((binding as? Map<*, *>)?.get("path") ?: binding)
                }
        return paths
            .filterValues { it is String && !SIMPLE_PATH.matches(it) }
            .mapValues { (key, _) -> listOf("The $key must be a simple path like \$.a.b in a lab URL.") }
    }

    private fun labRules(): List<Rule> =
        when (val parsed = parseRules(bodyMapper.readTree(LAB_RULES))) {
            is Parsed.Valid -> parsed.value
            is Parsed.Invalid -> error("regras do laboratório inválidas: ${parsed.errors}")
        }
}

private val POLICY_FIELDS = setOf("path", "bindings", "audience", "max_age_seconds")
