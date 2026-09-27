package site.webhook.rules

import com.github.jknack.handlebars.Context
import com.github.jknack.handlebars.HandlebarsException
import com.github.jknack.handlebars.Template
import com.github.jknack.handlebars.ValueResolver
import com.github.jknack.handlebars.context.MapValueResolver
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import site.webhook.capture.CapturedRequest
import site.webhook.signature.SignatureConfig
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

/**
 * Contexto de uma renderização: a requisição, o `seq` da mensagem gravada, o instante do `{{now}}` e a verificação de
 * assinatura da URL ([signing]), cujo segredo o `{{hmac}}` usa sem nunca expor (nula: o `{{hmac}}` sai vazio).
 */
data class TemplateInput(
    val request: TemplateRequest,
    val seq: Long,
    val now: Instant,
    val signing: SignatureConfig? = null,
)

/**
 * `null` quando o texto é um template válido; senão o motivo, com linha e coluna. Recusa texto acima de
 * [MAX_TEMPLATE_LENGTH] e blocos ou subexpressões aninhados além de [MAX_TEMPLATE_NESTING]. Além de compilar,
 * renderiza uma vez em modo de validação (os dois ramos de cada bloco), que recusa helper sem os
 * parâmetros que exige, `randomValue` com `length` fora de 1..10000, `jsonPath` com caminho não suportado e `hmac`
 * com algoritmo ou codificação fora dos aceitos,
 * com os mesmos tetos da resposta.
 */
fun templateError(text: String): String? =
    try {
        val template = compiledTemplate(text)
        val budget = RenderBudget(MAX_RENDERED_BODY, deadline())
        template.apply(context(VALIDATION_INPUT, budget, JsonDocuments()).data(VALIDATING_DATA, true), BudgetWriter(budget))
        null
    } catch (e: HandlebarsException) {
        e.reason()
    } catch (e: IllegalArgumentException) {
        e.message
    }

/** A mensagem do motivo [reason] de um template recusado: a do 422 ao salvar e a do 500 de uma regra gravada antes dos tetos. */
fun invalidTemplateMessage(reason: String?): String = "The template is invalid: $reason."

/** O motivo, com linha e coluna quando o Handlebars as dá. */
private fun HandlebarsException.reason(): String? {
    val error = error ?: return message
    val reason = cause?.takeIf { it is IllegalArgumentException || it is IllegalStateException }?.message ?: error.reason
    return "$reason (line ${error.line}, column ${error.column})"
}

/** Requisição vazia da validação; `seq` 1, o primeiro que uma mensagem recebe (`length=seq` vale). */
private val VALIDATION_INPUT =
    TemplateInput(TemplateRequest("GET", "/", "/", emptyMap(), emptyMap(), ""), seq = 1, now = Instant.EPOCH)

/**
 * O texto renderizado com o contexto do Anexo B. Só mapas, números e textos chegam ao template, e só o
 * [AnnexBResolver] os lê: nada de método ou propriedade Java (`{{request.method.class}}` sai vazio).
 * Helper que falha devolve vazio no próprio trecho; template que não compila lança 500 (ver [compile]).
 * Com o teto do corpo e o prazo de [MAX_RENDER_TIME] (ver [render]).
 */
fun renderTemplate(
    text: String,
    input: TemplateInput,
): String = compile(text, input).render(input, MAX_RENDERED_BODY, deadline(), JsonDocuments())

