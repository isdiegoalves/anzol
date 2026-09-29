package anzol.schema

import anzol.rules.RegexOutcome
import anzol.rules.evaluate
import com.networknt.schema.Error
import com.networknt.schema.regex.RegularExpression
import com.networknt.schema.regex.RegularExpressionFactory
import com.networknt.schema.regex.RegularExpressions
import java.util.regex.Pattern

/** A mensagem do erro de `pattern` que passou do teto (no lugar da "does not match" da biblioteca). */
const val PATTERN_TIMED_OUT = "pattern evaluation timed out"

private const val PATTERN_KEYWORD = "pattern"

/** Um `pattern` e o valor em que ele passou do teto. */
internal data class TimedOut(
    val pattern: String,
    val value: String,
)

/**
 * Os `pattern` que passaram do teto na validação em curso nesta thread. A biblioteca só pergunta "casa?" à regex e
 * monta o erro sozinha; é por aqui que a validação sabe quais desses erros foram estouro.
 */
private val timeouts = ThreadLocal<MutableSet<TimedOut>>()

/**
 * As regex do `pattern` (e de `patternProperties`) no motor do JDK, como o [com.networknt.schema.regex.JDKRegularExpressionFactory]
 * (mesma tradução de `$` e das propriedades Unicode, busca sem âncoras), com o teto de cada avaliação. Passou do teto:
 * "não casa", anotado em [timeouts].
 */
object TimedRegularExpressionFactory : RegularExpressionFactory {
    override fun getRegularExpression(regex: String): RegularExpression {
        val pattern =
            Pattern.compile(RegularExpressions.replaceLongformCharacterProperties(RegularExpressions.replaceDollarAnchors(regex)))
        return RegularExpression { value ->
            when (pattern.evaluate(value, find = true)) {
                RegexOutcome.MATCHED -> true
                RegexOutcome.UNMATCHED -> false
                RegexOutcome.TIMED_OUT -> false.also { timeouts.get()?.add(TimedOut(regex, value)) }
            }
        }
    }
}

/** Roda a validação [block] anotando os `pattern` que passam do teto; devolve o resultado e as anotações. */
internal fun <T> withPatternTimeouts(block: () -> T): Pair<T, Set<TimedOut>> {
    val seen = mutableSetOf<TimedOut>()
    timeouts.set(seen)
    try {
        return block() to seen
    } finally {
        timeouts.remove()
    }
}

/** O erro de `pattern` de um valor em que a avaliação passou do teto (e não de um valor que só não casou). */
internal fun Error.isTimedOutPattern(timedOut: Set<TimedOut>): Boolean {
    val pattern = arguments?.firstOrNull() as? String
    val value = instanceNode?.takeIf { it.isString }?.stringValue()
    return keyword == PATTERN_KEYWORD && pattern != null && value != null && TimedOut(pattern, value) in timedOut
}
