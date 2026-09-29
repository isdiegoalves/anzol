package anzol.legacy

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets.ISO_8859_1

/** `FILLUNIT` do `rfc1867.c`: o PHP lê o corpo em blocos de 5 KB, e o bloco aparece no resultado. */
private const val FILL_UNIT = 5 * 1024

/** `boundary_len + 6`: o buffer cresce além de 5 KB só para caber um boundary enorme. */
private const val BOUNDARY_SLACK = 6

/** `max_input_vars` do php.ini do app antigo (padrão): campos de texto além disso são ignorados. */
private const val MAX_INPUT_VARS = 1000

private const val LF = '\n'.code.toByte()
private const val CR = '\r'.code.toByte()

/** O `$_POST` de um multipart e o que sobrou no corpo para `php://input` quando o PHP desistiu no meio. */
class PhpMultipart(
    val fields: PhpArray,
    val unread: ByteArray,
)

/**
 * O boundary como o `rfc1867_post_handler` do PHP 7.3 o acha: a primeira ocorrência de `boundary`
 * (com caixa; senão sem caixa, e vale dentro de `xboundary`), o primeiro `=` depois dela, e o valor
 * até `,` ou `;` — ou entre aspas. `null` quando o PHP desiste ("Missing boundary" ou aspas sem fechar)
 * e deixa o corpo cru em `php://input`.
 */
fun phpMultipartBoundary(contentType: String): String? {
    val at = contentType.indexOf("boundary").takeIf { it >= 0 } ?: contentType.indexOf("boundary", ignoreCase = true)
    val equals = if (at < 0) -1 else contentType.indexOf('=', at)
    val value = if (equals < 0) null else contentType.substring(equals + 1)
    return when {
        value == null -> null
        !value.startsWith('"') -> value.substringBefore(',').substringBefore(';')
        else -> value.indexOf('"', 1).takeIf { it > 0 }?.let { value.substring(1, it) }
    }
}

/**
 * `$_POST` de um `multipart/form-data` pelo `rfc1867.c` do PHP 7.3, com a mesma tolerância: linhas
 * só LF, preâmbulo, boundary final ausente, cabeçalho sem linha vazia. Só campos de texto; partes
 * com `filename` são arquivos e são descartadas. Nomes seguem a gramática de colchetes do PHP.
 * O PHP pula sem ler o arquivo além do 20º (`max_file_uploads`) ou de nome com colchete torto; aqui
 * todo arquivo é lido e descartado, o que só mudaria o resultado num corpo montado para isso.
 */
fun parseMultipart(
    body: ByteArray,
    boundary: String,
): PhpMultipart {
    val buffer = MultipartBuffer(body, boundary)
    val fields = Rfc1867(buffer).parse()
    return PhpMultipart(fields.latin1ToUtf8(), body.copyOfRange(buffer.consumed, body.size))
}

/** O laço de `rfc1867_post_handler`: parte a parte até o fim do corpo ou até o PHP desistir. */
private class Rfc1867(
    private val buffer: MultipartBuffer,
) {
    private val fields = PhpArray()
    private var textFields = 0

    fun parse(): PhpArray {
        var more = true
        while (more) more = !buffer.eof() && nextPart()
        return fields
    }

    /** `false` quando o PHP para: nenhum boundary adiante, ou parte sem `name` e sem `filename`. */
    private fun nextPart(): Boolean {
        val headers = buffer.headers() ?: return false
        return headers.valueOf("Content-Disposition")?.let { readPart(dispositionParams(it)) } ?: true
    }

    private fun readPart(params: Pair<String?, String?>): Boolean {
        val (name, filename) = params
        when {
            filename != null -> if (filename.isNotEmpty()) buffer.readBody()
            name != null -> readText(name)
        }
        return name != null || filename != null
    }

    private fun readText(name: String) {
        val value = buffer.readBody()
        textFields++
        if (textFields <= MAX_INPUT_VARS) fields.register(name, String(value, ISO_8859_1))
    }
}

/**
 * O `multipart_buffer` do PHP sobre o corpo já lido: `start` é o `buf_begin` e `consumed` o que
 * já saiu do "socket". O buffer de [FILL_UNIT] importa: linha sem LF que não cabe nele é cortada, e
 * o que não foi lido quando o PHP desiste fica em `php://input`.
 */
