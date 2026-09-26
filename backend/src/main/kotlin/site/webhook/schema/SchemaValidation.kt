package site.webhook.schema

import com.fasterxml.jackson.annotation.JsonValue
import site.webhook.rules.readJson

/** Quantos erros a mensagem guarda: os primeiros, na ordem da biblioteca. */
const val MAX_SCHEMA_ERRORS = 20

const val NOT_JSON = "body is not JSON"

/** O que a condição `match.schema` das regras compara. */
enum class SchemaState(
    @get:JsonValue val id: String,
) {
    VALID("valid"),
    INVALID("invalid"),
}

/** Um erro de validação: [path] é o JSON Pointer da instância (`""` na raiz) e [message] o texto da biblioteca. */
data class SchemaError(
    val path: String,
    val message: String,
)

/** `schema` da mensagem: o resultado da validação na captura, com no máximo [MAX_SCHEMA_ERRORS] erros. */
data class SchemaResult(
    val valid: Boolean,
    val errors: List<SchemaError>,
) {
    fun state(): SchemaState = if (valid) SchemaState.VALID else SchemaState.INVALID
}

/**
 * Valida o corpo (o `content` gravado) contra o schema. Vazio ou que não é JSON é inválido, com [NOT_JSON]. Uma
 * falha da biblioteca (inclusive a pilha estourada por `$ref` recursivo numa instância muito aninhada) vira
 * `valid: false` com a mensagem dela: a captura nunca cai por causa do schema.
 */
@Suppress("TooGenericExceptionCaught") // o requisito é que nenhuma falha da biblioteca derrube a captura
fun SchemaConfig.validate(body: String): SchemaResult {
    val instance = readJson(body) ?: return invalid(SchemaError("", NOT_JSON))
    return try {
        val errors = compile().validate(instance).take(MAX_SCHEMA_ERRORS)
        SchemaResult(valid = errors.isEmpty(), errors = errors.map { SchemaError(it.instanceLocation.toString(), it.message) })
    } catch (e: RuntimeException) {
        invalid(SchemaError("", e.reason()))
    } catch (_: StackOverflowError) {
        invalid(SchemaError("", "validation too deep (\$ref recursion)"))
    }
}

private fun invalid(error: SchemaError): SchemaResult = SchemaResult(valid = false, errors = listOf(error))
