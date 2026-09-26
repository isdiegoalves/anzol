package site.webhook.rules

import com.github.jknack.handlebars.Context
import com.github.jknack.handlebars.Options
import com.github.jknack.handlebars.Template
import java.io.Writer
import java.nio.CharBuffer
import java.time.Duration

/** Teto do corpo renderizado, em caracteres (1 MiB). */
const val MAX_RENDERED_BODY = 1024 * 1024

/** Teto de cada valor de cabeçalho renderizado, em caracteres (8 KiB). */
const val MAX_RENDERED_HEADER = 8 * 1024

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
    private val maxLength: Int,
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
