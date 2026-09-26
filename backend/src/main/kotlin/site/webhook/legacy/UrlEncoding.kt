package site.webhook.legacy

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.util.Locale

private const val UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
private const val HEX_RADIX = 16
private const val ESCAPE_LENGTH = 3
private const val BYTE_MASK = 0xFF

/** `urldecode`: `+` vira espaço, `%XX` válido vira byte, o resto fica literal. Um char por byte. */
fun urlDecode(text: String): String {
    val bytes = ByteArrayOutputStream(text.length)
    var i = 0
    while (i < text.length) {
        val char = text[i]
        val isEscape = char == '%' && i + 2 < text.length && text[i + 1].isHex() && text[i + 2].isHex()
        when {
            isEscape -> {
                bytes.write(text.substring(i + 1, i + ESCAPE_LENGTH).toInt(HEX_RADIX))
                i += ESCAPE_LENGTH
            }

            char == '+' -> {
                bytes.write(' '.code)
                i++
            }

            else -> {
                bytes.write(char.code)
                i++
            }
        }
    }
    return String(bytes.toByteArray(), ISO_8859_1)
}

private fun Char.isHex(): Boolean = this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

/**
 * `Request::normalizeQueryString` do Symfony 3.4: descarta pares vazios e sem nome, recodifica
 * cada parte com `rawurlencode(urldecode(...))` e ordena pelo nome decodificado
 * (`array_multisort`), desempatando pela parte já codificada.
 */
fun normalizeQueryString(rawQuery: String?): String {
    if (rawQuery.isNullOrEmpty()) return ""
    return rawQuery
        .split('&')
        .filter { it.isNotEmpty() && !it.startsWith('=') }
        .map { parameter ->
            val name = parameter.substringBefore('=')
            val part = if ('=' in parameter) "${rawUrlEncode(name)}=${rawUrlEncode(parameter.substringAfter('='))}" else rawUrlEncode(name)
            urlDecode(name) to part
        }.sortedWith { left, right -> phpCompare(left.first, right.first).takeIf { it != 0 } ?: phpCompare(left.second, right.second) }
        .joinToString("&") { it.second }
}

/** `rawurlencode(urldecode($encoded))`: só os não reservados da RFC 3986 ficam literais. */
private fun rawUrlEncode(encoded: String): String =
    urlDecode(encoded).toByteArray(ISO_8859_1).joinToString("") { byte ->
        val code = byte.toInt() and BYTE_MASK
        if (code.toChar() in UNRESERVED) code.toChar().toString() else "%%%02X".format(Locale.ROOT, code)
    }
