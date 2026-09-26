package site.webhook.rules

import com.jayway.jsonpath.JsonPathException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.NullNode

/** Acima disto, o valor recebido aparece cortado na frase do `failed`. */
private const val MAX_SHOWN_LENGTH = 100

/**
 * JSONPath sem `equals`: o caminho existe (inclusive com valor `null`). Com `equals`: algum valor
 * alcançado é igual (ver [sameJson]; texto esperado casa número ou booleano de mesmo texto).
 */
fun jsonPathFailure(
    matcher: BodyMatcher.JsonPathMatch,
    input: MatchInput,
): String? {
    val target = "body ${matcher.path}"
    val found = jsonPathValues(matcher, input.document)
    val expected = matcher.equals
    return when {
        input.json == null -> {
            "$target: body is not JSON"
        }

        found == null -> {
            "$target: absent"
        }

        expected == null || found.any { sameJson(expected, it, textMatchesScalar = true) } -> {
            null
        }

        else -> {
            val actual = found.singleOrNull()?.takeIf { matcher.compiled.isDefinite } ?: bodyMapper.valueToTree(found)
            "$target: expected ${shown(expected)}, got ${shown(actual)}"
        }
    }
}

/** Os valores que o caminho alcança (um, se o caminho é definido); `null` quando não alcança nenhum. */
private fun jsonPathValues(
    matcher: BodyMatcher.JsonPathMatch,
    document: Any?,
): List<JsonNode>? {
    if (document == null) return null
    val values =
        try {
            val result = matcher.compiled.read<Any?>(document)
            if (matcher.compiled.isDefinite) listOf(result) else (result as? List<*>).orEmpty()
        } catch (_: JsonPathException) {
            emptyList()
        }
    return values.map(::toTree).ifEmpty { null }
}

private fun toTree(value: Any?): JsonNode = if (value == null) NullNode.instance else bodyMapper.valueToTree(value)

fun equalToJsonFailure(
    matcher: BodyMatcher.EqualToJson,
    actual: JsonNode?,
): String? =
    when {
        actual == null -> "body: body is not JSON"
        sameJson(matcher.expected, actual) -> null
        else -> "body: not equal to the expected JSON"
    }

/**
 * Igualdade de árvores JSON: objetos sem olhar a ordem das chaves, listas na ordem, números pelo valor
 * (`1` = `1.0`). Com [textMatchesScalar], texto esperado casa também número ou booleano de mesmo texto.
 */
fun sameJson(
    expected: JsonNode,
    actual: JsonNode,
    textMatchesScalar: Boolean = false,
): Boolean =
    when {
        expected.isNumber && actual.isNumber -> {
            expected.decimalValue().compareTo(actual.decimalValue()) == 0
        }

        textMatchesScalar && expected.isString && actual.isValueNode && !actual.isNull -> {
            expected.stringValue() == actual.asString()
        }

        expected.isObject && actual.isObject -> {
            sameObject(expected, actual)
        }

        expected.isArray && actual.isArray -> {
            expected.size() == actual.size() &&
                expected.zip(actual).all { (left, right) -> sameJson(left, right) }
        }

        else -> {
            expected == actual
        }
    }

private fun sameObject(
    expected: JsonNode,
    actual: JsonNode,
): Boolean =
    expected.size() == actual.size() &&
        expected.properties().all { (name, value) -> actual.has(name) && sameJson(value, actual[name]) }

/** Texto como string JSON, entre aspas. */
fun quote(text: String): String = bodyMapper.writeValueAsString(text)

/** O valor recebido como JSON (texto entre aspas), cortado em [MAX_SHOWN_LENGTH] caracteres. */
fun shown(value: String): String = quote(if (value.length > MAX_SHOWN_LENGTH) value.take(MAX_SHOWN_LENGTH) + "…" else value)

fun shown(value: JsonNode): String = if (value.isString) shown(value.stringValue()) else value.toString()
