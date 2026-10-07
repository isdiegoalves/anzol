package anzol.e2ee

import anzol.rules.Parsed
import anzol.rules.Violations
import anzol.rules.bodyMapper
import anzol.rules.given
import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonValue
import com.jayway.jsonpath.InvalidPathException
import com.jayway.jsonpath.JsonPath
import com.nimbusds.jose.jwk.ECKey
import tools.jackson.databind.JsonNode

private const val DEFAULT_MAX_AGE_SECONDS = 43_200L
private val MAX_AGE_RANGE = 60L..604_800L
private val TRUSTED_SIGNERS_RANGE = 1..10
private const val MAX_AUDIENCE_LENGTH = 256
private const val KEY = "e2ee"
private val BINDING_NAMES = listOf("jti", "evt", "app")

/** Onde o envelope em claro guarda o valor que um claim do JWS tem de repetir; [ignoreCase] compara sem caixa. */
data class Binding(
    val path: String,
    val ignoreCase: Boolean,
) {
    val compiled: JsonPath by lazy { JsonPath.compile(path) }

    fun toJson(): Any = if (ignoreCase) linkedMapOf("path" to path, "ignore_case" to true) else path
}

/** Os claims `jti`, `evt` e `app` do JWS e o lugar do valor correspondente no envelope. */
data class Bindings(
    val jti: Binding,
    val evt: Binding,
    val app: Binding,
)

/**
 * `e2ee` da URL: o atributo em [path] chega como JWE (ECDH-ES, A256GCM) de um JWS ES256 assinado por um dos
 * [trustedSigners], com `aud` igual a [audience] e `jti`, `evt` e `app` iguais aos [bindings] do envelope. Com
 * [required], o atributo que não é JWE é uma falha (downgrade), nunca texto aceito. Só chaves públicas: nada aqui é
 * segredo.
 */
data class E2eePolicy(
    val path: String,
    val required: Boolean,
    val audience: String,
    val bindings: Bindings,
    val maxAgeSeconds: Long,
    val trustedSigners: List<ECKey>,
) {
    val compiledPath: JsonPath by lazy { JsonPath.compile(path) }

    @JsonValue
    fun toJson(): Map<String, Any> =
        linkedMapOf(
            "path" to path,
            "required" to required,
            "audience" to audience,
            "bindings" to linkedMapOf("jti" to bindings.jti.toJson(), "evt" to bindings.evt.toJson(), "app" to bindings.app.toJson()),
            "max_age_seconds" to maxAgeSeconds,
            "trusted_signers" to trustedSigners.map { it.toJSONObject() },
        )

    companion object {
        /** Lê o JSON gravado no Redis, com a mesma leitura da API. */
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun fromJson(value: Map<String, Any?>): E2eePolicy =
            when (val parsed = readE2ee(value)) {
                is Parsed.Valid -> parsed.value
                is Parsed.Invalid -> error("e2ee inválido no Redis: ${parsed.errors.keys}")
            }
    }
}

/** Lê `e2ee` (JSON da API, formulário ou o gravado no Redis), com os erros sob `e2ee.<campo>`. */
fun readE2ee(value: Any?): Parsed<E2eePolicy> {
    val node = (value as? Map<*, *>)?.let { bodyMapper.valueToTree<JsonNode>(it) }
    if (node == null || !node.isObject) return Parsed.Invalid(mapOf(KEY to listOf("The e2ee must be an object.")))
    val violations = Violations()
    val path = violations.jsonPath(node["path"], "$KEY.path")
    val required = violations.boolean(node["required"], "$KEY.required", default = true)
    val audience = violations.audience(node["audience"])
    val bindings = violations.bindings(node["bindings"])
    val maxAge = violations.whole(node["max_age_seconds"], "$KEY.max_age_seconds", MAX_AGE_RANGE, DEFAULT_MAX_AGE_SECONDS)
    val signers = violations.trustedSigners(node["trusted_signers"])
    return violations.result {
        E2eePolicy(
            path = checkNotNull(path),
            required = checkNotNull(required),
            audience = checkNotNull(audience),
            bindings = checkNotNull(bindings),
            maxAgeSeconds = checkNotNull(maxAge),
            trustedSigners = checkNotNull(signers),
        )
    }
}

/** JSONPath definido (aponta um valor só): sem filtros, sem curinga, sem custo a medir. */
private fun Violations.jsonPath(
    node: JsonNode?,
    key: String,
): String? {
    val text = node.given()?.takeIf { it.isString }?.stringValue()
    val definite = text?.let(::isDefinite)
    return when {
        text == null -> fail(key, "The $key field is required.")
        definite == null -> fail(key, "The $key is not a valid JSONPath.")
        !definite -> fail(key, "The $key must point to a single value (no filters or wildcards).")
        else -> text
    }
}

/** `null` quando o texto não é um JSONPath. */
private fun isDefinite(path: String): Boolean? =
    try {
        JsonPath.compile(path).isDefinite
    } catch (_: InvalidPathException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

private fun Violations.audience(node: JsonNode?): String? {
    val key = "$KEY.audience"
    val text = node.given()?.takeIf { it.isString }?.stringValue()
    return when {
        text.isNullOrBlank() -> fail(key, "The $key field is required.")
        text.length > MAX_AUDIENCE_LENGTH -> fail(key, "The $key may not be greater than $MAX_AUDIENCE_LENGTH characters.")
        else -> text
    }
}

private fun Violations.bindings(node: JsonNode?): Bindings? {
    val key = "$KEY.bindings"
    val given = node.given()?.takeIf { it.isObject } ?: return fail(key, "The $key must be an object with jti, evt and app.")
    val read = BINDING_NAMES.associateWith { binding(given[it], "$key.$it") }
    val (jti, evt, app) = BINDING_NAMES.map { read[it] }
    return if (jti == null || evt == null || app == null) null else Bindings(jti, evt, app)
}

/** Texto (o caminho, comparação exata) ou `{path, ignore_case}`. */
private fun Violations.binding(
    node: JsonNode?,
    key: String,
): Binding? {
    val given = node.given()
    return when {
        given == null -> fail(key, "The $key field is required.")
        given.isString -> jsonPath(given, key)?.let { Binding(it, ignoreCase = false) }
        !given.isObject -> fail(key, "The $key must be a JSONPath or an object with path and ignore_case.")
        else -> objectBinding(given, key)
    }
}

private fun Violations.objectBinding(
    node: JsonNode,
    key: String,
): Binding? {
    val path = jsonPath(node["path"], "$key.path")
    val ignoreCase = boolean(node["ignore_case"], "$key.ignore_case", default = false)
    return if (path == null || ignoreCase == null) null else Binding(path, ignoreCase)
}

private fun Violations.trustedSigners(node: JsonNode?): List<ECKey>? {
    val key = "$KEY.trusted_signers"
    val given = node.given()?.takeIf { it.isArray }
    if (given == null || given.size() !in TRUSTED_SIGNERS_RANGE) {
        return fail(key, "The $key must be a list of ${TRUSTED_SIGNERS_RANGE.first} to ${TRUSTED_SIGNERS_RANGE.last} public JWKs.")
    }
    val keys = given.mapIndexed { index, jwk -> signer(jwk, "$key.$index") }
    val kids = keys.filterNotNull().map { it.keyID }
    if (kids.size != kids.toSet().size) fail(key, "The $key must not repeat a kid.")
    return if (keys.any { it == null }) null else keys.filterNotNull()
}
