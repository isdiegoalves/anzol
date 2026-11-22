package anzol.defense.lab

import anzol.UUID_PATTERN
import anzol.rules.Parsed
import java.util.Optional

private val REQUEST_ID = Regex(UUID_PATTERN)

/** A semente do pedido: ausente sorteia; presente, um inteiro de 0 a [MAX_SEED] (422 em `seed`). */
fun readSeed(given: Any?): Parsed<Optional<Long>> {
    val seed = (given as? Number)?.takeIf { it.toDouble() == it.toLong().toDouble() && it.toLong() in 0..MAX_SEED }?.toLong()
    return if (given != null && seed == null) {
        Parsed.Invalid(mapOf("seed" to listOf("The seed must be an integer between 0 and $MAX_SEED.")))
    } else {
        Parsed.Valid(Optional.ofNullable(seed))
    }
}

/** A lista de veredictos do pedido, com os erros sob `verdicts.N.campo`. */
fun readVerdicts(input: Any?): Parsed<List<Pair<String, Verdict>>> {
    val items = input as? List<*> ?: return Parsed.Invalid(mapOf("verdicts" to listOf("The verdicts must be a list.")))
    val errors = items.flatMapIndexed { index, item -> verdictErrors(index, item as? Map<*, *>) }.toMap()
    return if (errors.isEmpty()) Parsed.Valid(items.filterIsInstance<Map<*, *>>().map(::verdictOf)) else Parsed.Invalid(errors)
}

/** Um item já validado por [verdictErrors]. */
private fun verdictOf(item: Map<*, *>): Pair<String, Verdict> {
    val verdict = checkNotNull(VerdictKind.of(item["verdict"].toString()))
    return item["request_id"].toString() to Verdict(verdict, (item["family"] as? String)?.let(DefenseFamily::of))
}

private fun verdictErrors(
    index: Int,
    item: Map<*, *>?,
): List<Pair<String, List<String>>> {
    if (item == null) return listOf("verdicts.$index" to listOf("The verdict must be an object."))
    val requestId = item["request_id"]
    val verdict = item["verdict"]
    val family = item["family"]
    return listOfNotNull(
        ("verdicts.$index.request_id" to listOf("The request_id must be a request UUID."))
            .takeIf { requestId !is String || !REQUEST_ID.matches(requestId) },
        ("verdicts.$index.verdict" to listOf("The verdict must be legitimate or attack."))
            .takeIf { verdict !is String || VerdictKind.of(verdict) == null },
        ("verdicts.$index.family" to listOf("The selected family is invalid."))
            .takeIf { family != null && (family !is String || DefenseFamily.of(family) == null) },
    )
}
