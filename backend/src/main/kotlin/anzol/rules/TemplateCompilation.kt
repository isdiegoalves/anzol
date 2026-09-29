package anzol.rules

import com.github.benmanes.caffeine.cache.Caffeine
import com.github.benmanes.caffeine.cache.LoadingCache
import com.github.jknack.handlebars.Decorator
import com.github.jknack.handlebars.EscapingStrategy
import com.github.jknack.handlebars.Formatter
import com.github.jknack.handlebars.Handlebars
import com.github.jknack.handlebars.Helper
import com.github.jknack.handlebars.Template
import com.github.jknack.handlebars.io.TemplateLoader
import java.util.concurrent.atomic.AtomicLong

/**
 * Handlebars sem escape HTML (as respostas são JSON ou texto), sem carregador de templates e sem
 * decorators: `{{> x}}` pede o carregador e `{{#*inline}}` o decorator já ao compilar, então os dois
 * falham ao salvar (422) e nunca leem arquivo. Mapa impresso inteiro (`{{request.query}}`,
 * `{{lookup request 'headers'}}`) sai como JSON, e não no `toString` do Java; acima de [MAX_RENDERED_BODY]
 * caracteres o JSON para de ser escrito, e o teto da saída recusa a resposta.
 */
private object ResponseHandlebars : Handlebars() {
    init {
        with(EscapingStrategy.NOOP)
        with(Formatter { value, next -> if (value is Map<*, *>) jsonUpTo(value, MAX_RENDERED_BODY) else next.format(value) })
    }

    /** Toda busca de helper (compilação e execução) passa por aqui: só [HELPERS] existe. */
    @Suppress("UNCHECKED_CAST")
    override fun <C : Any?> helper(name: String): Helper<C>? = HELPERS[name] as Helper<C>?

    override fun getLoader(): TemplateLoader = throw IllegalArgumentException("partials are not supported")

    override fun decorator(name: String): Decorator = throw IllegalArgumentException("decorators are not supported")
}

/** Texto de template guardado já compilado, em caracteres: 64 templates no teto de 64 KiB, milhares dos comuns. */
private const val MAX_CACHED_TEMPLATE_TEXT = 4L * 1024 * 1024

/** Templates guardados já compilados, no máximo: cada um guarda a árvore compilada, por menor que seja o texto. */
internal const val MAX_CACHED_TEMPLATES = 4096L

/** Peso mínimo de uma entrada (1024): com ele, [MAX_CACHED_TEMPLATE_TEXT] não comporta mais que [MAX_CACHED_TEMPLATES]. */
private const val MIN_TEMPLATE_WEIGHT = (MAX_CACHED_TEMPLATE_TEXT / MAX_CACHED_TEMPLATES).toInt()

/**
 * Templates compilados, pelo texto: o webhook não recompila a regra a cada requisição, e mudar a regra muda o
 * texto (a entrada antiga sai sozinha, por falta de uso). Só guarda o que passa em [MAX_TEMPLATE_LENGTH] e
 * [MAX_TEMPLATE_NESTING] e compila; o resto lança de novo a cada vez (a validação o recusa ao salvar; regra gravada
 * antes de um teto novo responde 500 com o motivo).
 * Dois tetos, num peso só (o Caffeine não junta `maximumSize` com `maximumWeight`): o texto guardado soma até
 * [MAX_CACHED_TEMPLATE_TEXT] caracteres, e cada entrada pesa pelo menos [MIN_TEMPLATE_WEIGHT], o que limita
 * as entradas a [MAX_CACHED_TEMPLATES].
 */
private val COMPILED: LoadingCache<String, Template> =
    Caffeine
        .newBuilder()
        .maximumWeight(MAX_CACHED_TEMPLATE_TEXT)
        .weigher { text: String, _: Template -> maxOf(text.length, MIN_TEMPLATE_WEIGHT) }
        .build { text -> compileNow(text) }

private val compilations = AtomicLong()

private fun compileNow(text: String): Template {
    compilations.incrementAndGet()
    require(text.length <= MAX_TEMPLATE_LENGTH) { "longer than $MAX_TEMPLATE_LENGTH characters" }
    val nesting = nestingError(text)
    require(nesting == null) { "$nesting" }
    return ResponseHandlebars.compileInline(separateClosingBraces(text))
}

/** Quantas vezes um template foi compilado (as que falharam também), para medir o cache. */
internal fun templateCompilations(): Long = compilations.get()

/** Quantos templates compilados estão guardados agora, depois de o cache aplicar os tetos pendentes. */
internal fun cachedTemplates(): Long {
    COMPILED.cleanUp()
    return COMPILED.estimatedSize()
}

/**
 * O template compilado de [text], do cache ou compilado agora. Texto acima dos tetos lança
 * [IllegalArgumentException]; sintaxe inválida, [com.github.jknack.handlebars.HandlebarsException].
 */
internal fun compiledTemplate(text: String): Template = COMPILED.get(text)
