package site.webhook.rules

import com.github.benmanes.caffeine.cache.Caffeine
import com.github.benmanes.caffeine.cache.LoadingCache
import com.github.jknack.handlebars.Context
import com.github.jknack.handlebars.Decorator
import com.github.jknack.handlebars.EscapingStrategy
import com.github.jknack.handlebars.Formatter
import com.github.jknack.handlebars.Handlebars
import com.github.jknack.handlebars.HandlebarsException
import com.github.jknack.handlebars.Helper
import com.github.jknack.handlebars.Template
import com.github.jknack.handlebars.ValueResolver
import com.github.jknack.handlebars.context.MapValueResolver
import com.github.jknack.handlebars.io.TemplateLoader
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import site.webhook.capture.CapturedRequest
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong

/** O que o template enxerga da requisição (Anexo B): `request.*`; cabeçalhos com nome em minúsculas. */
data class TemplateRequest(
    val method: String,
    val path: String,
    val url: String,
    val query: Map<String, String>,
    val headers: Map<String, String>,
    val body: String,
)

/** Contexto de uma renderização: a requisição, o `seq` da mensagem gravada e o instante do `{{now}}`. */
data class TemplateInput(
    val request: TemplateRequest,
    val seq: Long,
    val now: Instant,
)

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

/**
 * Templates compilados, pelo texto: o webhook não recompila a regra a cada requisição, e mudar a regra muda o
 * texto (a entrada antiga sai sozinha, por falta de uso). Só guarda o que passa em [MAX_TEMPLATE_LENGTH] e
 * [MAX_TEMPLATE_NESTING] e compila; o resto lança de novo a cada vez (e nunca é salvo: a validação recusa).
 */
private val COMPILED: LoadingCache<String, Template> =
    Caffeine
        .newBuilder()
        .maximumWeight(MAX_CACHED_TEMPLATE_TEXT)
        .weigher { text: String, _: Template -> text.length }
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

/**
 * `null` quando o texto é um template válido; senão o motivo, com linha e coluna. Recusa texto acima de
 * [MAX_TEMPLATE_LENGTH] e blocos ou subexpressões aninhados além de [MAX_TEMPLATE_NESTING]. Além de compilar,
 * renderiza uma vez em modo de validação (os dois ramos de cada bloco), que recusa helper sem os
 * parâmetros que exige, `randomValue` com `length` fora de 1..10000 e `jsonPath` com caminho não suportado,
 * com os mesmos tetos da resposta.
 */
fun templateError(text: String): String? =
    try {
        val template = COMPILED.get(text)
        val budget = RenderBudget(MAX_RENDERED_BODY, deadline())
        template.apply(context(VALIDATION_INPUT, budget, JsonDocuments()).data(VALIDATING_DATA, true), BudgetWriter(budget))
        null
    } catch (e: HandlebarsException) {
        val error = e.error
        val reason = e.cause?.takeIf { it is IllegalArgumentException || it is IllegalStateException }?.message ?: error?.reason
        if (error == null) e.message else "$reason (line ${error.line}, column ${error.column})"
    } catch (e: IllegalArgumentException) {
        e.message
    }

/** Requisição vazia da validação; `seq` 1, o primeiro que uma mensagem recebe (`length=seq` vale). */
private val VALIDATION_INPUT =
    TemplateInput(TemplateRequest("GET", "/", "/", emptyMap(), emptyMap(), ""), seq = 1, now = Instant.EPOCH)

/**
 * O texto renderizado com o contexto do Anexo B. Só mapas, números e textos chegam ao template, e só o
 * [AnnexBResolver] os lê: nada de método ou propriedade Java (`{{request.method.class}}` sai vazio).
 * Helper que falha devolve vazio no próprio trecho; template que não compila (nunca salvo) sai vazio.
 * Com o teto do corpo e o prazo de [MAX_RENDER_TIME] (ver [render]).
 */
fun renderTemplate(
    text: String,
    input: TemplateInput,
): String = compile(text).render(input, MAX_RENDERED_BODY, deadline(), JsonDocuments())

/**
 * A resposta pronta para o fio. Com `template` ligado, corpo e valores de cabeçalho renderizados: corpo até
 * [MAX_RENDERED_BODY], cada valor de cabeçalho até [MAX_RENDERED_HEADER] e a soma deles até
 * [MAX_RENDERED_HEADERS] caracteres, tudo num prazo só ([MAX_RENDER_TIME]) depois de compilar tudo;
 * estourou, 500 (ver [render]). O corpo JSON lido por `jsonPath` é lido uma vez para a resposta inteira.
 *
 * No valor de cabeçalho renderizado, todo caractere de controle (C0, DEL e C1) menos o HTAB vira espaço: CR
 * e LF vindos do remetente (`{{request.query.x}}`, `jsonPath` no corpo) nunca abrem linha de cabeçalho nova.
 * O Tomcat 11 já troca C0 e DEL por espaço, mas manda os C1 (U+0080–U+009F) crus; a troca aqui não
 * depende dele. Espaço, e não 500, para o remetente não conseguir derrubar a resposta da regra com uma
 * quebra de linha. O corpo fica como veio.
 *
 * Em todo valor de cabeçalho, templado ou fixo, cada caractere fora do ISO-8859-1 (acima de U+00FF,
 * inclusive U+2028 e U+2029; um par substituto conta como um) vira `?`: o Tomcat descartaria o cabeçalho
 * inteiro, sem aviso.
 */
