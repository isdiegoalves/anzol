package site.webhook.rules

import com.jayway.jsonpath.InvalidPathException
import com.jayway.jsonpath.JsonPath
import site.webhook.schema.SchemaState
import site.webhook.signature.SignatureState
import tools.jackson.core.JacksonException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.math.BigDecimal
import java.util.UUID

private const val MAX_NAME_LENGTH = 100
private const val DEFAULT_PRIORITY = 5
private val STATUS_RANGE = 100..599
private val UUID_TEXT = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

/** `token` da RFC 9110 §5.6.2: o que pode ser nome de cabeçalho. */
val HEADER_NAME = Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+")
private val PATH_OPERATORS = listOf("equals", "prefix", "regex")
private val FIELD_OPERATORS = listOf("equals", "contains", "regex", "present")
private val BODY_OPERATORS = listOf("equals", "contains", "regex", "jsonPath", "equalToJson")

/**
 * O operador de regex dos filtros JSONPath. A regex dele roda dentro da biblioteca, que não deixa trocar o motor, e
 * escaparia do teto de custo (ReDoS): o `jsonPath` das condições o recusa ao salvar; para regex há a condição `regex`.
 */
private const val REGEX_FILTER = "=~"
private const val REGEX_FILTER_REFUSED = "The path may not use the regex operator =~; use the regex condition instead."
private val DELAY_OPERATORS = listOf("fixed", "uniform", "lognormal")
private val DELAY_RANGE = 0..MAX_DELAY_MS
private val MEDIAN_RANGE = BigDecimal.ONE..BigDecimal(MAX_DELAY_MS)
private val SIGMA_RANGE = BigDecimal.ZERO..BigDecimal.TEN
private val CHUNKS_RANGE = 1..100
private val CHANCE_RANGE = 1L..100L

private val jsonReader = JsonMapper.builder().build()

/**
 * Uma regra do Anexo A: identificação, prioridade e resposta; o `match` fica com o [MatchReader]. Com
 * [checkTemplates], corpo e cabeçalhos com `template: true` precisam compilar (ver [parseRules]).
 */
