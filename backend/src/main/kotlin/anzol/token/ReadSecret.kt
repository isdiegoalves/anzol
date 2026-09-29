package anzol.token

import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** O único algoritmo gravado hoje; outro valor no Redis nunca confere. */
const val PBKDF2 = "PBKDF2WithHmacSHA256"

/** Iterações do PBKDF2-HMAC-SHA256 (mínimo da OWASP para ele em 2023). Ficam gravadas: subir o número não invalida os antigos. */
const val PBKDF2_ITERATIONS = 210_000

private const val SALT_BYTES = 16
private const val HASH_BITS = 256

private val random = SecureRandom()

/**
 * O segredo de leitura da URL como fica em `token:{uuid}` (`read_secret_hash`): PBKDF2 com sal aleatório. O texto do
 * segredo nunca é gravado, nem devolvido; [toString] não mostra nem o hash.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class ReadSecretHash(
    val algorithm: String,
    val iterations: Int,
    val salt: String,
    val hash: String,
) {
    /** Recalcula o PBKDF2 com o sal e as iterações gravados e compara em tempo constante. */
    fun matches(secret: String): Boolean {
        if (algorithm != PBKDF2) return false
        val expected = Base64.getDecoder().decode(hash)
        val actual = pbkdf2(secret, Base64.getDecoder().decode(salt), iterations, expected.size * Byte.SIZE_BITS)
        return MessageDigest.isEqual(expected, actual)
    }

    override fun toString(): String = "ReadSecretHash($algorithm)"

    companion object {
        fun of(secret: String): ReadSecretHash {
            val salt = ByteArray(SALT_BYTES).also(random::nextBytes)
            val encoder = Base64.getEncoder()
            return ReadSecretHash(
                algorithm = PBKDF2,
                iterations = PBKDF2_ITERATIONS,
                salt = encoder.encodeToString(salt),
                hash = encoder.encodeToString(pbkdf2(secret, salt, PBKDF2_ITERATIONS, HASH_BITS)),
            )
        }
    }
}

private fun pbkdf2(
    secret: String,
    salt: ByteArray,
    iterations: Int,
    bits: Int,
): ByteArray {
    val spec = PBEKeySpec(secret.toCharArray(), salt, iterations, bits)
    return try {
        SecretKeyFactory.getInstance(PBKDF2).generateSecret(spec).encoded
    } finally {
        spec.clearPassword()
    }
}

/**
 * O que o `POST`/`PUT /token` pede para o segredo de leitura. No `PUT`, ausente mantém (apagar a proteção por omissão
 * seria perigoso), `null` remove e texto troca. [Set.toString] não mostra o segredo.
 */
sealed interface ReadSecretChange {
    data object Keep : ReadSecretChange

    data object Remove : ReadSecretChange

    class Set(
        val secret: String,
    ) : ReadSecretChange {
        override fun toString(): String = "Set(••••)"
    }
}
