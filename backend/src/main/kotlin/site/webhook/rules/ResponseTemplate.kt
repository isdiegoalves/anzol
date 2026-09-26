package site.webhook.rules

import com.github.jknack.handlebars.Context
import com.github.jknack.handlebars.Decorator
import com.github.jknack.handlebars.EscapingStrategy
import com.github.jknack.handlebars.Handlebars
import com.github.jknack.handlebars.HandlebarsException
import com.github.jknack.handlebars.Helper
import com.github.jknack.handlebars.context.MapValueResolver
import com.github.jknack.handlebars.helper.EachHelper
import com.github.jknack.handlebars.helper.IfHelper
import com.github.jknack.handlebars.helper.LookupHelper
import com.github.jknack.handlebars.helper.UnlessHelper
import com.github.jknack.handlebars.helper.WithHelper
import com.github.jknack.handlebars.io.TemplateLoader
import com.jayway.jsonpath.JsonPath
import com.jayway.jsonpath.JsonPathException
import site.webhook.capture.CapturedRequest
import tools.jackson.databind.JsonNode
import java.math.MathContext
import java.time.DateTimeException
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.util.concurrent.ThreadLocalRandom

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

private const val NOW_DATA = "site.webhook.now"
private const val VALIDATING_DATA = "site.webhook.validating"
private const val DEFAULT_RANDOM_LENGTH = 16
private val RANDOM_LENGTH = 1..10_000
private val RANDOM_ALPHABETS =
    mapOf(
        "ALPHANUMERIC" to "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        "NUMERIC" to "0123456789",
        "HEX" to "0123456789abcdef",
    )
private val ISO_SECONDS: DateTimeFormatter = DateTimeFormatter.ISO_INSTANT

/**
 * Os únicos helpers: os de lógica do Handlebars (sem E/S) e os quatro do Anexo B. Ficam de fora os
 * embutidos que leem arquivo ou classpath (`embedded`, `partial`, `block`, `precompile`, `i18n`,
 * `i18nJs`), o `log` (escreve no log do servidor) e o `helperMissing` (sem ele,
 * helper desconhecido é erro de compilação, o que dá o 422 ao salvar). Nenhum helper em JavaScript
 * (o Nashorn nem entra no classpath).
 */
private val HELPERS: Map<String, Helper<*>> =
    mapOf(
        IfHelper.NAME to block(IfHelper.NAME, IfHelper.INSTANCE),
        UnlessHelper.NAME to block(UnlessHelper.NAME, UnlessHelper.INSTANCE),
        EachHelper.NAME to block(EachHelper.NAME, EachHelper.INSTANCE),
        WithHelper.NAME to block(WithHelper.NAME, WithHelper.INSTANCE),
        LookupHelper.NAME to withParams(LookupHelper.NAME, 2) { context, options -> LookupHelper.INSTANCE.apply(context, options) },
        "jsonPath" to withParams("jsonPath", 2) { body, options -> jsonPathValue(body, options.param<Any?>(0)) },
        "now" to withParams("now", 0) { _, options -> formatNow(options.data(NOW_DATA), options.hash<Any?>("format")) },
        "randomValue" to
            withParams("randomValue", 0) { _, options -> randomValue(options.hash<Any?>("type"), options.hash<Any?>("length")) },
        "math" to withParams("math", 3) { left, options -> math(left, options.param<Any?>(0), options.param<Any?>(1)) },
    )

/**
 * Helper que exige [count] parâmetros: faltando, a validação ao salvar recusa (422) e a execução deixa
 * o trecho vazio (o Handlebars.java aceitaria `{{#if}}` ou `{{#each}}` sem parâmetro, sobre o contexto).
 */
private fun withParams(
    name: String,
    count: Int,
    helper: Helper<Any?>,
): Helper<Any?> =
    Helper { context, options ->
        val given = options.data<Int?>(Context.PARAM_SIZE) ?: 0
        when {
            given >= count -> helper.apply(context, options)
            options.data<Boolean?>(VALIDATING_DATA) == true -> throw IllegalArgumentException("$name requires $count parameter(s)")
            else -> ""
        }
    }

/** Bloco embutido com um parâmetro; na validação renderiza os dois ramos, para achar erro em qualquer um. */
private fun <T> block(
    name: String,
    helper: Helper<T>,
): Helper<Any?> =
    withParams(name, 1) { context, options ->
        if (options.data<Boolean?>(VALIDATING_DATA) == true) {
            options.fn()
            options.inverse()
        } else {
            @Suppress("UNCHECKED_CAST")
            helper.apply(context as T, options)
        }
    }

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
 * parâmetros que exige.
 */
