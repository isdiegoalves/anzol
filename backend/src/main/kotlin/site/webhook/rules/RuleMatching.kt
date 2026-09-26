package site.webhook.rules

/** Uma condição da regra, na ordem em que o `failed` as lista: método, caminho, query, cabeçalhos, corpo. */
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

    data class Header(
        val name: String,
        val matcher: FieldMatcher,
    ) : Condition

    data class Body(
        val matcher: BodyMatcher,
    ) : Condition
}

fun RuleMatch.conditions(): List<Condition> =
    listOfNotNull(
        Condition.Method(method).takeIf { method.isNotEmpty() },
        path?.let(Condition::Path),
    ) +
        query.map { (name, matcher) -> Condition.Query(name, matcher) } +
        headers.map { (name, matcher) -> Condition.Header(name.lowercase().replace('_', '-'), matcher) } +
        body.map(Condition::Body)

/** Uma frase por condição que falhou; vazia quando a regra casa (sem olhar `enabled`). */
fun Rule.failures(input: MatchInput): List<String> = match.conditions().mapNotNull { it.failure(input) }

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
 * Nenhuma casou: o near miss é a de menos falhas, com o mesmo desempate.
 */
fun List<Rule>.decide(input: MatchInput): Decision {
    val evaluated = filter { it.enabled }.sortedBy { it.priority }.map { it to it.failures(input) }
    val matched = evaluated.firstOrNull { (_, failed) -> failed.isEmpty() }
    if (matched != null) return Decision.Matched(matched.first)
    val closest = evaluated.minByOrNull { (_, failed) -> failed.size }
    return Decision.Unmatched(closest?.let { (rule, failed) -> NearMiss(rule.id, rule.name, failed) })
}

private fun Condition.failure(input: MatchInput): String? =
    when (this) {
        is Condition.Method -> methodFailure(input.method)
        is Condition.Path -> pathFailure(matcher, input.path)
        is Condition.Query -> fieldFailure("query $name", matcher, input.query[name])
        is Condition.Header -> fieldFailure("header $name", matcher, input.headers[name])
        is Condition.Body -> bodyFailure(matcher, input)
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
            "path: expected to match ${quote(
                matcher.regex.pattern,
            )}, $got".takeUnless { matcher.regex.matches(actual) }
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
            "$target: expected to match ${quote(
                matcher.regex.pattern,
            )}, $got".takeUnless { matcher.regex.matches(actual) }
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
            "body: expected to match ${quote(matcher.regex.pattern)}".takeUnless { matcher.regex.matches(input.body) }
        }

        is BodyMatcher.JsonPathMatch -> {
            jsonPathFailure(matcher, input)
        }

        is BodyMatcher.EqualToJson -> {
            equalToJsonFailure(matcher, input.json)
        }
    }