/**
 * A resposta pronta para o fio. Com `template` ligado, corpo e valores de cabeçalho renderizados: corpo até
 * [MAX_RENDERED_BODY], cada valor de cabeçalho até [MAX_RENDERED_HEADER] e a soma deles até
 * [MAX_RENDERED_HEADERS] caracteres, tudo num prazo só ([MAX_RENDER_TIME]) depois de compilar tudo;
 * estourou, 500 (ver [render]). O corpo JSON lido por `jsonPath` é lido uma vez para a resposta inteira.
 *
 * Em todo valor de cabeçalho, templado ou fixo ([asHeaderValue]), todo caractere de controle (C0, DEL e C1)
 * menos o HTAB vira espaço: CR e LF vindos do remetente (`{{request.query.x}}`, `jsonPath` no corpo) nunca
 * abrem linha de cabeçalho nova. O Tomcat 11 já troca C0 e DEL por espaço, mas manda os C1 (U+0080–U+009F)
 * crus; a troca aqui não depende dele. Espaço, e não 500, para o remetente não conseguir derrubar a
 * resposta da regra com uma quebra de linha; no valor fixo, o mesmo tratamento (CR, LF e NUL já são
 * recusados ao salvar, templado ou não). O corpo fica como veio.
 *
 * Cada caractere fora do ISO-8859-1 (acima de U+00FF, inclusive U+2028 e U+2029; um par substituto conta
 * como um) vira `?`: o Tomcat descartaria o cabeçalho inteiro, sem aviso.
 *
 * [until] (`System.nanoTime()`) é um prazo dividido com outras renderizações (o `rules/test?render=N`); nulo, o
 * prazo é o de [MAX_RENDER_TIME] contado depois de compilar.
 */
fun RuleResponse.rendered(
    input: TemplateInput,
    until: Long? = null,
): RuleResponse {
    if (!template) return copy(headers = headers.mapValues { (_, value) -> value.asHeaderValue() })
    val compiledBody = compile(body, input)
    val compiledHeaders = headers.mapValues { (_, value) -> compile(value, input) }
    val deadline = until ?: deadline()
    val documents = JsonDocuments()
    return copy(
        body = compiledBody.render(input, MAX_RENDERED_BODY, deadline, documents),
        headers = renderHeaders(compiledHeaders, input, deadline, documents),
    )
}

private fun renderHeaders(
    templates: Map<String, Template>,
    input: TemplateInput,
    deadline: Long,
    documents: JsonDocuments,
): Map<String, String> {
    var total = 0
    return templates.mapValues { (_, template) ->
        val value = template.render(input, MAX_RENDERED_HEADER, deadline, documents).asHeaderValue()
        total += value.length
        if (total > MAX_RENDERED_HEADERS) throw ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, TEMPLATE_TOO_LARGE)
        value
    }
}

private val log = LoggerFactory.getLogger("site.webhook.rules.ResponseTemplate")

/**
 * O template compilado. Texto que não compila ou passa dos tetos não é salvo (a validação recusa com 422),
 * mas a regra gravada antes de um teto novo continua no Redis: a resposta dela é 500 com o motivo, no
 * envelope de erro de sempre, e o log registra a URL (sem a query) e o motivo.
 */
private fun compile(
    text: String,
    input: TemplateInput,
): Template {
    val reason =
        try {
            return compiledTemplate(text)
        } catch (e: HandlebarsException) {
            e.reason()
        } catch (e: IllegalArgumentException) {
            e.message
        }
    log.warn("Regra com template inválido em {}, resposta 500: {}", input.request.url.substringBefore('?'), reason)
    throw ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, invalidTemplateMessage(reason))
}

/**
 * Tetos, cobrados durante a renderização: a saída passa de [maxLength] caracteres ou o relógio passa
 * de [deadline] (`System.nanoTime()`) → para na hora e lança 500 com [TEMPLATE_TOO_LARGE] ou
 * [TEMPLATE_TOO_SLOW], que o `LegacyErrorAdvice` responde no envelope de erro de sempre.
 */
private fun Template.render(
    input: TemplateInput,
    maxLength: Int,
    deadline: Long,
    documents: JsonDocuments,
): String {
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
        .data(SIGNING_DATA, input.signing)
}

fun CapturedRequest.toTemplateRequest(): TemplateRequest {
    val input = toMatchInput()
    return TemplateRequest(input.method, input.path, url, input.query, input.headers, input.body)
}
