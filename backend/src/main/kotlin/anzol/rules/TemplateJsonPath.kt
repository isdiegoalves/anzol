package anzol.rules

import com.github.jknack.handlebars.Options
import com.jayway.jsonpath.Configuration
import com.jayway.jsonpath.EvaluationListener
import com.jayway.jsonpath.JsonPath
import com.jayway.jsonpath.JsonPathException
import com.jayway.jsonpath.spi.json.JsonProvider
import tools.jackson.databind.JsonNode

internal const val DOCUMENTS_DATA = "anzol.documents"

/**
 * Trechos que recusam o caminho do `jsonPath` no template, em qualquer lugar dele (entre aspas também):
 * busca profunda (`..`), filtro (`[?(…)]`) e função (`.length()`, `.concat()`…). Filtro traz regex (`=~`),
 * cujo retrocesso não para no meio, e função traz `concat`, que monta texto sem teto; sem busca profunda, o
 * custo de um caminho fica no número de passos, que [BudgetJsonProvider] confere.
 */
private val UNSUPPORTED_PATH = listOf("..", "?", "(")

private const val UNSUPPORTED_PATH_REASON = "jsonPath supports only simple paths, without deep scan (..), filters (?) or functions (())"

/**
 * O último texto lido como JSON numa renderização e o documento dele: `{{#each}}` com
 * `{{jsonPath request.body …}}` lê o corpo uma vez, e não uma por volta. Guarda só o último, para que
 * subexpressões que dão um texto novo a cada volta não acumulem documentos.
 */
internal class JsonDocuments {
    private var text: String? = null
    private var document: Any? = null

    fun of(text: String): Any? {
        if (text != this.text) {
            document = readJson(text)?.let(::jsonDocument)
            this.text = text
        }
        return document
    }
}

/**
 * Valor do caminho no corpo JSON: escalar como texto, objeto ou lista como JSON; ausente ou nulo, vazio.
 * Caminho com [UNSUPPORTED_PATH] recusa o template ao salvar (422) e, vindo da requisição, sai vazio. A
 * avaliação confere o prazo a cada passo no documento e o tamanho dos caminhos achados
 * ([MAX_JSONPATH_RESULT_PATHS]); objeto ou lista maior que o teto da saída para ao passar dele (500), mesmo
 * que só sirva de condição.
 */
internal fun jsonPathValue(
    body: Any?,
    path: Any?,
    options: Options,
): String {
    val supported = path !is String || UNSUPPORTED_PATH.none { it in path }
    require(supported || options.data<Boolean?>(VALIDATING_DATA) != true) { UNSUPPORTED_PATH_REASON }
    val budget = options.budget()
    val document = (body as? String)?.takeIf { supported }?.let { checkNotNull(options.data<JsonDocuments?>(DOCUMENTS_DATA)).of(it) }
    if (document == null || path !is String) return ""
    val value =
        try {
            JsonPath.compile(path).read<Any?>(document, budgeted(budget))
        } catch (_: JsonPathException) {
            null
        }
    return when (value) {
        null -> ""
        is Map<*, *>, is List<*> -> jsonUpTo(value, budget.maxLength).also { if (it.length > budget.maxLength) budget.tooLarge() }
        else -> bodyMapper.valueToTree<JsonNode>(value).asString()
    }
}

private fun budgeted(budget: RenderBudget): Configuration {
    val base = Configuration.defaultConfiguration()
    return base.jsonProvider(BudgetJsonProvider(base.jsonProvider(), budget)).addEvaluationListeners(ResultPaths(budget))
}

/** Cada leitura no documento confere o prazo: sem isso, um caminho caro rodaria inteiro numa chamada só do helper. */
private class BudgetJsonProvider(
    private val json: JsonProvider,
    private val budget: RenderBudget,
) : JsonProvider by json {
    override fun length(obj: Any?): Int {
        budget.tick()
        return json.length(obj)
    }

    override fun toIterable(obj: Any?): Iterable<*> {
        budget.tick()
        return json.toIterable(obj)
    }

    override fun getPropertyKeys(obj: Any?): Collection<String> {
        budget.tick()
        return json.getPropertyKeys(obj)
    }

    override fun getArrayIndex(
        obj: Any?,
        idx: Int,
    ): Any? {
        budget.tick()
        return json.getArrayIndex(obj, idx)
    }

    @Deprecated("Como no JsonProvider")
    override fun getArrayIndex(
        obj: Any?,
        idx: Int,
        unwrap: Boolean,
    ): Any? {
        budget.tick()
        @Suppress("DEPRECATION")
        return json.getArrayIndex(obj, idx, unwrap)
    }

    override fun getMapValue(
        obj: Any?,
        key: String?,
    ): Any? {
        budget.tick()
        return json.getMapValue(obj, key)
    }
}

/** Soma o tamanho do caminho de cada resultado (o Jayway guarda um texto por resultado); passou do teto, 500. */
private class ResultPaths(
    private val budget: RenderBudget,
) : EvaluationListener {
    private var size = 0L

    override fun resultFound(found: EvaluationListener.FoundResult): EvaluationListener.EvaluationContinuation {
        size += found.path().length + 1
        if (size > MAX_JSONPATH_RESULT_PATHS) budget.tooLarge()
        return EvaluationListener.EvaluationContinuation.CONTINUE
    }
}
