package anzol.rules

import java.time.Duration
import java.util.concurrent.CancellationException
import java.util.regex.Pattern

/**
 * Teto de cada avaliação de uma regex das condições (regras, busca, wait-for, trace, `rules/test`) ou de um `pattern`
 * de JSON Schema: um valor contra um padrão. A regex catastrófica (`((a+)*)+$`, `(.*a){12}`) com um valor feito para
 * ela prenderia a thread por minutos; passou do teto, a avaliação para e conta como "não casou".
 */
val MAX_REGEX_TIME: Duration = Duration.ofMillis(100)

/** Quantas leituras do texto entre duas conferências do relógio. */
private const val CHECK_EVERY = 1024

/** O fim da frase do `failed` quando a regex passou do teto. */
const val REGEX_TIMED_OUT = "regex timed out"

/**
 * Os padrões que já passaram do teto na requisição em curso nesta thread (texto e flags). Dentro de uma requisição, o
 * padrão que estourou uma vez vale "timed out" na hora nas avaliações seguintes, sem rodar de novo: o custo fica em
 * cerca de [MAX_REGEX_TIME] por padrão distinto, e não por mensagem (um `rules/test` sobre 500 mensagens pagaria 50 s).
 */
private val timedOutPatterns = ThreadLocal<MutableSet<String>>()

/**
 * Roda [block] como uma requisição: os padrões que estouram nele não rodam de novo até ele acabar. Aninhado, vale o
 * escopo de fora.
 */
fun <T> withRegexMemo(block: () -> T): T {
    if (timedOutPatterns.get() != null) return block()
    timedOutPatterns.set(mutableSetOf())
    try {
        return block()
    } finally {
        timedOutPatterns.remove()
    }
}

private fun Pattern.memoKey(): String = "${flags()}:${pattern()}"

/** O resultado de uma avaliação com teto. */
enum class RegexOutcome {
    MATCHED,
    UNMATCHED,
    TIMED_OUT,
}

/**
 * O texto como o motor de regex do JDK o lê (só por `charAt` e `length`), conferindo o prazo a cada [CHECK_EVERY]
 * leituras: passou de [deadline] (`System.nanoTime()`), a leitura lança [CancellationException], que interrompe a
 * avaliação na própria thread. Nada fica rodando depois.
 */
private class TimedText(
    private val text: CharSequence,
    private val deadline: Long,
) : CharSequence {
    private var reads = 0

    override val length: Int get() = text.length

    override fun get(index: Int): Char {
        reads++
        if (reads % CHECK_EVERY == 0 && System.nanoTime() - deadline > 0) throw CancellationException(REGEX_TIMED_OUT)
        return text[index]
    }

    override fun subSequence(
        startIndex: Int,
        endIndex: Int,
    ): CharSequence = TimedText(text.subSequence(startIndex, endIndex), deadline)

    override fun toString(): String = text.toString()
}

/**
 * O padrão contra [input] com o teto de [MAX_REGEX_TIME] e a memória da requisição ([withRegexMemo]): o valor
 * inteiro ([find] falso, como as condições) ou um trecho dele ([find] verdadeiro, como o `pattern` do JSON Schema).
 */
fun Pattern.evaluate(
    input: CharSequence,
    find: Boolean = false,
): RegexOutcome {
    val memo = timedOutPatterns.get()
    if (memo != null && memoKey() in memo) return RegexOutcome.TIMED_OUT
    val matcher = matcher(TimedText(input, System.nanoTime() + MAX_REGEX_TIME.toNanos()))
    return try {
        if (if (find) matcher.find() else matcher.matches()) RegexOutcome.MATCHED else RegexOutcome.UNMATCHED
    } catch (_: CancellationException) {
        memo?.add(memoKey())
        RegexOutcome.TIMED_OUT
    }
}

/**
 * A frase do `failed` de uma condição de regex sobre [target], ou `null` quando casa: `expected to match "<padrão>"`,
 * seguida do recebido ([got], quando a condição o mostra) ou de [REGEX_TIMED_OUT] quando a avaliação passou do teto.
 */
fun Regex.matchFailure(
    target: String,
    actual: String,
    got: String?,
): String? {
    val expected = "$target: expected to match ${quote(pattern)}"
    return when (toPattern().evaluate(actual)) {
        RegexOutcome.MATCHED -> null
        RegexOutcome.UNMATCHED -> if (got == null) expected else "$expected, $got"
        RegexOutcome.TIMED_OUT -> "$expected, $REGEX_TIMED_OUT"
    }
}
