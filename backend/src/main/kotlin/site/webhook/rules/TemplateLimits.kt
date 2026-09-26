package site.webhook.rules

import com.github.jknack.handlebars.Context
import com.github.jknack.handlebars.Options
import com.github.jknack.handlebars.Template
import tools.jackson.core.JacksonException
import java.io.Writer
import java.nio.CharBuffer
import java.time.Duration

/** Teto do corpo renderizado, em caracteres (1 MiB). */
const val MAX_RENDERED_BODY = 1024 * 1024

/** Teto de cada valor de cabeçalho renderizado, em caracteres (8 KiB). */
const val MAX_RENDERED_HEADER = 8 * 1024

/**
 * Teto da soma dos valores de cabeçalho renderizados de uma resposta, em caracteres (32 KiB): abaixo do
 * buffer de 64 KB do Tomcat (`max-http-response-header-size`), com folga para nomes e cabeçalhos fixos.
 * Acima do buffer o Tomcat responderia um 500 sem corpo.
 */
const val MAX_RENDERED_HEADERS = 32 * 1024

/** Teto de cada campo templado (corpo e cada valor de cabeçalho) ao salvar, em caracteres (64 KiB). */
const val MAX_TEMPLATE_LENGTH = 64 * 1024

/**
 * Teto de aninhamento de blocos e de subexpressões ao salvar. O parser do Handlebars é recursivo e estoura
 * a pilha com ~1000 blocos aninhados, bem dentro de 64 KiB; 32 sobra para qualquer template escrito à mão.
 */
const val MAX_TEMPLATE_NESTING = 32

/**
 * `jsonPath`: soma do tamanho dos caminhos achados numa chamada, em caracteres (4 Mi). O Jayway guarda o
 * caminho de cada resultado ao lado do valor, e uma união repetida (`$[0,0,0][0,0,0]…`) multiplica os
 * resultados sem aumentar a saída de cada um.
 */
internal const val MAX_JSONPATH_RESULT_PATHS = 4L * 1024 * 1024

const val TEMPLATE_TOO_LARGE = "The rendered template is too large."
const val TEMPLATE_TOO_SLOW = "The template took too long to render."

/** Teto de tempo para renderizar a resposta inteira (corpo e cabeçalhos), contado depois de compilar. */
internal val MAX_RENDER_TIME: Duration = Duration.ofSeconds(1)

internal const val BUDGET_DATA = "site.webhook.budget"

/**
 * Prazo de renderizar, contado depois de compilar: a compilação custa o tamanho do template (perto de
 * 0,7 s para 1 MiB só de tags), limitado ao salvar, e não depende do que o remetente manda.
 */
internal fun deadline(): Long = System.nanoTime() + MAX_RENDER_TIME.toNanos()

/**
 * Tetos de uma renderização, cobrados enquanto ela acontece: [write] conta a saída que chega ao
 * escritor de fora e [tick] (a cada helper e a cada corpo de bloco) confere o prazo. Estourado, fica
 * estourado: toda conferência seguinte falha de novo, e [exceeded] guarda o motivo mesmo que alguma
 * camada do Handlebars engula a exceção.
 */
internal class RenderBudget(
    val maxLength: Int,
    private val deadline: Long,
) {
    private var length = 0

    var exceeded: String? = null
        private set

    fun write(count: Int) {
        tick()
        length += count
        if (length > maxLength) stop(TEMPLATE_TOO_LARGE)
    }

    fun tick() {
        val reason = exceeded ?: TEMPLATE_TOO_SLOW.takeIf { System.nanoTime() - deadline > 0 }
        if (reason != null) stop(reason)
    }

    /** Recusa por tamanho algo que ainda não chegou à saída (o resultado de um `jsonPath`, por exemplo). */
    fun tooLarge(): Nothing = stop(TEMPLATE_TOO_LARGE)

    private fun stop(reason: String): Nothing {
        exceeded = reason
        error(reason)
    }
}

