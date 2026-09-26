package site.webhook.rules

import com.jayway.jsonpath.InvalidPathException
import com.jayway.jsonpath.JsonPath
import tools.jackson.core.JacksonException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.util.UUID

private const val MAX_NAME_LENGTH = 100
private const val DEFAULT_PRIORITY = 5
private val STATUS_RANGE = 100..599
private val UUID_TEXT = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

/** `token` da RFC 9110 §5.6.2: o que pode ser nome de cabeçalho. */
private val HEADER_NAME = Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+")
private val PATH_OPERATORS = listOf("equals", "prefix", "regex")
private val FIELD_OPERATORS = listOf("equals", "contains", "regex", "present")
private val BODY_OPERATORS = listOf("equals", "contains", "regex", "jsonPath", "equalToJson")
private val FUTURE_RESPONSE_FIELDS = listOf("delay", "dribble", "fault")

private val jsonReader = JsonMapper.builder().build()

/** Uma regra do Anexo A: identificação, prioridade e resposta; o `match` fica com o [MatchReader]. */
class RuleReader(
    private val violations: Violations,
) {
    private val matchReader = MatchReader(violations)

    fun rule(
        node: JsonNode?,
        prefix: String,
    ): Rule? {
        if (node == null || !node.isObject) return violations.fail(prefix.ifEmpty { "rule" }, "The rule must be an object.")
        val id = id(node["id"], key(prefix, "id"))
        val name = name(node["name"], key(prefix, "name"))
        val enabled = violations.boolean(node["enabled"], key(prefix, "enabled"), default = true)
        val priority = priority(node["priority"], key(prefix, "priority"))
        val match = matchReader.match(node["match"], key(prefix, "match"))
        violations.notSupported(node["scenario"], key(prefix, "scenario"))
        val response = response(node["response"], key(prefix, "response"))
        return if (violations.hasErrorsUnder(prefix)) {
            null
        } else {
            Rule(
                id = checkNotNull(id),
                name = checkNotNull(name),
                enabled = checkNotNull(enabled),
                priority = checkNotNull(priority),
                match = checkNotNull(match),
                response = checkNotNull(response),
            )
        }
    }

    /** `id` repetido na lista: a segunda ocorrência em diante é recusada. */
    fun rejectDuplicateIds(rules: JsonNode) {
        val seen = mutableSetOf<String>()
        rules.forEachIndexed { index, node ->
            val id =
                node["id"]
                    .given()
                    ?.takeIf { it.isString }
                    ?.stringValue()
                    ?.lowercase()
            if (id != null && !seen.add(id)) violations.fail("$index.id", "The id field has a duplicate value.")
        }
    }

    private fun id(
        node: JsonNode?,
        key: String,
    ): RuleId? {
        val given = node.given() ?: return RuleId(UUID.randomUUID())
        val text = given.takeIf { it.isString }?.stringValue()?.takeIf { UUID_TEXT.matches(it) }
        return if (text == null) violations.fail(key, "The id must be a valid UUID.") else RuleId(UUID.fromString(text))
    }

    private fun name(
        node: JsonNode?,
        key: String,
    ): String? {
        val given = node.given()
        return when {
            given == null || (given.isString && given.stringValue().isBlank()) -> {
                violations.fail(key, "The name field is required.")
            }

            !given.isString -> {
                violations.fail(key, "The name must be a string.")
            }

            given.stringValue().length > MAX_NAME_LENGTH -> {
                violations.fail(key, "The name may not be greater than $MAX_NAME_LENGTH characters.")
            }

            else -> {
                given.stringValue()
            }
        }
    }

    private fun priority(
        node: JsonNode?,
        key: String,
    ): Int? {
        val given = node.given() ?: return DEFAULT_PRIORITY
        return violations.integer(given, key)?.let { if (it >= 1) it else violations.fail(key, "The priority must be at least 1.") }
    }

    private fun response(
        node: JsonNode?,
        key: String,
    ): RuleResponse? {
        val given = node.given() ?: return RuleResponse()
        return violations.objectOrNull(given, key)?.let { responseFields(it, key) }
    }

    private fun responseFields(
        node: JsonNode,
        key: String,
    ): RuleResponse? {
        val status = status(node["status"], key(key, "status"))
        val headers = responseHeaders(node["headers"], key(key, "headers"))
        val body = node["body"].given()?.let { violations.text(it, key(key, "body")) }.orEmpty()
        val template = violations.boolean(node["template"], key(key, "template"), default = false)
        if (template == true) violations.fail(key(key, "template"), "The template is not supported yet.")
        FUTURE_RESPONSE_FIELDS.forEach { violations.notSupported(node[it], key(key, it)) }
        return if (violations.hasErrorsUnder(
                key,
            )
        ) {
            null
        } else {
            RuleResponse(status = checkNotNull(status), headers = checkNotNull(headers), body = body)
        }
    }

    private fun status(
        node: JsonNode?,
        key: String,
    ): Int? {
        val given = node.given() ?: return DEFAULT_RESPONSE_STATUS
        return violations.integer(given, key)?.let {
            if (it in
                STATUS_RANGE
            ) {
                it
            } else {
                violations.fail(key, "The status must be between ${STATUS_RANGE.first} and ${STATUS_RANGE.last}.")
            }
        }
    }

    private fun responseHeaders(
        node: JsonNode?,
        key: String,
    ): Map<String, String>? {
        val given = node.given() ?: return emptyMap()
        return violations.objectOrNull(given, key)?.let { headers ->
            headers.properties().associate { (name, value) -> name to headerValue(name, value, key(key, name)) }.allOrNull()
        }
    }

    private fun headerValue(
        name: String,
        value: JsonNode,
        key: String,
    ): String? =
        when {
            !HEADER_NAME.matches(name) -> violations.fail(key, "The header name is invalid.")
            !value.isString -> violations.fail(key, "The header value must be a string.")
            value.stringValue().any { it == '\r' || it == '\n' || it == '\u0000' } -> violations.fail(key, "The header value is invalid.")
            else -> value.stringValue()
        }
}

