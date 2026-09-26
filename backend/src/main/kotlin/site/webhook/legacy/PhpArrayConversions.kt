package site.webhook.legacy

import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.JsonNodeFactory
import java.nio.charset.StandardCharsets.ISO_8859_1
import java.nio.charset.StandardCharsets.UTF_8

/** Chaves e valores de um [PhpArray] montado byte a byte, reinterpretados como UTF-8. */
fun PhpArray.latin1ToUtf8(): PhpArray =
    entries.associateTo(PhpArray()) { (key, value) ->
        @Suppress("UNCHECKED_CAST")
        val decoded: Any = if (value is String) value.latin1ToUtf8() else (value as PhpArray).latin1ToUtf8()
        key.latin1ToUtf8() to decoded
    }

/** Reinterpreta os bytes de uma string ISO-8859-1 como UTF-8 (bytes inválidos viram U+FFFD). */
fun String.latin1ToUtf8(): String = String(toByteArray(ISO_8859_1), UTF_8)

/** `json_encode` de um array PHP: lista quando as chaves são 0..n-1 em ordem, objeto nos outros casos. */
fun PhpArray.toJson(): JsonNode {
    val factory = JsonNodeFactory.instance
    val isList = keys.withIndex().all { (position, key) -> key == position.toString() }
    return if (isList) {
        factory.arrayNode().apply { values.forEach { add(it.toJsonValue()) } }
    } else {
        factory.objectNode().apply { this@toJson.forEach { (key, value) -> set(key, value.toJsonValue()) } }
    }
}

@Suppress("UNCHECKED_CAST")
private fun Any.toJsonValue(): JsonNode = if (this is String) JsonNodeFactory.instance.stringNode(this) else (this as PhpArray).toJson()