/** O escritor de fora: cobra cada caractere do [budget] antes de guardá-lo. */
internal class BudgetWriter(
    private val budget: RenderBudget,
) : Writer() {
    private val text = StringBuilder()

    override fun write(
        cbuf: CharArray,
        off: Int,
        len: Int,
    ) {
        budget.write(len)
        text.appendRange(cbuf, off, off + len)
    }

    override fun write(
        str: String,
        off: Int,
        len: Int,
    ) {
        budget.write(len)
        text.append(str, off, off + len)
    }

    override fun flush() = Unit

    override fun close() = Unit

    override fun toString(): String = text.toString()
}

internal fun Options.budget(): RenderBudget = checkNotNull(data<RenderBudget?>(BUDGET_DATA))

/**
 * As mesmas opções, com `fn` e `inverse` escrevendo em [sink] em vez de devolver o texto. No
 * Handlebars.java puro, cada iteração do `each` e cada ramo de `if`/`unless`/`with` vira texto em
 * memória antes de seguir, e blocos aninhados sobre dados do remetente juntariam gigabytes antes de o
 * [BudgetWriter] ver um caractere; assim, tudo desce até ele à medida que é produzido.
 */
internal fun Options.streamingTo(sink: Writer): Options {
    val budget = budget()
    return Options(
        handlebars,
        helperName,
        tagType,
        context,
        StreamingTemplate(fn, sink, budget),
        StreamingTemplate(inverse, sink, budget),
        params,
        hash,
        blockParams,
        sink,
    )
}

/** Corpo de bloco que escreve em [sink] e devolve vazio a quem o aplicou; cada aplicação confere o prazo. */
private class StreamingTemplate(
    private val body: Template,
    private val sink: Writer,
    private val budget: RenderBudget,
) : Template by body {
    override fun apply(context: Context): String {
        budget.tick()
        body.apply(context, sink)
        return ""
    }

    override fun apply(context: Any?): String {
        budget.tick()
        body.apply(context, sink)
        return ""
    }
}

/** [Writer] sobre o buffer de um bloco, que escreve no bloco de fora e, no fim da fila, no [BudgetWriter]. */
internal class AppendableWriter(
    private val out: Appendable,
) : Writer() {
    override fun write(
        cbuf: CharArray,
        off: Int,
        len: Int,
    ) {
        out.append(CharBuffer.wrap(cbuf, off, len))
    }

    override fun write(
        str: String,
        off: Int,
        len: Int,
    ) {
        out.append(str, off, off + len)
    }

    override fun flush() = Unit

    override fun close() = Unit
}

/**
 * JSON de [value] (mapa ou lista), escrito até [limit] caracteres: se passar, para de escrever e devolve só
 * os primeiros `limit + 1`. Quem chama vê pelo tamanho que passou do teto, sem que o JSON inteiro chegue a
 * existir em memória.
 */
internal fun jsonUpTo(
    value: Any,
    limit: Int,
): String {
    val out = CappedWriter(limit)
    try {
        bodyMapper.writeValue(out, value)
    } catch (e: IllegalStateException) {
        if (!out.full) throw e
    } catch (e: JacksonException) {
        if (!out.full) throw e
    }
    return out.toString()
}

/** Guarda até `limit + 1` caracteres; o que passa disso para a escrita com [IllegalStateException]. */
private class CappedWriter(
    private val limit: Int,
) : Writer() {
    private val text = StringBuilder()

    val full: Boolean
        get() = text.length > limit

    override fun write(
        cbuf: CharArray,
        off: Int,
        len: Int,
    ) {
        check(!full) { TEMPLATE_TOO_LARGE }
        val room = minOf(len, limit + 1 - text.length)
        text.appendRange(cbuf, off, off + room)
        check(!full) { TEMPLATE_TOO_LARGE }
    }

    override fun flush() = Unit

    override fun close() = Unit

    override fun toString(): String = text.toString()
}
