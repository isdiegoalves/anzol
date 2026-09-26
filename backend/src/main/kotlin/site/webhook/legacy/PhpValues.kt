package site.webhook.legacy

import java.math.BigInteger

/*
 * Semântica de conversão do PHP 7.3 que o app antigo aplica à entrada do usuário.
 * Os valores chegam como o Jackson ou o parse_str os entregam: String, Number, Boolean,
 * null, List ou Map.
 */

private const val PHP_WHITESPACE = " \t\n\r\u000B\u000C"
private val NUMERIC_PREFIX = Regex("^[$PHP_WHITESPACE]*([+-]?(\\d+(\\.\\d*)?|\\.\\d+)([eE][+-]?\\d+)?)")
private val NUMERIC_STRING = Regex("^[$PHP_WHITESPACE]*[+-]?(\\d+(\\.\\d*)?|\\.\\d+)([eE][+-]?\\d+)?$")
private val DECIMAL_INTEGER = Regex("^[+-]?(0|[1-9]\\d*)$")
private const val FILTER_TRIM = " \t\r\u000B\n"
private const val LARGEST_PRINTED_AS_INTEGER = 1e15

/** `(int) $value`. */
fun phpIntval(value: Any?): Long =
    when (value) {
        null -> 0
        is Boolean -> if (value) 1 else 0
        is Double -> value.toLong()
        is Float -> value.toLong()
        is Number -> value.toLong()
        is String -> stringIntval(value)
        is Collection<*> -> if (value.isEmpty()) 0 else 1
        is Map<*, *> -> if (value.isEmpty()) 0 else 1
        else -> 0
    }

private fun stringIntval(value: String): Long {
    val number = NUMERIC_PREFIX.find(value)?.groupValues?.get(1) ?: return 0
    val isInteger = number.none { it == '.' || it == 'e' || it == 'E' }
    return if (isInteger) number.toLongOrNull() ?: number.toDouble().toLong() else number.toDouble().toLong()
}

/** `is_numeric($value)` do PHP 7 (sem espaço à direita). */
fun isPhpNumeric(value: Any?): Boolean =
    when (value) {
        is Number -> true
        is String -> NUMERIC_STRING.matches(value)
        else -> false
    }

/**
 * `filter_var($value, FILTER_VALIDATE_INT) !== false`, a regra `integer` do Laravel 5.4. Inteiro
 * JSON fora de 64 bits (o Jackson entrega `BigInteger`) vira float no `json_decode` e é recusado.
 */
fun isPhpInteger(value: Any?): Boolean =
    when (value) {
        true -> true
        is Double -> value % 1.0 == 0.0 && kotlin.math.abs(value) < LARGEST_PRINTED_AS_INTEGER
        is Float -> isPhpInteger(value.toDouble())
        is BigInteger -> value.bitLength() < Long.SIZE_BITS
        is Number -> true
        is String -> value.trim { it in FILTER_TRIM }.let { DECIMAL_INTEGER.matches(it) && it.toLongOrNull() != null }
        else -> false
    }

/** Tamanho que as regras `min`/`max` comparam quando o atributo também é `integer`. */
fun phpNumericSize(value: Any?): Double =
    when {
        isPhpNumeric(value) -> value.toString().trim { it in PHP_WHITESPACE }.toDouble()
        value is Collection<*> -> value.size.toDouble()
        value is Map<*, *> -> value.size.toDouble()
        value == true -> 1.0
        value is String -> value.codePointCount(0, value.length).toDouble()
        else -> 0.0
    }

/** Comparação `SORT_REGULAR` do PHP 7 entre duas strings: numérica se as duas forem numéricas. */
fun phpCompare(
    left: String,
    right: String,
): Int =
    if (isPhpNumeric(left) && isPhpNumeric(right)) {
        phpNumericSize(left).compareTo(phpNumericSize(right))
    } else {
        left.compareTo(right)
    }

/**
 * `Collection::forPage($page, $perPage)` do Laravel 5.4, ou seja,
 * `array_slice($items, ($page - 1) * $perPage, $perPage)` com os casos de borda do PHP
 * (deslocamento e tamanho negativos contam a partir do fim).
 */
fun <T> List<T>.phpForPage(
    page: Long,
    perPage: Long,
): List<T> {
    val count = size.toLong()
    val requestedOffset = (page - 1) * perPage
    if (requestedOffset > count) return emptyList()
    val offset = if (requestedOffset < 0) maxOf(0, count + requestedOffset) else requestedOffset
    val length = if (perPage < 0) count - offset + perPage else minOf(perPage, count - offset)
    return if (length <= 0) emptyList() else subList(offset.toInt(), (offset + length).toInt())
}
