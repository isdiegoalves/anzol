package anzol.e2ee

import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.http.PHP_DEFAULT_CONTENT_TYPE
import anzol.http.requireJsonObject
import anzol.http.validationFailure
import anzol.privacy.WithoutReadAccess
import anzol.rules.Parsed
import anzol.token.TokenService
import anzol.token.TokenStore
import anzol.token.findOrGone
import anzol.token.legacyNow
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.security.SecureRandom
import java.time.Clock
import java.time.format.DateTimeFormatter
import java.util.HexFormat

private const val KID_RANDOM_BYTES = 2
private val KID_DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyyMMdd")
private val random = SecureRandom()

/** O JWKS público da URL: as chaves de cifra, só a parte pública. */
data class Jwks(
    val keys: List<Map<String, Any>>,
)

/**
 * As chaves de cifra da URL: gerar (`POST /token/{id}/keys`, até [MAX_E2EE_KEYS] para a rotação), apagar e publicar
 * o JWKS. A privada nasce e fica no servidor; nenhuma rota a devolve.
 */
@RestController
@RequestMapping("/token/{tokenId:$UUID_PATTERN}")
class E2eeKeyController(
    private val tokens: TokenStore,
    private val service: TokenService,
    private val clock: Clock,
) {
    /** `{"kid"?: "..."}`; sem `kid`, `enc-<data>-<4 hex>`. 201 com a pública; 422 no `kid` inválido, repetido ou acima do teto. */
    @PostMapping("/keys")
    fun create(
        @PathVariable tokenId: TokenId,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val given = request.requireJsonObject().inputBag()["kid"]
        val kid = given ?: generatedKid()
        if (kid !is String || !KID_PATTERN.matches(kid)) {
            return request.validationFailure(
                mapOf("kid" to listOf("The kid must be 1 to 64 letters, digits, dots, underscores or dashes.")),
            )
        }
        val key = E2eeKey.generate(kid, clock.legacyNow())
        val changed =
            service.changing(tokenId) { token ->
                when {
                    token.e2eeKeys.any { it.kid == kid } -> Parsed.Invalid(mapOf("kid" to listOf("The kid is already in use on this URL.")))
                    token.e2eeKeys.size >= MAX_E2EE_KEYS -> Parsed.Invalid(TOO_MANY_KEYS)
                    else -> Parsed.Valid(token.copy(e2eeKeys = token.e2eeKeys + key))
                }
            }
        return when (changed) {
            is Parsed.Valid -> ResponseEntity.status(HttpStatus.CREATED).body(key.view())
            is Parsed.Invalid -> request.validationFailure(changed.errors)
        }
    }

    /** 204, e o `kid` entra no registro de chaves apagadas da URL; `kid` que a URL não tem: 404. */
    @DeleteMapping("/keys/{kid}")
    fun delete(
        @PathVariable tokenId: TokenId,
        @PathVariable kid: String,
    ): ResponseEntity<Unit> {
        val changed =
            service.changing(tokenId) { token ->
                if (token.e2eeKeys.none { it.kid == kid }) {
                    throw ResponseStatusException(HttpStatus.NOT_FOUND, "Key not found")
                }
                Parsed.Valid(
                    token.copy(
                        e2eeKeys = token.e2eeKeys.filterNot { it.kid == kid },
                        e2eeDeletedKeys = token.e2eeDeletedKeys.recording(kid, clock.legacyNow()),
                    ),
                )
            }
        check(changed is Parsed.Valid) { "apagar a chave não valida nada: $changed" }
        return ResponseEntity.noContent().header(HttpHeaders.CONTENT_TYPE, PHP_DEFAULT_CONTENT_TYPE).build()
    }

    /** Público, como todo JWKS: só as públicas, que o remetente precisa para cifrar. URL inexistente: 410. */
    @WithoutReadAccess
    @GetMapping("/jwks.json")
    fun jwks(
        @PathVariable tokenId: TokenId,
    ): Jwks = Jwks(tokens.findOrGone(tokenId).e2eeKeys.map { it.public().toJSONObject() })

    private fun generatedKid(): String =
        "enc-" + KID_DATE.format(clock.legacyNow()) + "-" + HexFormat.of().formatHex(ByteArray(KID_RANDOM_BYTES).also(random::nextBytes))
}

private val TOO_MANY_KEYS =
    mapOf("keys" to listOf("The URL already has $MAX_E2EE_KEYS encryption keys; delete one before creating another."))
