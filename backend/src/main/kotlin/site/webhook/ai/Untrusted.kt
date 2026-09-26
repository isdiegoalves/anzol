package site.webhook.ai

import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets.UTF_8
import java.util.UUID

/** O trecho do corpo que vai ao modelo e aos fatos, em bytes UTF-8. */
const val MAX_BODY_EXCERPT = 4096

/** Cada valor de cabeçalho mostrado ao modelo, em caracteres. */
const val MAX_HEADER_VALUE = 200

/**
 * Conteúdo de terceiros (cabeçalhos e corpo de uma mensagem capturada) entre marcadores com um código novo a cada
 * chamada: um corpo que escreva o marcador de fim não sai do bloco, porque não sabe o código.
 */
fun delimited(untrusted: String): String {
    val nonce = UUID.randomUUID().toString().take(8)
    return "<<<UNTRUSTED_MESSAGE $nonce\n$untrusted\n$nonce UNTRUSTED_MESSAGE>>>"
}

/** O começo do texto que cabe em [maxBytes] bytes UTF-8, sem partir um caractere. */
fun String.utf8Prefix(maxBytes: Int): String {
    if (length <= maxBytes / UTF8_MAX_BYTES_PER_CHAR) return this
    val output = ByteBuffer.allocate(maxBytes)
    UTF_8
        .newEncoder()
        .onMalformedInput(CodingErrorAction.REPLACE)
        .onUnmappableCharacter(CodingErrorAction.REPLACE)
        .encode(CharBuffer.wrap(this), output, true)
    return String(output.array(), 0, output.position(), UTF_8)
}

/** Um `char` do Java (UTF-16) ocupa no máximo 3 bytes em UTF-8 (o par substituto, 4 bytes em 2 `char`s). */
private const val UTF8_MAX_BYTES_PER_CHAR = 3