/** O `match` de uma regra: método, caminho, query, cabeçalhos e corpo. */
class MatchReader(
    private val violations: Violations,
) {
    fun match(
        node: JsonNode?,
        key: String,
    ): RuleMatch? {
        val given = node.given() ?: return RuleMatch()
        return violations.objectOrNull(given, key)?.let { matchFields(it, key) }
    }

    private fun matchFields(
        node: JsonNode,
        key: String,
    ): RuleMatch? {
        val method = methods(node["method"], key(key, "method"))
        val path = node["path"].given()?.let { path(it, key(key, "path")) }
        val query = fields(node["query"], key(key, "query"))
        val headers = fields(node["headers"], key(key, "headers"))
        val body = body(node["body"], key(key, "body"))
        return if (violations.hasErrorsUnder(key)) {
            null
        } else {
            RuleMatch(
                method = checkNotNull(method),
                path = path,
                query = checkNotNull(query),
                headers = checkNotNull(headers),
                body = checkNotNull(body),
            )
        }
    }

    private fun methods(
        node: JsonNode?,
        key: String,
    ): List<String>? {
        val given = node.given() ?: return emptyList()
        return if (given.isArray) {
            given
                .mapIndexed { index, item ->
                    item.takeIf { it.isString && it.stringValue().isNotBlank() }?.stringValue()
                        ?: violations.fail("$key.$index", "The method must be a string.")
                }.allOrNull()
        } else {
            violations.fail(key, "The method must be an array.")
        }
    }

    private fun path(
        node: JsonNode,
        key: String,
    ): PathMatcher? {
        val operator = violations.objectOrNull(node, key)?.let { violations.operator(it, key, PATH_OPERATORS, "path") } ?: return null
        val operand = key(key, operator)
        return when (operator) {
            "equals" -> violations.text(node[operator], operand)?.let(PathMatcher::Equals)
            "prefix" -> violations.text(node[operator], operand)?.let(PathMatcher::Prefix)
            else -> violations.regex(node[operator], operand)?.let(PathMatcher::Matches)
        }
    }

    private fun fields(
        node: JsonNode?,
        key: String,
    ): Map<String, FieldMatcher>? {
        val given = node.given() ?: return emptyMap()
        return violations.objectOrNull(given, key)?.let { conditions ->
            conditions.properties().associate { (name, condition) -> name to field(condition, key(key, name)) }.allOrNull()
        }
    }

    private fun field(
        node: JsonNode,
        key: String,
    ): FieldMatcher? {
        val operator = conditionOperator(node, key, FIELD_OPERATORS) ?: return null
        val operand = key(key, operator)
        return when (operator) {
            "equals" -> violations.text(node[operator], operand)?.let(FieldMatcher::Equals)
            "contains" -> violations.text(node[operator], operand)?.let(FieldMatcher::Contains)
            "regex" -> violations.regex(node[operator], operand)?.let(FieldMatcher::Matches)
            else -> violations.boolean(node[operator], operand, default = false)?.let(FieldMatcher::Present)
        }
    }

    private fun body(
        node: JsonNode?,
        key: String,
    ): List<BodyMatcher>? {
        val given = node.given() ?: return emptyList()
        return if (given.isArray) {
            given.mapIndexed { index, condition -> bodyCondition(condition, "$key.$index") }.allOrNull()
        } else {
            violations.fail(key, "The body must be an array.")
        }
    }

    private fun bodyCondition(
        node: JsonNode,
        key: String,
    ): BodyMatcher? {
        val operator = conditionOperator(node, key, BODY_OPERATORS) ?: return null
        val operand = key(key, operator)
        return when (operator) {
            "equals" -> violations.text(node[operator], operand)?.let(BodyMatcher::Equals)
            "contains" -> violations.text(node[operator], operand)?.let(BodyMatcher::Contains)
            "regex" -> violations.regex(node[operator], operand)?.let(BodyMatcher::Matches)
            "jsonPath" -> jsonPath(node[operator], operand)
            else -> equalToJson(node[operator], operand)
        }
    }

    private fun conditionOperator(
        node: JsonNode,
        key: String,
        operators: List<String>,
    ): String? =
        if (node.isObject) {
            violations.operator(node, key, operators, "condition")
        } else {
            violations.fail(key, "The condition must be an object.")
        }

    private fun jsonPath(
        node: JsonNode,
        key: String,
    ): BodyMatcher? {
        val given = violations.objectOrNull(node, key) ?: return null
        val pathKey = key(key, "path")
        val path = given["path"].given()
        val source = if (path == null) violations.fail(pathKey, "The path field is required.") else violations.text(path, pathKey)
        return source?.let {
            try {
                BodyMatcher.JsonPathMatch(it, JsonPath.compile(it), given["equals"].given())
            } catch (_: InvalidPathException) {
                violations.fail(pathKey, "The path is invalid.")
            }
        }
    }

    /** Objeto, lista ou escalar valem como estão; texto é lido como o JSON que ele contém. */
    private fun equalToJson(
        node: JsonNode,
        key: String,
    ): BodyMatcher? =
        if (!node.isString) {
            BodyMatcher.EqualToJson(source = node, expected = node)
        } else {
            try {
                BodyMatcher.EqualToJson(source = node, expected = jsonReader.readTree(node.stringValue()))
            } catch (_: JacksonException) {
                violations.fail(key, "The equalToJson must be a valid JSON string.")
            }
        }
}
