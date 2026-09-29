package anzol.rules

/**
 * O valor de cabeçalho da regra como vai ao fio, igual para o templado e o fixo: controles viram espaço
 * ([controlsAsSpaces]) e o que passa do ISO-8859-1 vira `?` ([latin1]).
 */
internal fun String.asHeaderValue(): String = controlsAsSpaces().latin1()

/** Controle (C0, DEL e C1), menos o HTAB, vira espaço. */
internal fun String.controlsAsSpaces(): String =
    String(CharArray(length) { i -> if (this[i] != '\t' && this[i].isISOControl()) ' ' else this[i] })

/** Cada caractere acima de U+00FF vira `?`; um par substituto (emoji) vira um só. */
internal fun String.latin1(): String {
    if (all { it <= LATIN1_LAST }) return this
    val out = StringBuilder(length)
    codePoints().forEach { out.append(if (it > LATIN1_LAST.code) '?' else it.toChar()) }
    return out.toString()
}

private const val LATIN1_LAST = '\u00FF'
