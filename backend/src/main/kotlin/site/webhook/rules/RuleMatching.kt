package site.webhook.rules

import site.webhook.schema.SchemaState
import site.webhook.signature.SignatureState

/**
 * Uma condição da regra, na ordem em que o `failed` as lista: método, caminho, query, cabeçalhos, corpo, assinatura, schema.
 * [key] é a chave dela no `conditions` do near miss, no formato das chaves do 422 do `rules/test`.
 */
sealed interface Condition {
    data class Method(
        val methods: List<String>,
    ) : Condition

    data class Path(
        val matcher: PathMatcher,
    ) : Condition

    data class Query(
        val name: String,
        val matcher: FieldMatcher,
    ) : Condition

    /** [original] é o nome como na regra (a chave); [name], o normalizado que a comparação e a frase usam. */
    data class Header(
        val original: String,
        val matcher: FieldMatcher,
    ) : Condition {
        val name: String = original.lowercase().replace('_', '-')
    }

    /** [index] é a posição em `match.body`, a partir de 0. */
    data class Body(
        val index: Int,
        val matcher: BodyMatcher,
    ) : Condition

    data class Signature(
        val expected: SignatureState,
    ) : Condition

    data class Schema(
        val expected: SchemaState,
    ) : Condition
}

fun RuleMatch.conditions(): List<Condition> =
    listOfNotNull(
        Condition.Method(method).takeIf { method.isNotEmpty() },
        path?.let(Condition::Path),
    ) +
        query.map { (name, matcher) -> Condition.Query(name, matcher) } +
        headers.map { (name, matcher) -> Condition.Header(name, matcher) } +
        body.mapIndexed { index, matcher -> Condition.Body(index, matcher) } +
        listOfNotNull(signature?.let(Condition::Signature), schema?.let(Condition::Schema))

/** Escolha da regra: a que respondeu, ou nenhuma e a mais próxima (se havia regra ativa). */
sealed interface Decision {
    data class Matched(
        val rule: Rule,
    ) : Decision

    data class Unmatched(
        val nearMiss: NearMiss?,
    ) : Decision
}

/**
 * Regras ativas pela menor prioridade, empate pela ordem na lista: a primeira sem falhas responde.
 * Nenhuma casou: o near miss é a de menos falhas, com o mesmo desempate. [states] é o estado de cada
 * cenário (ausente = [STARTED]); o do cenário conta como a última condição da regra.
 */
fun List<Rule>.decide(
    input: MatchInput,
    states: Map<String, String> = emptyMap(),
): Decision {
    val evaluated = evaluationOrder().map { it to it.failures(input, states) }
    val matched = evaluated.firstOrNull { (_, failed) -> failed.isEmpty() }
    if (matched != null) return Decision.Matched(matched.first)
    val closest = evaluated.minByOrNull { (_, failed) -> failed.size }
    return Decision.Unmatched(
        closest?.let { (rule, failed) -> NearMiss(rule.id, rule.name, failed.map { it.phrase }, failed.map { it.condition }) },
    )
}

/** As regras ativas na ordem em que a escolha as avalia: pela menor prioridade, empate pela ordem na lista. */
fun List<Rule>.evaluationOrder(): List<Rule> = filter { it.enabled }.sortedBy { it.priority }

/** Nomes dos cenários de que a escolha entre as regras ativas depende. */
fun List<Rule>.activeScenarios(): List<String> = filter { it.enabled }.mapNotNull { it.scenario?.name }.distinct()

/** A frase do `failed` quando a condição falha; `null` quando casa. */
fun Condition.failure(input: MatchInput): String? =
    when (this) {
        is Condition.Method -> methodFailure(input.method)
        is Condition.Path -> pathFailure(matcher, input.path)
        is Condition.Query -> fieldFailure("query $name", matcher, input.query[name])
        is Condition.Header -> fieldFailure("header $name", matcher, input.headers[name])
        is Condition.Body -> bodyFailure(matcher, input)
        is Condition.Signature -> signatureFailure(expected, input.signature)
        is Condition.Schema -> schemaFailure(expected, input.schema)
    }

private fun Condition.Method.methodFailure(actual: String): String? {
    if (methods.any { it.equals(actual, ignoreCase = true) }) return null
    val expected = methods.singleOrNull() ?: "one of ${methods.joinToString(", ")}"
    return "method: expected $expected, got $actual"
}

private fun pathFailure(
    matcher: PathMatcher,
    actual: String,
): String? {
    val got = "got ${shown(actual)}"
    return when (matcher) {
        is PathMatcher.Equals -> {
            "path: expected ${quote(matcher.value)}, $got".takeUnless { actual == matcher.value }
        }

        is PathMatcher.Prefix -> {
            "path: expected prefix ${quote(matcher.value)}, $got".takeUnless { actual.startsWith(matcher.value) }
        }

        is PathMatcher.Matches -> {
            matcher.regex.matchFailure("path", actual, got)
        }
    }
}

/** Parâmetro da query ou cabeçalho: `absent`/`present` para presença, senão o valor esperado e o recebido. */
private fun fieldFailure(
    target: String,
    matcher: FieldMatcher,
    actual: String?,
): String? =
    when {
        matcher is FieldMatcher.Present && matcher.expected -> "$target: absent".takeIf { actual == null }
        matcher is FieldMatcher.Present -> "$target: present".takeIf { actual != null }
        actual == null -> "$target: absent"
        else -> valueFailure(target, matcher, actual)
    }

private fun valueFailure(
    target: String,
    matcher: FieldMatcher,
    actual: String,
): String? {
    val got = "got ${shown(actual)}"
    return when (matcher) {
        is FieldMatcher.Equals -> {
            "$target: expected ${quote(matcher.value)}, $got".takeUnless { actual == matcher.value }
        }

        is FieldMatcher.Contains -> {
            "$target: expected to contain ${quote(matcher.value)}, $got".takeUnless { matcher.value in actual }
        }

        is FieldMatcher.Matches -> {
            matcher.regex.matchFailure(target, actual, got)
        }

        is FieldMatcher.Present -> {
            null
        }
    }
}

private fun bodyFailure(
    matcher: BodyMatcher,
    input: MatchInput,
): String? =
    when (matcher) {
        is BodyMatcher.Equals -> {
            "body: expected ${quote(
                matcher.value,
            )}, got ${shown(input.body)}".takeUnless { input.body == matcher.value }
        }

        is BodyMatcher.Contains -> {
            "body: expected to contain ${quote(matcher.value)}".takeUnless { matcher.value in input.body }
        }

        is BodyMatcher.Matches -> {
            matcher.regex.matchFailure("body", input.body, got = null)
        }

        is BodyMatcher.JsonPathMatch -> {
            jsonPathFailure(matcher, input)
        }

        is BodyMatcher.EqualToJson -> {
            equalToJsonFailure(matcher, input.json)
        }
    }
