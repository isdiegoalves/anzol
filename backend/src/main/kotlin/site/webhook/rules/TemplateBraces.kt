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

/**
 * `null` quando blocos e subexpressões aninham até [MAX_TEMPLATE_NESTING] níveis; senão o motivo, com linha
 * e coluna da tag que passou do teto. Conferido antes de compilar: o parser do Handlebars é recursivo e, sem
 * isso, estoura a pilha (`StackOverflowError`, 500) em vez de recusar. Cada `{{else …}}` com helper
 * (`{{else if x}}`) conta um nível, porque o Handlebars o monta como um bloco dentro do anterior.
 */
fun nestingError(text: String): String? {
    val blocks = ArrayDeque<Int>()
    var open = text.indexOf("{{")
    var end = open.takeIf { it >= 0 }?.let { tagEnd(text, it) }
    while (end != null) {
        val tag = text.substring(open, end)
        when (tagKind(tag)) {
            TagKind.OPEN -> blocks.addLast(1)
            TagKind.CHAINED_ELSE -> blocks.removeLastOrNull()?.let { blocks.addLast(it + 1) }
            TagKind.CLOSE -> blocks.removeLastOrNull()
            TagKind.OTHER -> Unit
        }
        val reason =
            when {
                blocks.sum() > MAX_TEMPLATE_NESTING -> "blocks nested more than $MAX_TEMPLATE_NESTING levels deep"
                subexpressionDepth(tag) > MAX_TEMPLATE_NESTING -> "subexpressions nested more than $MAX_TEMPLATE_NESTING levels deep"
                else -> null
            }
        if (reason != null) return "$reason (${position(text, open)})"
        open = text.indexOf("{{", end)
        end = open.takeIf { it >= 0 }?.let { tagEnd(text, it) }
    }
    return null
}

private enum class TagKind { OPEN, CHAINED_ELSE, CLOSE, OTHER }

/** `{{#x}}`/`{{^x}}` abre bloco, `{{/x}}` fecha, `{{else x}}` encadeia; `{{{{raw}}}}` e comentários não contam. */
private fun tagKind(tag: String): TagKind {
    if (tag.startsWith("{{{{")) return TagKind.OTHER
    val inside =
        tag
            .removePrefix("{{")
            .removePrefix("{")
            .removePrefix("~")
            .trimStart()
    val rest =
        inside
            .drop(1)
            .removeSuffix("}}")
            .removeSuffix("}")
            .removeSuffix("~")
            .trim()
    return when {
        inside.startsWith("#") -> TagKind.OPEN
        inside.startsWith("^") -> if (rest.isEmpty()) TagKind.OTHER else TagKind.OPEN
        inside.startsWith("/") -> TagKind.CLOSE
        CHAINED_ELSE.matchesAt(inside, 0) -> TagKind.CHAINED_ELSE
        else -> TagKind.OTHER
    }
}

private val CHAINED_ELSE = Regex("""else\s+[^\s~}]""")

/** Maior profundidade de parênteses da tag, fora de texto entre aspas; comentário conta zero. */
private fun subexpressionDepth(tag: String): Int {
    if (tag.startsWith("{{!") || tag.startsWith("{{~!") || tag.startsWith("{{{{")) return 0
    var quote: Char? = null
    var depth = 0
    var deepest = 0
    for (c in tag) {
        when {
            quote != null -> if (c == quote) quote = null
            c == '\'' || c == '"' -> quote = c
            c == '(' -> deepest = maxOf(deepest, ++depth)
            c == ')' -> depth--
        }
    }
    return deepest
}

/** "line L, column C" de [offset], como nas mensagens do Handlebars. */
private fun position(
    text: String,
    offset: Int,
): String {
    val line = text.substring(0, offset).count { it == '\n' } + 1
    val column = offset - (text.lastIndexOf('\n', offset - 1) + 1) + 1
    return "line $line, column $column"
}
