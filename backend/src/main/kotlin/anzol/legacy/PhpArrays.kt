package anzol.legacy

import java.nio.charset.StandardCharsets.ISO_8859_1

/**
 * Array do PHP como o `parse_str` monta: chaves na ordem de inserção, valores `String` ou
 * outro [PhpArray]. Chave inteira do PHP (`0`, `10`, `-5`) fica como a string equivalente.
 */
typealias PhpArray = LinkedHashMap<String, Any>

private const val NUL = '\u0000'

/**
 * `parse_str` / `$_GET` / `$_POST` do PHP 7.3 sobre bytes crus (`a.b=1` vira `a_b`, `a[]=1`
 * vira lista, a última ocorrência vence). O nome é tratado byte a byte, como no PHP; no fim,
 * chaves e valores viram UTF-8, com U+FFFD no lugar de bytes inválidos.
 */
fun parseStr(raw: ByteArray): PhpArray {
    val bytewise = PhpArray()
    String(raw, ISO_8859_1).split('&').filter { it.isNotEmpty() }.forEach { pair ->
        val separator = pair.indexOf('=')
        val name = if (separator < 0) pair else pair.substring(0, separator)
        val value = if (separator < 0) "" else pair.substring(separator + 1)
        bytewise.register(urlDecode(name), urlDecode(value))
    }
    return bytewise.latin1ToUtf8()
}

/** `php_register_variable_ex`: aplica um par nome/valor com a gramática de colchetes do PHP. */
fun PhpArray.register(
    rawName: String,
    value: String,
) {
    val name = rawName.trimStart(' ').substringBefore(NUL).toCharArray()
    var position = 0
    var isArray = false
    while (position < name.size) {
        when (name[position]) {
            ' ', '.' -> {
                name[position] = '_'
            }

            '[' -> {
                isArray = true
                name[position] = NUL
                break
            }
        }
        position++
    }
    if (position == 0) return
    if (!isArray) {
        this[String(name, 0, position)] = value
        return
    }
    registerLevel(name, bracket = position, indexStart = 0, value = value)
}

/**
 * Um nível `[índice]`. `bracket` é a posição do `[` (já trocado por NUL, como no C do PHP);
 * `indexStart` é onde começa o índice corrente em `name`, ou null para `[]` (próximo livre).
 */
private fun PhpArray.registerLevel(
    name: CharArray,
    bracket: Int,
    indexStart: Int?,
    value: String,
) {
    val nextStart = bracket + 1
    val cursor = if (nextStart < name.size && name[nextStart] == ' ') nextStart + 1 else nextStart
    val isEmptyIndex = cursor < name.size && name[cursor] == ']'
    val close = if (isEmptyIndex) cursor else name.indexOf(']', cursor)
    if (close < 0) {
        // Sem `]`: o PHP troca o `[` por `_` e usa o índice corrente como chave simples.
        name[bracket] = '_'
        put(indexStart?.let { cString(name, it) }, value)
        return
    }
    val nextIndexStart = if (isEmptyIndex) null else nextStart.also { name[close] = NUL }
    val child = childArray(indexStart?.let { cString(name, it) })
    val after = close + 1
    if (after < name.size && name[after] == '[') {
        name[after] = NUL
        child.registerLevel(name, after, nextIndexStart, value)
    } else {
        child.put(nextIndexStart?.let { cString(name, it) }, value)
    }
}

private fun CharArray.indexOf(
    char: Char,
    from: Int,
): Int = (from until size).firstOrNull { this[it] == char } ?: -1

private fun cString(
    chars: CharArray,
    start: Int,
): String {
    val end = chars.indexOf(NUL, start)
    return String(chars, start, (if (end < 0) chars.size else end) - start)
}

private fun PhpArray.put(
    index: String?,
    value: Any,
) {
    this[index ?: nextIndex()] = value
}

@Suppress("UNCHECKED_CAST")
private fun PhpArray.childArray(index: String?): PhpArray {
    val key = index ?: nextIndex()
    val existing = this[key]
    if (existing is LinkedHashMap<*, *>) return existing as PhpArray
    return PhpArray().also { this[key] = it }
}

private fun PhpArray.nextIndex(): String = ((keys.mapNotNull { it.toPhpIntegerKey() }.filter { it >= 0 }.maxOrNull() ?: -1) + 1).toString()

private fun String.toPhpIntegerKey(): Long? = if (this == "0" || matches(Regex("-?[1-9]\\d*"))) toLongOrNull() else null
