package anzol.rules

import com.fasterxml.jackson.annotation.JsonInclude
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/** Regra que muda: o nome proposto e os campos (em pontos, como as chaves do 422) que diferem da salva. */
data class ChangedRule(
    val id: RuleId,
    val name: String,
    val fields: List<String>,
)

/** Regra nova: [id] só quando a proposta o trouxe (um `id` que a URL não tem). */
data class AddedRule(
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val id: RuleId?,
    val name: String,
)

/** O que gravar a lista proposta mudaria nas regras salvas, comparando por `id`. */
data class RuleDiff(
    val equal: List<RuleId>,
    val changed: List<ChangedRule>,
    val removed: List<RuleRef>,
    val added: List<AddedRule>,
)

/**
 * A lista proposta [proposed] (já lida por [parseRules], com os padrões preenchidos) contra as regras salvas. As regras
 * que chegaram sem `id` ([withoutId]; o leitor deu um novo a elas) são novas, como as de `id` que a URL não tem. A
 * comparação é pelo JSON da API de cada regra, então só diferença que o `set_rules` gravaria conta.
 */
fun List<Rule>.diff(
    proposed: List<Rule>,
    withoutId: Set<RuleId>,
    jsonMapper: JsonMapper,
): RuleDiff {
    val saved = associateBy { it.id }
    val kept = proposed.filter { it.id !in withoutId && it.id in saved }
    val fields = kept.associate { it.id to changedFields(jsonMapper.valueToTree(saved.getValue(it.id)), jsonMapper.valueToTree(it)) }
    val proposedIds = proposed.map { it.id }.toSet()
    return RuleDiff(
        equal = kept.filter { fields.getValue(it.id).isEmpty() }.map { it.id },
        changed = kept.filter { fields.getValue(it.id).isNotEmpty() }.map { ChangedRule(it.id, it.name, fields.getValue(it.id)) },
        removed = filter { it.id !in proposedIds }.map { RuleRef(it.id, it.name) },
        added =
            proposed
                .filter { it.id in withoutId || it.id !in saved }
                .map { AddedRule(it.id.takeUnless { id -> id in withoutId }, it.name) },
    )
}

/** Os `id`s que o leitor gerou: os das regras da lista [tree] que chegaram sem `id` (ou com `null`). */
fun List<Rule>.generatedIds(tree: JsonNode): Set<RuleId> =
    filterIndexed { index, _ -> tree[index]?.get("id").given() == null }.map { it.id }.toSet()

/**
 * Os caminhos (em pontos) em que [before] e [after] diferem: desce pelos objetos; lista, texto ou número diferente é
 * uma folha. O `id` não conta.
 */
private fun changedFields(
    before: JsonNode,
    after: JsonNode,
    prefix: String = "",
): List<String> =
    when {
        before == after -> {
            emptyList()
        }

        !before.isObject || !after.isObject -> {
            listOf(prefix)
        }

        else -> {
            (before.propertyNames() + after.propertyNames())
                .distinct()
                .filterNot { prefix.isEmpty() && it == "id" }
                .flatMap { name -> changedFields(before[name] ?: MISSING, after[name] ?: MISSING, key(prefix, name)) }
        }
    }

private val MISSING: JsonNode = bodyMapper.nullNode()