fun templateError(text: String): String? =
    try {
        ResponseHandlebars.compileInline(text).apply(context(VALIDATION_INPUT).data(VALIDATING_DATA, true))
        null
    } catch (e: HandlebarsException) {
        val error = e.error
        val reason = (e.cause as? IllegalArgumentException)?.message ?: error?.reason
        if (error == null) e.message else "$reason (line ${error.line}, column ${error.column})"
    } catch (e: IllegalArgumentException) {
        e.message
    }

private val VALIDATION_INPUT =
    TemplateInput(TemplateRequest("GET", "/", "/", emptyMap(), emptyMap(), ""), seq = 0, now = Instant.EPOCH)

/**
 * O texto renderizado com o contexto do Anexo B. Só mapas, listas e textos chegam ao template, e só o
 * resolvedor de mapas os lê: nada de método ou propriedade Java (`{{request.method.class}}` sai vazio).
 * Helper que falha devolve vazio no próprio trecho; template que não compila (nunca salvo) sai vazio.
 */
fun renderTemplate(
    text: String,
    input: TemplateInput,
): String =
    try {
        ResponseHandlebars.compileInline(text).apply(context(input))
    } catch (_: HandlebarsException) {
        ""
    }

private fun context(input: TemplateInput): Context {
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
        .resolver(MapValueResolver.INSTANCE)
        .build()
        .data(NOW_DATA, input.now)
}

/** Valor do caminho no corpo JSON: escalar como texto, objeto ou lista como JSON; ausente ou nulo, vazio. */
private fun jsonPathValue(
    body: Any?,
    path: Any?,
): String {
    val document = (body as? String)?.let(::readJson)?.let(::jsonDocument)
    if (document == null || path !is String) return ""
    val value =
        try {
            JsonPath.compile(path).read<Any?>(document)
        } catch (_: JsonPathException) {
            null
        }
    val tree = value?.let { bodyMapper.valueToTree<JsonNode>(it) }
    return when {
        tree == null || tree.isNull -> ""
        tree.isValueNode -> tree.asString()
        else -> tree.toString()
    }
}

private fun formatNow(
    now: Instant,
    format: Any?,
): String =
    when (format) {
        null -> {
            ISO_SECONDS.format(now.truncatedTo(ChronoUnit.SECONDS))
        }

        else -> {
            try {
                DateTimeFormatter.ofPattern(format.toString()).withZone(ZoneOffset.UTC).format(now)
            } catch (_: IllegalArgumentException) {
                ""
            } catch (_: DateTimeException) {
                ""
            }
        }
    }

private fun randomValue(
    type: Any?,
    length: Any?,
): String {
    val size = (length ?: DEFAULT_RANDOM_LENGTH).toString().toIntOrNull()?.takeIf { it in RANDOM_LENGTH }
    val random = ThreadLocalRandom.current()
    val alphabet = RANDOM_ALPHABETS[type?.toString()?.uppercase()]
    return when {
        size == null -> ""
        type?.toString()?.uppercase() == "UUID" -> UUID.randomUUID().toString()
        alphabet == null -> ""
        else -> String(CharArray(size) { alphabet[random.nextInt(alphabet.length)] })
    }
}

private fun math(
    left: Any?,
    operator: Any?,
    right: Any?,
): String {
    val a = left?.toString()?.toBigDecimalOrNull()
    val b = right?.toString()?.toBigDecimalOrNull()
    val result =
        when {
            a == null || b == null -> null
            operator == "+" -> a.add(b)
            operator == "-" -> a.subtract(b)
            operator == "*" -> a.multiply(b)
            operator == "/" && b.signum() != 0 -> a.divide(b, MathContext.DECIMAL64)
            else -> null
        }
    return result?.stripTrailingZeros()?.toPlainString().orEmpty()
}

/** A resposta com corpo e valores de cabeçalho renderizados quando `template` está ligado; senão, como está. */
fun RuleResponse.rendered(input: TemplateInput): RuleResponse =
    if (template) {
        copy(body = renderTemplate(body, input), headers = headers.mapValues { (_, value) -> renderTemplate(value, input) })
    } else {
        this
    }

fun CapturedRequest.toTemplateRequest(): TemplateRequest {
    val input = toMatchInput()
    return TemplateRequest(input.method, input.path, url, input.query, input.headers, input.body)
}
