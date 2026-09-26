package site.webhook.rules

import site.webhook.capture.CapturedRequest
import tools.jackson.core.JacksonException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.URLDecoder
import java.nio.charset.StandardCharsets.UTF_8

/** Leitor do corpo e das frases do `failed`: JSON puro, sem as configurações da API. */
val bodyMapper: JsonMapper = JsonMapper.builder().build()

/**
 * O que as condições enxergam de uma requisição, tirado da mensagem gravada (na captura e no
 * `rules/test`, a mesma visão): [path] é o caminho após o token, decodificado, sem a barra final
 * (como a `url` gravada) e `/` quando vazio; [query] e [headers] são os valores gravados (cabeçalho em
 * minúsculas, com `_` virando `-`).
 */
class MatchInput(
    val method: String,
    val path: String,
    val query: Map<String, String>,
    val headers: Map<String, String>,
    val body: String,
) {
    /** O corpo como JSON, lido uma vez e só se alguma condição pedir; `null` se não for JSON. */
    val json: JsonNode? by lazy {
        try {
            bodyMapper.readTree(body)?.takeUnless { it.isMissingNode }
        } catch (_: JacksonException) {
            null
        }
    }

    /** O corpo como `Map`/`List` do Java, a forma que o JSONPath percorre. */
    val document: Any? by lazy { json?.let { bodyMapper.treeToValue(it, Any::class.java) } }
}

fun CapturedRequest.toMatchInput(): MatchInput =
    MatchInput(
        method = method,
        path = pathAfterToken(),
        query = query?.let(::queryValues).orEmpty(),
        headers = headers.mapValues { (_, values) -> values.lastOrNull().orEmpty() },
        body = content,
    )

private fun CapturedRequest.pathAfterToken(): String {
    val afterScheme = url.substringAfter("://")
    val raw = afterScheme.substring(afterScheme.indexOf('/').takeIf { it >= 0 } ?: afterScheme.length).substringBefore('?')
    return percentDecode(raw.removePrefix("/$tokenId")).ifEmpty { "/" }
}

/** Só `%XX` vira caractere (`+` fica); escape inválido deixa o caminho como chegou. */
private fun percentDecode(path: String): String =
    try {
        URLDecoder.decode(path.replace("+", "%2B"), UTF_8)
    } catch (_: IllegalArgumentException) {
        path
    }

/** Query no formato do PHP: objeto nome → valor, ou lista (nomes são os índices). Valor que não é texto vira o JSON dele. */
private fun queryValues(query: JsonNode): Map<String, String> {
    val entries =
        if (query.isArray) query.mapIndexed { index, value -> index.toString() to value } else query.properties().map { it.toPair() }
    return entries.associate { (name, value) -> name to if (value.isValueNode) value.asString() else value.toString() }
}
