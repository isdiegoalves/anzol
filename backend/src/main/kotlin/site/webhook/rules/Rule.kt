package site.webhook.rules

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonValue
import com.jayway.jsonpath.JsonPath
import site.webhook.schema.SchemaState
import site.webhook.signature.SignatureState
import tools.jackson.databind.JsonNode
import java.util.UUID

@JvmInline
value class RuleId(
    val value: UUID,
) {
    override fun toString(): String = value.toString()
}

/**
 * Regra de resposta de uma URL, no formato do Anexo A do plano (fase A): condições em [match], todas
 * em E; a primeira regra ativa que casa, pela menor [priority] e depois pela ordem na lista, define a
 * resposta. Com [scenario], a regra só casa no estado exigido do cenário e o muda ao responder.
 */
data class Rule(
    val id: RuleId,
    val name: String,
    val enabled: Boolean,
    val priority: Int,
    val match: RuleMatch,
    val scenario: RuleScenario? = null,
    val response: RuleResponse,
)

/** Estado de todo cenário antes da primeira transição (como na WireMock). */
const val STARTED = "Started"

/**
 * Cenário da regra: ela só casa com o cenário [name] em [requiredState] (nulo = qualquer) e, ao
 * responder, o leva a [newState] (nulo = mantém). O estado é por URL e nome do cenário.
 */
data class RuleScenario(
    val name: String,
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val requiredState: String? = null,
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val newState: String? = null,
)

/**
 * Sem nenhuma condição, a regra casa qualquer requisição. Nome de cabeçalho fica como veio; a comparação ignora caixa.
 * [signature] é o estado da verificação HMAC da URL e [schema] o da validação do corpo; sem elas, as chaves nem
 * aparecem no JSON.
 */
data class RuleMatch(
    val method: List<String> = emptyList(),
    val path: PathMatcher? = null,
    val query: Map<String, FieldMatcher> = emptyMap(),
    val headers: Map<String, FieldMatcher> = emptyMap(),
    val body: List<BodyMatcher> = emptyList(),
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val signature: SignatureState? = null,
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val schema: SchemaState? = null,
)

/** Com [fault], a conexão falha no lugar da resposta e os demais campos são ignorados. */
data class RuleResponse(
    val status: Int = DEFAULT_RESPONSE_STATUS,
    val headers: Map<String, String> = emptyMap(),
    val body: String = "",
    val template: Boolean = false,
    val delay: Delay? = null,
    val dribble: Dribble? = null,
    val fault: Fault? = null,
)

const val DEFAULT_RESPONSE_STATUS = 200

/** Regex das condições: casa o valor inteiro (como a WireMock) e `.` atravessa linhas. */
fun conditionRegex(pattern: String): Regex = Regex(pattern, RegexOption.DOT_MATCHES_ALL)

/** Condição do caminho após o token; no JSON, `{equals|prefix|regex: texto}`. */
sealed interface PathMatcher {
    data class Equals(
        val value: String,
    ) : PathMatcher

    data class Prefix(
        val value: String,
    ) : PathMatcher

    data class Matches(
        val regex: Regex,
    ) : PathMatcher

    @JsonValue
    fun toJson(): Map<String, String> =
        when (this) {
            is Equals -> mapOf("equals" to value)
            is Prefix -> mapOf("prefix" to value)
            is Matches -> mapOf("regex" to regex.pattern)
        }
}

/** Condição de um parâmetro da query ou de um cabeçalho; no JSON, `{equals|contains|regex: texto}` ou `{present: bool}`. */
sealed interface FieldMatcher {
    data class Equals(
        val value: String,
    ) : FieldMatcher

    data class Contains(
        val value: String,
    ) : FieldMatcher

    data class Matches(
        val regex: Regex,
    ) : FieldMatcher

    data class Present(
        val expected: Boolean,
    ) : FieldMatcher

    @JsonValue
    fun toJson(): Map<String, Any> =
        when (this) {
            is Equals -> mapOf("equals" to value)
            is Contains -> mapOf("contains" to value)
            is Matches -> mapOf("regex" to regex.pattern)
            is Present -> mapOf("present" to expected)
        }
}

/**
 * Condição sobre o corpo. `JsonPathMatch` sem [JsonPathMatch.equals] exige só que o caminho exista;
 * `EqualToJson` guarda o valor como veio ([EqualToJson.source], objeto ou texto de um JSON) e a árvore
 * já lida ([EqualToJson.expected]).
 */
sealed interface BodyMatcher {
    data class Equals(
        val value: String,
    ) : BodyMatcher

    data class Contains(
        val value: String,
    ) : BodyMatcher

    data class Matches(
        val regex: Regex,
    ) : BodyMatcher

    data class JsonPathMatch(
        val path: String,
        val compiled: JsonPath,
        val equals: JsonNode?,
    ) : BodyMatcher

    data class EqualToJson(
        val source: JsonNode,
        val expected: JsonNode,
    ) : BodyMatcher

    @JsonValue
    fun toJson(): Map<String, Any> =
        when (this) {
            is Equals -> mapOf("equals" to value)
            is Contains -> mapOf("contains" to value)
            is Matches -> mapOf("regex" to regex.pattern)
            is JsonPathMatch -> mapOf("jsonPath" to listOfNotNull("path" to path, equals?.let { "equals" to it }).toMap())
            is EqualToJson -> mapOf("equalToJson" to source)
        }
}

/** `rule` da mensagem: a regra que respondeu. */
data class RuleRef(
    val id: RuleId,
    val name: String,
)

/** `near_miss` da mensagem: a regra ativa mais próxima de casar e uma frase por condição que falhou. */
data class NearMiss(
    val id: RuleId,
    val name: String,
    val failed: List<String>,
)