private class MultipartBuffer(
    private val body: ByteArray,
    boundary: String,
) {
    private val capacity = maxOf(boundary.length + BOUNDARY_SLACK, FILL_UNIT)
    private val delimiter = "--$boundary"
    private val nextDelimiter = "\n--$boundary".toByteArray(ISO_8859_1)
    private var start = 0
    var consumed = 0
        private set

    private val buffered get() = consumed - start

    private fun fill(): Int {
        val before = consumed
        consumed = minOf(body.size, start + capacity)
        return consumed - before
    }

    fun eof(): Boolean = buffered == 0 && fill() < 1

    /** `multipart_buffer_headers`: acha o boundary e lê os cabeçalhos até a linha vazia ou o fim. */
    fun headers(): List<Pair<String, StringBuilder>>? {
        if (generateSequence(::getLine).none { it == delimiter }) return null
        val headers = mutableListOf<Pair<String, StringBuilder>>()
        generateSequence(::getLine).takeWhile { it.isNotEmpty() }.forEach { line ->
            val colon = if (line.first().isCSpace()) -1 else line.indexOf(':')
            when {
                colon >= 0 -> headers += line.substring(0, colon) to StringBuilder(line.substring(colon + 1).trimStart { it.isCSpace() })
                headers.isNotEmpty() -> headers.last().second.append(line)
            }
        }
        return headers
    }

    /** `multipart_buffer_read_body`: tudo até o próximo `\n--boundary` (ou o começo dele no fim do corpo). */
    fun readBody(): ByteArray {
        val out = ByteArrayOutputStream()
        generateSequence { read().takeIf { it.isNotEmpty() } }.forEach(out::writeBytes)
        return out.toByteArray()
    }

    /** `multipart_buffer_read`: até um bloco, parando antes do boundary e deixando o CR dele no buffer. */
    private fun read(): ByteArray {
        if (FILL_UNIT > buffered) fill()
        val bound = (start until consumed).firstOrNull(::startsDelimiter)
        var length = minOf(if (bound == null) buffered else bound - start, FILL_UNIT - 1)
        if (length > 0 && bound != null && body[start + length - 1] == CR) length--
        val chunk = body.copyOfRange(start, start + maxOf(length, 0))
        start += chunk.size
        return chunk
    }

    /** `php_ap_memstr` com `partial`: casa também o começo do delimitador no fim do buffer. */
    private fun startsDelimiter(at: Int): Boolean {
        val comparable = minOf(nextDelimiter.size, consumed - at)
        return (0 until comparable).all { body[at + it] == nextDelimiter[it] }
    }

    private fun getLine(): String? = nextLine() ?: fill().let { nextLine() }

    /** `next_line`: linha terminada em LF (CR antes dele sai); buffer cheio sem LF vira uma linha. */
    private fun nextLine(): String? {
        val lf = (start until consumed).firstOrNull { body[it] == LF }
        val end =
            when {
                lf != null -> if (lf > start && body[lf - 1] == CR) lf - 1 else lf
                buffered < capacity -> return null
                else -> consumed
            }
        val line = String(body, start, end - start, ISO_8859_1).substringBefore('\u0000')
        start = if (lf != null) lf + 1 else consumed
        return line
    }
}

private fun List<Pair<String, StringBuilder>>.valueOf(name: String): String? =
    firstOrNull { it.first.equals(name, ignoreCase = true) }?.second?.toString()

/** `name` e `filename` do `Content-Disposition`, como o laço de `php_ap_getword` os separa. */
private fun dispositionParams(disposition: String): Pair<String?, String?> {
    var name: String? = null
    var filename: String? = null
    var rest = disposition.trimStart { it.isCSpace() }
    while (rest.isNotEmpty()) {
        val (pair, after) = getword(rest, ';')
        rest = after.trimStart { it.isCSpace() }
        val (key, value) = getword(pair, '=')
        when {
            '=' !in pair -> Unit
            key.equals("name", ignoreCase = true) -> name = getwordConf(value)
            key.equals("filename", ignoreCase = true) -> filename = getwordConf(value)
        }
    }
    return name to filename
}

/** `php_ap_getword`: até `stop` fora de aspas; o resto começa depois de todos os `stop` seguidos. */
private fun getword(
    line: String,
    stop: Char,
): Pair<String, String> {
    var position = 0
    while (position < line.length && line[position] != stop) {
        position = if (line[position] == '"' || line[position] == '\'') afterQuoted(line, position) else position + 1
    }
    return if (position == line.length) line to "" else line.substring(0, position) to line.substring(position).trimStart(stop)
}

private fun afterQuoted(
    line: String,
    open: Int,
): Int {
    val quote = line[open]
    var position = open + 1
    while (position < line.length && line[position] != quote) {
        position += if (line[position] == '\\' && line.getOrNull(position + 1) == quote) 2 else 1
    }
    return if (position < line.length) position + 1 else position
}

/** `php_ap_getword_conf`: valor entre aspas (com `\` escapando a aspa e a barra) ou até o primeiro espaço. */
private fun getwordConf(raw: String): String {
    val value = raw.trimStart { it.isCSpace() }
    val quote = value.firstOrNull()?.takeIf { it == '"' || it == '\'' }
    return if (quote != null) substringConf(value.substring(1), quote) else substringConf(value.takeWhile { !it.isCSpace() }, null)
}

private fun substringConf(
    value: String,
    quote: Char?,
): String {
    val escapable = setOfNotNull('\\', quote)
    val out = StringBuilder()
    var position = 0
    while (position < value.length && value[position] != quote) {
        if (value[position] == '\\' && value.getOrNull(position + 1) in escapable) position++
        out.append(value[position])
        position++
    }
    return out.toString()
}

/** `isspace` do C: espaço, `\t`, `\n`, `\v`, `\f`, `\r`. */
private fun Char.isCSpace(): Boolean = this == ' ' || this in '\t'..'\r'
