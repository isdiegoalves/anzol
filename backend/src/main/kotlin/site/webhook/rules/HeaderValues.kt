package site.webhook.rules

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
