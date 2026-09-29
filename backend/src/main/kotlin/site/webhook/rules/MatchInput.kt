package site.webhook.rules

import site.webhook.RequestId
import site.webhook.capture.CapturedRequest
import site.webhook.schema.SchemaResult
import site.webhook.signature.SignatureResult
import tools.jackson.core.JacksonException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.net.URLDecoder
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Instant
import java.time.ZoneOffset

/** Leitor do corpo e das frases do `failed`: JSON puro, sem as configurações da API. */
val bodyMapper: JsonMapper = JsonMapper.builder().build()

/**
 * O que as condições enxergam de uma requisição, tirado da mensagem gravada (na captura e no
 * `rules/test`, a mesma visão): [path] é o caminho após o token, decodificado, sem a barra final
 * (como a `url` gravada) e `/` quando vazio; [query] e [headers] são os valores gravados (cabeçalho em
 * minúsculas, com `_` virando `-`); [signature] e [schema] são os resultados gravados da verificação HMAC e da
 * validação do corpo (nulos sem configuração). [request] (o uuid, para o sorteio da `chance`) e [receivedAt] (o
 * `created_at`, para a janela) identificam a mensagem.
 */
data class MatchInput(
    val method: String,
    val path: String,
    val query: Map<String, String>,
    val headers: Map<String, String>,
    val body: String,
    val request: RequestId,
    val receivedAt: Instant,
    val signature: SignatureResult? = null,
    val schema: SchemaResult? = null,
) {
    /** O corpo como JSON, lido uma vez e só se alguma condição pedir; `null` se não for JSON. */
    val json: JsonNode? by lazy { readJson(body) }

    /** O corpo como `Map`/`List` do Java, a forma que o JSONPath percorre. */
    val document: Any? by lazy { json?.let(::jsonDocument) }
}

/** O texto como JSON; `null` se não for JSON. */
fun readJson(text: String): JsonNode? =
    try {
        bodyMapper.readTree(text)?.takeUnless { it.isMissingNode }
    } catch (_: JacksonException) {
        null
    }

/** A árvore como `Map`/`List` do Java, a forma que o JSONPath percorre. */
fun jsonDocument(tree: JsonNode): Any? = bodyMapper.treeToValue(tree, Any::class.java)

fun CapturedRequest.toMatchInput(): MatchInput =
    MatchInput(
        method = method,
        path = pathAfterToken(),
        query = query?.let(::queryValues).orEmpty(),
        headers = headers.mapValues { (_, values) -> values.lastOrNull().orEmpty() },
        body = content,
        request = uuid,
        receivedAt = createdAt.toInstant(ZoneOffset.UTC),
        signature = signature,
        schema = schema,
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
