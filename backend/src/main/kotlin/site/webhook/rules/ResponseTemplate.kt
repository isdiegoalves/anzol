package site.webhook.rules

import com.github.jknack.handlebars.Context
import com.github.jknack.handlebars.Decorator
import com.github.jknack.handlebars.EscapingStrategy
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
 * falham ao salvar (422) e nunca leem arquivo.
 */
private object ResponseHandlebars : Handlebars() {
    init {
        with(EscapingStrategy.NOOP)
    }

    /** Toda busca de helper (compilação e execução) passa por aqui: só [HELPERS] existe. */
    @Suppress("UNCHECKED_CAST")
    override fun <C : Any?> helper(name: String): Helper<C>? = HELPERS[name] as Helper<C>?

    override fun getLoader(): TemplateLoader = throw IllegalArgumentException("partials are not supported")

    override fun decorator(name: String): Decorator = throw IllegalArgumentException("decorators are not supported")
}

/**
 * `null` quando o texto é um template válido; senão o motivo, com linha e coluna. Além de compilar,
 * renderiza uma vez em modo de validação (os dois ramos de cada bloco), que recusa helper sem os
 * parâmetros que exige e `randomValue` com `length` fora de 1..10000, com os mesmos tetos da resposta.
 */
fun templateError(text: String): String? =
    try {
        val template = ResponseHandlebars.compileInline(separateClosingBraces(text))
        val budget = RenderBudget(MAX_RENDERED_BODY, deadline())
        template.apply(context(VALIDATION_INPUT, budget).data(VALIDATING_DATA, true), BudgetWriter(budget))
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
): String = compile(text).render(input, MAX_RENDERED_BODY, deadline())

/**
 * A resposta com corpo e valores de cabeçalho renderizados quando `template` está ligado; senão, como está.
 * Corpo até [MAX_RENDERED_BODY] e cada valor de cabeçalho até [MAX_RENDERED_HEADER] caracteres, tudo num
 * prazo só ([MAX_RENDER_TIME]) depois de compilar tudo; estourou, 500 (ver [render]).
 *
 * No valor de cabeçalho, todo caractere de controle (C0, DEL e C1) menos o HTAB vira espaço: CR e LF
 * vindos do remetente (`{{request.query.x}}`, `jsonPath` no corpo) nunca abrem linha de cabeçalho nova.
 * O Tomcat 11 já troca C0 e DEL por espaço, mas manda os C1 (U+0080–U+009F) crus; a troca aqui não
 * depende dele. Espaço, e não 500, para o remetente não conseguir derrubar a resposta da regra com uma
 * quebra de linha. O corpo fica como veio.
 */
fun RuleResponse.rendered(input: TemplateInput): RuleResponse {
    if (!template) return this
    val compiledBody = compile(body)
    val compiledHeaders = headers.mapValues { (_, value) -> compile(value) }
    val deadline = deadline()
    return copy(
        body = compiledBody.render(input, MAX_RENDERED_BODY, deadline),
        headers = compiledHeaders.mapValues { (_, value) -> value.render(input, MAX_RENDERED_HEADER, deadline).controlsAsSpaces() },
    )
}

private fun String.controlsAsSpaces(): String =
    String(CharArray(length) { i -> if (this[i] != '\t' && this[i].isISOControl()) ' ' else this[i] })

/** O template compilado; `null` se não compila (nunca salvo assim: a validação recusa). */
private fun compile(text: String): Template? =
    try {
        ResponseHandlebars.compileInline(separateClosingBraces(text))
    } catch (_: HandlebarsException) {
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
): String {
    if (this == null) return ""
    val budget = RenderBudget(maxLength, deadline)
    val out = BudgetWriter(budget)
    val rendered =
        try {
            apply(context(input, budget), out)
            out.toString()
        } catch (_: HandlebarsException) {
            ""
        }
    budget.exceeded?.let { throw ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, it) }
    return rendered
}

/**
 * O resolvedor de mapas, só com os tipos do contexto do Anexo B (texto, número, mapa): o que o
 * Handlebars guarda ao lado, nos dados da renderização (`{{@__inline_partials_}}`, o relógio e os
 * tetos desta renderização), não aparece no template nem como texto. Valor de outro tipo é recusado
 * com `null`, e não com `UNRESOLVED`: o `Context.Builder` põe o `MapValueResolver` cru depois deste, e
 * `UNRESOLVED` o deixaria achar o valor recusado.
 */
private object AnnexBResolver : ValueResolver by MapValueResolver.INSTANCE {
    override fun resolve(
        context: Any?,
        name: String?,
    ): Any? {
        val value = MapValueResolver.INSTANCE.resolve(context, name)
        return value.takeIf { it === ValueResolver.UNRESOLVED || it is String || it is Number || it is Map<*, *> }
    }
}

private fun context(
    input: TemplateInput,
    budget: RenderBudget,
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
}

fun CapturedRequest.toTemplateRequest(): TemplateRequest {
    val input = toMatchInput()
    return TemplateRequest(input.method, input.path, url, input.query, input.headers, input.body)
}