fun RuleResponse.rendered(input: TemplateInput): RuleResponse {
    if (!template) return copy(headers = headers.mapValues { (_, value) -> value.latin1() })
    val compiledBody = compile(body)
    val compiledHeaders = headers.mapValues { (_, value) -> compile(value) }
    val deadline = deadline()
    val documents = JsonDocuments()
    return copy(
        body = compiledBody.render(input, MAX_RENDERED_BODY, deadline, documents),
        headers = renderHeaders(compiledHeaders, input, deadline, documents),
    )
}

private fun renderHeaders(
    templates: Map<String, Template?>,
    input: TemplateInput,
    deadline: Long,
    documents: JsonDocuments,
): Map<String, String> {
    var total = 0
    return templates.mapValues { (_, template) ->
        val value = template.render(input, MAX_RENDERED_HEADER, deadline, documents).controlsAsSpaces().latin1()
        total += value.length
        if (total > MAX_RENDERED_HEADERS) throw ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, TEMPLATE_TOO_LARGE)
        value
    }
}

/** O template compilado; `null` se não compila ou passa dos tetos (nunca salvo assim: a validação recusa). */
private fun compile(text: String): Template? =
    try {
        COMPILED.get(text)
    } catch (_: HandlebarsException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

/**
 * Tetos, cobrados durante a renderização: a saída passa de [maxLength] caracteres ou o relógio passa
 * de [deadline] (`System.nanoTime()`) → para na hora e lança 500 com [TEMPLATE_TOO_LARGE] ou
 * [TEMPLATE_TOO_SLOW], que o `LegacyErrorAdvice` responde no envelope de erro de sempre.
 */
private fun Template?.render(
    input: TemplateInput,
    maxLength: Int,
    deadline: Long,
    documents: JsonDocuments,
): String {
    if (this == null) return ""
    val budget = RenderBudget(maxLength, deadline)
    val out = BudgetWriter(budget)
    val rendered =
        try {
            apply(context(input, budget, documents), out)
            out.toString()
        } catch (_: HandlebarsException) {
            ""
        }
    budget.exceeded?.let { throw ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, it) }
    return rendered
}

/** A única chave dos dados da renderização que o template lê: `@root` (buscada com e sem `@`), o próprio contexto do Anexo B. */
private val ROOT_DATA = setOf("@root", "root")

/**
 * O resolvedor de mapas, só com os tipos do contexto do Anexo B (texto, número, mapa). Dos dados da
 * renderização, que o Handlebars também consulta (`{{[chave]}}`, `{{@chave}}`, `lookup`), só sai `@root`:
 * o resto (partials, pilha de chamadas, número de parâmetros do último helper, o relógio e os tetos desta
 * renderização) não aparece no template nem como texto nem como bloco. Valor recusado é `null`, e não
 * `UNRESOLVED`: o `Context.Builder` põe o `MapValueResolver` cru depois deste, e `UNRESOLVED` o deixaria
 * achar o valor recusado. Chave ausente continua `UNRESOLVED`, para a busca seguir aos contextos de fora
 * (`{{request.body}}` dentro de um `each`).
 */
private object AnnexBResolver : ValueResolver by MapValueResolver.INSTANCE {
    override fun resolve(
        context: Any?,
        name: String?,
    ): Any? {
        val value = MapValueResolver.INSTANCE.resolve(context, name)
        val readable = !context.isRenderData() || name in ROOT_DATA
        return value.takeIf { it === ValueResolver.UNRESOLVED || (readable && (it is String || it is Number || it is Map<*, *>)) }
    }

    /** Os dados da renderização, e não um mapa do Anexo B: só eles guardam um [RenderBudget] (o remetente só manda texto). */
    private fun Any?.isRenderData(): Boolean = this is Map<*, *> && this[BUDGET_DATA] is RenderBudget
}

private fun context(
    input: TemplateInput,
    budget: RenderBudget,
    documents: JsonDocuments,
): Context {
    val request = input.request
    val model =
        mapOf(
            "request" to
                mapOf(
                    "method" to request.method,
                    "path" to request.path,
                    "url" to request.url,
                    "query" to request.query,
                    "headers" to request.headers,
                    "body" to request.body,
                ),
            "seq" to input.seq,
        )
    return Context
        .newBuilder(model)
        .resolver(AnnexBResolver)
        .build()
        .data(NOW_DATA, input.now)
        .data(BUDGET_DATA, budget)
        .data(DOCUMENTS_DATA, documents)
}

fun CapturedRequest.toTemplateRequest(): TemplateRequest {
    val input = toMatchInput()
    return TemplateRequest(input.method, input.path, url, input.query, input.headers, input.body)
}
