package site.webhook.cli

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * Os padrões que o servidor preenche ao gravar uma regra (os mesmos do `GET /token/{id}/rules`): sem eles, todo arquivo
 * escrito à mão apareceria como alterado em `enabled`, `priority`, `response.status`…
 */
private val RULE_DEFAULTS =
    JsonObject(
        mapOf(
            "enabled" to JsonPrimitive(true),
            "priority" to JsonPrimitive(DEFAULT_PRIORITY),
            "match" to JsonObject(emptyMap()),
            "scenario" to JsonNull,
            "response" to JsonObject(emptyMap()),
        ),
    )

private val MATCH_DEFAULTS =
    JsonObject(
        mapOf(
            "method" to JsonArray(emptyList()),
            "path" to JsonNull,
            "query" to JsonObject(emptyMap()),
            "headers" to JsonObject(emptyMap()),
            "body" to JsonArray(emptyList()),
        ),
    )

private val RESPONSE_DEFAULTS =
    JsonObject(
        mapOf(
            "status" to JsonPrimitive(DEFAULT_STATUS),
            "headers" to JsonObject(emptyMap()),
            "body" to JsonPrimitive(""),
            "template" to JsonPrimitive(false),
            "delay" to JsonNull,
            "dribble" to JsonNull,
            "fault" to JsonNull,
        ),
    )

private const val DEFAULT_PRIORITY = 5
private const val DEFAULT_STATUS = 200

/** O objeto com os padrões no lugar do que falta ou é `null` (a comparação trata ausente e `null` como iguais). */
private fun JsonObject.withDefaults(defaults: JsonObject): JsonObject =
    JsonObject((defaults.keys + keys).associateWith { name -> this[name]?.takeUnless { it is JsonNull } ?: defaults[name] ?: JsonNull })

/** A regra como o servidor a gravaria, para comparar: padrões preenchidos em cima, em `match` e em `response`. */
private fun JsonObject.normalizedRule(): JsonObject {
    val rule = withDefaults(RULE_DEFAULTS)
    return JsonObject(
        rule +
            mapOf(
                "match" to ((rule["match"] as? JsonObject)?.withDefaults(MATCH_DEFAULTS) ?: JsonNull),
                "response" to ((rule["response"] as? JsonObject)?.withDefaults(RESPONSE_DEFAULTS) ?: JsonNull),
            ),
    )
}

private fun JsonObject.id(): String? = (this["id"] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.name(): String = (this["name"] as? JsonPrimitive)?.contentOrNull.orEmpty()

/**
 * O resumo do `diff_rules` do servidor, calculado aqui: a lista [proposed] contra as regras salvas [saved], por `id`
 * (regra sem `id`, ou com um que a URL não tem, é nova), com os padrões preenchidos dos dois lados.
 * `{equal: [id], changed: [{id, name, fields}], removed: [{id, name}], added: [{id?, name}]}`.
 */
fun diffRules(
    saved: List<JsonObject>,
    proposed: List<JsonObject>,
): JsonObject {
    val savedById = saved.associateBy { it.id() }
    val kept = proposed.filter { it.id() != null && it.id() in savedById }
    val fields = kept.associate { it.id() to changedFields(savedById.getValue(it.id()).normalizedRule(), it.normalizedRule()) }
    val proposedIds = proposed.mapNotNull { it.id() }.toSet()
    return buildJsonObject {
        putJsonArray("equal") { kept.filter { fields.getValue(it.id()).isEmpty() }.forEach { add(JsonPrimitive(it.id())) } }
        putJsonArray("changed") {
            kept.filter { fields.getValue(it.id()).isNotEmpty() }.forEach { rule ->
                add(
                    buildJsonObject {
                        put("id", rule.id())
                        put("name", rule.name())
                        putJsonArray("fields") { fields.getValue(rule.id()).forEach { add(JsonPrimitive(it)) } }
                    },
                )
            }
        }
        putJsonArray("removed") {
            saved.filter { it.id() !in proposedIds }.forEach {
                add(
                    buildJsonObject {
                        put("id", it.id())
                        put("name", it.name())
                    },
                )
            }
        }
        putJsonArray("added") {
            proposed.filter { it.id() == null || it.id() !in savedById }.forEach { rule ->
                add(
                    buildJsonObject {
                        rule.id()?.let { put("id", it) }
                        put("name", rule.name())
                    },
                )
            }
        }
    }
}

/** Os caminhos (em pontos) em que [before] e [after] diferem; lista, texto ou número diferente é uma folha. Sem o `id`. */
private fun changedFields(
    before: JsonElement,
    after: JsonElement,
    prefix: String = "",
): List<String> =
    when {
        before == after -> {
            emptyList()
        }

        before !is JsonObject || after !is JsonObject -> {
            listOf(prefix)
        }

        else -> {
            (before.keys + after.keys)
                .filterNot { prefix.isEmpty() && it == "id" }
                .flatMap { name ->
                    val path = if (prefix.isEmpty()) name else "$prefix.$name"
                    changedFields(before[name] ?: JsonNull, after[name] ?: JsonNull, path)
                }
        }
    }