class RuleReader(
    private val violations: Violations,
    private val checkTemplates: Boolean = true,
) {
    private val matchReader = MatchReader(violations, strict = checkTemplates)
    private val scenarioReader = ScenarioReader(violations)
    private val timingReader = TimingReader(violations)

    fun rule(
        node: JsonNode?,
        prefix: String,
    ): Rule? {
        if (node == null || !node.isObject) return violations.fail(prefix.ifEmpty { "rule" }, "The rule must be an object.")
        val id = id(node["id"], key(prefix, "id"))
        val name = violations.name(node["name"], key(prefix, "name"))
        val enabled = violations.boolean(node["enabled"], key(prefix, "enabled"), default = true)
        val priority = priority(node["priority"], key(prefix, "priority"))
        val chance = node["chance"].given()?.let { violations.whole(it, key(prefix, "chance"), CHANCE_RANGE, CHANCE_RANGE.last) }
        val activeFrom = node["active_from"].given()?.let { violations.dateTime(it, key(prefix, "active_from")) }
        val activeUntil = node["active_until"].given()?.let { violations.dateTime(it, key(prefix, "active_until")) }
        if (activeFrom != null && activeUntil != null && activeUntil <= activeFrom) {
            violations.fail(key(prefix, "active_until"), "The active until must be a date after active from.")
        }
        val match = matchReader.match(node["match"], key(prefix, "match"))
        val scenario = scenarioReader.scenario(node["scenario"], key(prefix, "scenario"))
        val response = response(node["response"], key(prefix, "response"))
        return if (violations.hasErrorsUnder(prefix)) {
            null
        } else {
            Rule(
                id = checkNotNull(id),
                name = checkNotNull(name),
                enabled = checkNotNull(enabled),
                priority = checkNotNull(priority),
                chance = chance?.toInt(),
                activeFrom = activeFrom,
                activeUntil = activeUntil,
                match = checkNotNull(match),
                scenario = scenario,
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
        if (template == true && checkTemplates) validateTemplates(body, headers.orEmpty(), key)
        val delay = timingReader.delay(node["delay"], key(key, "delay"))
        val dribble = timingReader.dribble(node["dribble"], key(key, "dribble"))
        val fault = timingReader.fault(node["fault"], key(key, "fault"))
        return if (violations.hasErrorsUnder(
                key,
            )
        ) {
            null
        } else {
            RuleResponse(
                status = checkNotNull(status),
                headers = checkNotNull(headers),
                body = body,
                template = checkNotNull(template),
                delay = delay,
                dribble = dribble,
                fault = fault,
            )
        }
    }

    /** Com `template: true`, corpo e valores de cabeçalho precisam compilar como template. */
    private fun validateTemplates(
        body: String,
        headers: Map<String, String>,
        key: String,
    ) {
        (listOf(key(key, "body") to body) + headers.map { (name, value) -> key(key(key, "headers"), name) to value })
            .forEach { (field, text) -> templateError(text)?.let { violations.fail(field, invalidTemplateMessage(it)) } }
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

/**
 * O `match` de uma regra: método, caminho, query, cabeçalhos, corpo, assinatura e schema. Sem [strict] (a lista
 * gravada), aceita o que foi salvo antes de uma recusa nova (o filtro JSONPath com `=~`).
 */
class MatchReader(
    private val violations: Violations,
    private val strict: Boolean = true,
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
        val signature = node["signature"].given()?.let { violations.signatureState(it, key(key, "signature")) }
        val schema = node["schema"].given()?.let { violations.schemaState(it, key(key, "schema")) }
        return if (violations.hasErrorsUnder(key)) {
            null
        } else {
            RuleMatch(
                method = checkNotNull(method),
                path = path,
                query = checkNotNull(query),
                headers = checkNotNull(headers),
                body = checkNotNull(body),
                signature = signature,
                schema = schema,
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
        return when {
            source == null -> {
                null
            }

            strict && REGEX_FILTER in source -> {
                violations.fail(pathKey, REGEX_FILTER_REFUSED)
            }

            else -> {
                try {
                    BodyMatcher.JsonPathMatch(source, JsonPath.compile(source), given["equals"].given())
                } catch (_: InvalidPathException) {
                    violations.fail(pathKey, "The path is invalid.")
                }
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

/** O `scenario` de uma regra, `{name, requiredState?, newState?}`: nome como o da regra, estados em texto não vazio. */
class ScenarioReader(
    private val violations: Violations,
) {
    fun scenario(
        node: JsonNode?,
        key: String,
    ): RuleScenario? {
        val given = node.given()?.let { violations.objectOrNull(it, key) } ?: return null
        val name = violations.name(given["name"], key(key, "name"))
        val required = given["requiredState"].given()?.let { state(it, key(key, "requiredState")) }
        val next = given["newState"].given()?.let { state(it, key(key, "newState")) }
        return name?.let { RuleScenario(it, required, next) }
    }

    private fun state(
        node: JsonNode,
        key: String,
    ): String? {
        val text = violations.text(node, key) ?: return null
        return text.ifEmpty { violations.fail(key, "The ${key.substringAfterLast('.')} field is required.") }
    }
}

/** `match.signature`: `valid`, `invalid` ou `absent`. */
private fun Violations.signatureState(
    node: JsonNode,
    key: String,
): SignatureState? =
    SignatureState.entries.firstOrNull { node.isString && it.id == node.stringValue() }
        ?: fail(key, "The selected signature is invalid.")

/** `match.schema`: `valid` ou `invalid`. */
private fun Violations.schemaState(
    node: JsonNode,
    key: String,
): SchemaState? =
    SchemaState.entries.firstOrNull { node.isString && it.id == node.stringValue() }
        ?: fail(key, "The selected schema is invalid.")

/** Nome da regra ou do cenário: obrigatório, texto, até [MAX_NAME_LENGTH] caracteres. */
private fun Violations.name(
    node: JsonNode?,
    key: String,
): String? {
    val given = node.given()
    return when {
        given == null || (given.isString && given.stringValue().isBlank()) -> {
            fail(key, "The name field is required.")
        }

        !given.isString -> {
            fail(key, "The name must be a string.")
        }

        given.stringValue().length > MAX_NAME_LENGTH -> {
            fail(key, "The name may not be greater than $MAX_NAME_LENGTH characters.")
        }

        else -> {
            given.stringValue()
        }
    }
}

/** `delay`, `dribble` e `fault` da resposta (Anexo B); ausente ou nulo = sem. */
class TimingReader(
    private val violations: Violations,
) {
    fun delay(
        node: JsonNode?,
        key: String,
    ): Delay? {
        val given = node.given()?.let { violations.objectOrNull(it, key) }
        val operator = given?.let { violations.operator(it, key, DELAY_OPERATORS, "delay") }
        val operand = key(key, operator.orEmpty())
        return when (operator) {
            null -> null
            "fixed" -> integerIn(given[operator], operand, DELAY_RANGE)?.let(Delay::Fixed)
            "uniform" -> violations.objectOrNull(given[operator], operand)?.let { uniform(it, operand) }
            else -> violations.objectOrNull(given[operator], operand)?.let { logNormal(it, operand) }
        }
    }

    fun dribble(
        node: JsonNode?,
        key: String,
    ): Dribble? {
        val given = node.given()?.let { violations.objectOrNull(it, key) } ?: return null
        val chunks = integerIn(given["chunks"], key(key, "chunks"), CHUNKS_RANGE)
        val duration = integerIn(given["durationMs"], key(key, "durationMs"), DELAY_RANGE)
        return if (chunks == null || duration == null) null else Dribble(chunks, duration)
    }

    fun fault(
        node: JsonNode?,
        key: String,
    ): Fault? {
        val given = node.given() ?: return null
        return given.takeIf { it.isString }?.let { Fault.of(it.stringValue()) } ?: violations.fail(key, "The selected fault is invalid.")
    }

    private fun uniform(
        node: JsonNode,
        key: String,
    ): Delay? {
        val min = integerIn(node["min"], key(key, "min"), DELAY_RANGE)
        val max = integerIn(node["max"], key(key, "max"), DELAY_RANGE)
        return when {
            min == null || max == null -> null
            max < min -> violations.fail(key(key, "max"), "The max must be greater than or equal to the min.")
            else -> Delay.Uniform(min, max)
        }
    }

    private fun logNormal(
        node: JsonNode,
        key: String,
    ): Delay? {
        val median = numberIn(node["median"], key(key, "median"), MEDIAN_RANGE)
        val sigma = numberIn(node["sigma"], key(key, "sigma"), SIGMA_RANGE)
        return if (median == null || sigma == null) null else Delay.LogNormal(median, sigma)
    }

    private fun integerIn(
        node: JsonNode?,
        key: String,
        range: IntRange,
    ): Int? {
        val value = required(node, key)?.let { violations.integer(it, key) }
        return when {
            value == null || value in range -> value
            else -> violations.fail(key, "The ${attributeOf(key)} must be between ${range.first} and ${range.last}.")
        }
    }

    private fun numberIn(
        node: JsonNode?,
        key: String,
        range: ClosedRange<BigDecimal>,
    ): BigDecimal? {
        val given = required(node, key)
        val value = given?.takeIf { it.isNumber }?.decimalValue()
        val between = "between ${range.start.toPlainString()} and ${range.endInclusive.toPlainString()}"
        return when {
            given == null -> null
            value == null -> violations.fail(key, "The ${attributeOf(key)} must be a number.")
            value in range -> value
            else -> violations.fail(key, "The ${attributeOf(key)} must be $between.")
        }
    }

    private fun required(
        node: JsonNode?,
        key: String,
    ): JsonNode? = node.given() ?: violations.fail(key, "The ${attributeOf(key)} field is required.")

    private fun attributeOf(key: String): String = key.substringAfterLast('.')
}
