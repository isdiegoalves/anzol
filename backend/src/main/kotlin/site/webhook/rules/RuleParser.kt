package site.webhook.rules

import tools.jackson.databind.JsonNode
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit
import java.util.regex.PatternSyntaxException

/** Teto de regras por URL. */
const val MAX_RULES = 100

/** Data-hora da RFC 3339: segundos obrigatórios, fração opcional e fuso (`Z` ou `±hh:mm`). */
private val DATE_TIME = Regex("\\d{4}-\\d{2}-\\d{2}[Tt]\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?([Zz]|[+-]\\d{2}:\\d{2})")

/** Resultado da leitura: as regras, ou os erros do 422 (chave em pontos → mensagens no estilo do Laravel). */
sealed interface Parsed<out T> {
    data class Valid<T>(
        val value: T,
    ) : Parsed<T>

    data class Invalid(
        val errors: Map<String, List<String>>,
    ) : Parsed<Nothing>
}

/**
 * A lista do `PUT /token/{id}/rules` (e a gravada no Redis). Chaves de erro a partir do índice
 * (`0.match.path.regex`); `rules` para o que é da lista inteira. Regra sem `id` ganha um UUID novo.
 * Sem [checkTemplates] (a lista gravada), o template não é compilado aqui: regra salva antes de um teto
 * novo continua listada, e só a resposta dela falha (500 com o motivo, ver [rendered]).
 */
fun parseRules(
    tree: JsonNode?,
    checkTemplates: Boolean = true,
): Parsed<List<Rule>> =
    when {
        tree == null || !tree.isArray -> invalid("rules", "The rules must be an array.")
        tree.size() > MAX_RULES -> invalid("rules", "The rules may not have more than $MAX_RULES items.")
        else -> readRules(tree, checkTemplates)
    }

/** A regra única do `POST /token/{id}/rules/test`: as mesmas regras, chaves sem o índice (`match.path.regex`). */
fun parseRule(tree: JsonNode?): Parsed<Rule> {
    val violations = Violations()
    val rule = RuleReader(violations).rule(tree, "")
    return violations.result { checkNotNull(rule) }
}

private fun readRules(
    tree: JsonNode,
    checkTemplates: Boolean,
): Parsed<List<Rule>> {
    val violations = Violations()
    val reader = RuleReader(violations, checkTemplates)
    val rules = tree.mapIndexed { index, node -> reader.rule(node, index.toString()) }
    reader.rejectDuplicateIds(tree)
    return violations.result { rules.filterNotNull() }
}

private fun invalid(
    key: String,
    message: String,
): Parsed<Nothing> = Parsed.Invalid(mapOf(key to listOf(message)))

/** Nulo no JSON vale como ausente. */
fun JsonNode?.given(): JsonNode? = this?.takeUnless { it.isNull || it.isMissingNode }

fun key(
    prefix: String,
    name: String,
): String = if (prefix.isEmpty()) name else "$prefix.$name"

/** O nome que a mensagem mostra: o último trecho da chave, como o Laravel faz com `rules.*.name`. */
private fun attribute(key: String): String = key.substringAfterLast('.').replace('_', ' ')

/** Todos os valores, ou `null` se algum falhou (o erro já foi registrado). */
fun <T : Any> List<T?>.allOrNull(): List<T>? = if (any { it == null }) null else filterNotNull()

fun <T : Any> Map<String, T?>.allOrNull(): Map<String, T>? = if (values.any { it == null }) null else mapValues { checkNotNull(it.value) }

/**
 * Erros da leitura, juntados em vez de parar no primeiro, e os leitores de valores simples. Cada
 * leitor devolve o valor, ou `null` depois de registrar o erro.
 */
class Violations {
    private val errors = LinkedHashMap<String, MutableList<String>>()

    fun <T> result(value: () -> T): Parsed<T> = if (errors.isEmpty()) Parsed.Valid(value()) else Parsed.Invalid(errors.toMap())

    fun fail(
        key: String,
        message: String,
    ): Nothing? {
        errors.getOrPut(key) { mutableListOf() }.add(message)
        return null
    }

    /** Algum erro na chave ou abaixo dela (prefixo vazio: qualquer erro). */
    fun hasErrorsUnder(prefix: String): Boolean = errors.keys.any { prefix.isEmpty() || it == prefix || it.startsWith("$prefix.") }

    fun boolean(
        node: JsonNode?,
        key: String,
        default: Boolean,
    ): Boolean? {
        val given = node.given() ?: return default
        return if (given.isBoolean) given.booleanValue() else fail(key, "The ${attribute(key)} field must be true or false.")
    }

    fun integer(
        node: JsonNode,
        key: String,
    ): Int? =
        if (node.isIntegralNumber &&
            node.canConvertToInt()
        ) {
            node.intValue()
        } else {
            fail(key, "The ${attribute(key)} must be an integer.")
        }

    /** Inteiro dentro de [range], com as mensagens do Laravel (`integer`, `min`, `between`); ausente ou nulo é [default]. */
    fun whole(
        node: JsonNode?,
        key: String,
        range: LongRange,
        default: Long,
    ): Long? {
        val given = node.given() ?: return default
        val value = given.takeIf { it.isIntegralNumber && it.canConvertToLong() }?.longValue()
        return when {
            value == null -> fail(key, "The ${attribute(key)} must be an integer.")
            value in range -> value
            range.last == Long.MAX_VALUE -> fail(key, "The ${attribute(key)} must be at least ${range.first}.")
            else -> fail(key, "The ${attribute(key)} must be between ${range.first} and ${range.last}.")
        }
    }

    fun text(
        node: JsonNode?,
        key: String,
    ): String? = node?.takeIf { it.isString }?.stringValue() ?: fail(key, "The ${attribute(key)} must be a string.")

    /** Data-hora com fuso ([DATE_TIME]), em UTC e cortada no segundo. */
    fun dateTime(
        node: JsonNode,
        key: String,
    ): Instant? {
        val text = node.takeIf { it.isString }?.stringValue()?.takeIf(DATE_TIME::matches)
        val instant =
            try {
                text?.let { OffsetDateTime.parse(it).toInstant().truncatedTo(ChronoUnit.SECONDS) }
            } catch (_: DateTimeParseException) {
                null
            }
        return instant ?: fail(key, "The ${attribute(key)} must be an ISO-8601 date-time with a time zone, like 2026-09-29T12:00:00Z.")
    }

    fun regex(
        node: JsonNode?,
        key: String,
    ): Regex? {
        val pattern = text(node, key) ?: return null
        return try {
            conditionRegex(pattern)
        } catch (_: PatternSyntaxException) {
            fail(key, "The regex is invalid.")
        }
    }

    fun objectOrNull(
        node: JsonNode,
        key: String,
    ): JsonNode? = node.takeIf { it.isObject } ?: fail(key, "The ${attribute(key)} must be an object.")

    /** O único operador presente entre [operators], ou `null` com o erro de "exatamente um". */
    fun operator(
        node: JsonNode,
        key: String,
        operators: List<String>,
        subject: String,
    ): String? =
        operators.singleOrNull { node[it].given() != null }
            ?: fail(key, "The $subject must have exactly one of: ${operators.joinToString(", ")}.")
}
