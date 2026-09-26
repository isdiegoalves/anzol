package site.webhook.rules

/**
 * Chave logo depois do fim de uma tag (`{{…}}` ou `{{{…}}}`) é texto, como espera quem escreve JSON
 * (`{"seq":{{seq}}}`); o Handlebars leria `}}}` como o fim de um `{{{` e recusaria o template. O fim
 * da tag ganha um comentário vazio depois (`}}{{!}}}`), que não sai na resposta. Texto entre aspas
 * dentro da tag é pulado; `{{{{…}}}}` e `{{!--…--}}` ficam como estão.
 */
fun separateClosingBraces(text: String): String {
    val out = StringBuilder()
    var from = 0
    var open = text.indexOf("{{")
    while (open >= 0) {
        val end = tagEnd(text, open) ?: break
        out.append(text, from, end)
        val mustache = !text.startsWith("{{{{", open) && !LONG_COMMENT.matchesAt(text, open)
        if (mustache && text.startsWith("}", end)) out.append("{{!}}")
        from = end
        open = text.indexOf("{{", end)
    }
    return out.append(text, from, text.length).toString()
}

private val LONG_COMMENT = Regex("""\{\{~?!--""")

/** `{{!`: o `--` de um comentário longo vem depois disto. */
private const val COMMENT_OPENING = 3

/** Posição logo depois do fechamento da tag aberta em [open]; `null` se ela não fecha. */
private fun tagEnd(
    text: String,
    open: Int,
): Int? {
    val closer =
        when {
            text.startsWith("{{{{", open) -> "}}}}"
            text.startsWith("{{{", open) -> "}}}"
            LONG_COMMENT.matchesAt(text, open) -> "--"
            else -> null
        }
    return when (closer) {
        null -> {
            simpleTagEnd(text, open + 2)
        }

        "--" -> {
            text
                .indexOf("--", open + COMMENT_OPENING)
                .takeIf { it >= 0 }
                ?.let { text.indexOf("}}", it) }
                ?.takeIf { it >= 0 }
                ?.plus(2)
        }

        else -> {
            text.indexOf(closer, open).takeIf { it >= 0 }?.plus(closer.length)
        }
    }
}

/** Fim de uma tag `{{…}}`, pulando texto entre aspas simples ou duplas. */
private fun simpleTagEnd(
    text: String,
    from: Int,
): Int? {
    var quote: Char? = null
    for (i in from until text.length) {
        val c = text[i]
        when {
            quote != null -> if (c == quote) quote = null
            c == '\'' || c == '"' -> quote = c
            text.startsWith("}}", i) -> return i + 2
        }
    }
    return null
}
