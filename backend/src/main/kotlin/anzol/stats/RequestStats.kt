package anzol.stats

import anzol.TIMESTAMP_PATTERN
import anzol.capture.CapturedRequest
import anzol.capture.RequestStore
import anzol.capture.ScanBatch
import anzol.capture.Sorting
import anzol.e2ee.DecryptionState
import anzol.rules.NearMiss
import anzol.rules.RuleId
import anzol.rules.RuleRef
import anzol.schema.SchemaState
import anzol.signature.SignatureResult
import anzol.signature.SignatureState
import anzol.token.Token
import com.fasterxml.jackson.annotation.JsonFormat
import org.springframework.stereotype.Component
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.annotation.JsonNaming
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit

/** A janela padrão e a maior: a mesma do `rules/test`. */
const val MAX_STATS_WINDOW = 500

/** Quantos motivos de assinatura e de decifra, e caminhos de schema, a resposta lista. */
private const val TOP = 10

/** Quantas entradas do índice cada leitura traz: na memória fica um trecho, não a janela inteira de corpos. */
private const val SCAN_BATCH = 100

/** O parêntese final do motivo (`timestamp outside tolerance (412 s)`), que varia de mensagem para mensagem. */
private val TRAILING_DETAIL = Regex("""\s*\([^()]*\)$""")

/** O motivo da assinatura sem o detalhe entre parênteses do fim (`timestamp outside tolerance (412 s)`): o do `/stats` e o da busca. */
fun String.withoutTrailingDetail(): String = replace(TRAILING_DETAIL, "")

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class RequestStats(
    val window: Int,
    val evaluated: Int,
    val total: Long,
    val newestSeq: Long?,
    val oldestSeq: Long?,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val newestAt: LocalDateTime?,
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val oldestAt: LocalDateTime?,
    val methods: Map<String, Int>,
    val signature: SignatureStats,
    val schema: SchemaStats,
    val rules: RuleStats,
    val hourly: List<HourStats>,
    val decryption: DecryptionStats,
)

data class SignatureStats(
    val valid: Int,
    val invalid: Int,
    val absent: Int,
    val unchecked: Int,
    val reasons: List<ReasonCount>,
)

data class ReasonCount(
    val reason: String,
    val count: Int,
)

data class SchemaStats(
    val valid: Int,
    val invalid: Int,
    val unchecked: Int,
    val paths: List<PathCount>,
)

data class PathCount(
    val path: String,
    val count: Int,
)

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class RuleStats(
    val answered: List<RuleCount>,
    val nearMiss: List<RuleCount>,
    val default: Int,
)

data class RuleCount(
    val id: RuleId,
    val name: String,
    val count: Int,
)

data class HourStats(
    @field:JsonFormat(pattern = TIMESTAMP_PATTERN)
    val hour: LocalDateTime,
    val count: Int,
    val methods: Map<String, Int>,
)

/** O que a estatística lê de uma mensagem: sem corpo, cabeçalhos nem query. */
data class StatsSample(
    val seq: Long,
    val createdAt: LocalDateTime,
    val method: String,
    val signature: SignatureResult?,
    val schemaState: SchemaState?,
    val schemaPaths: Set<String>,
    val rule: RuleRef?,
    val nearMiss: NearMiss?,
    val decryptionState: DecryptionState?,
    val decryptionReason: String?,
)

fun CapturedRequest.toStatsSample(): StatsSample =
    StatsSample(
        seq = checkNotNull(seq) { "mensagem lida do Redis sempre tem seq" },
        createdAt = createdAt,
        method = method,
        signature = signature,
        schemaState = schema?.state(),
        schemaPaths =
            schema
                ?.errors
                .orEmpty()
                .map { it.path }
                .toSet(),
        rule = rule,
        nearMiss = nearMiss,
        decryptionState = decryption?.state,
        decryptionReason = decryption?.reason,
    )

/**
 * `GET /token/{id}/stats`: as [MAX_STATS_WINDOW] (ou `window`) mensagens mais novas da URL, resumidas. Só lê: nada é
 * gravado. A varredura é pelo índice, em trechos, e de cada mensagem fica só o [StatsSample].
 */
@Component
class RequestStatistics(
    private val requests: RequestStore,
) {
    fun of(
        token: Token,
        window: Int,
    ): RequestStats {
        val samples =
            batches(token, minOf(window, SCAN_BATCH).toLong())
                .flatMap { it.messages }
                .take(window)
                .map { it.toStatsSample() }
                .toList()
        return samples.toStats(window = window, total = requests.count(token))
    }

    private fun batches(
        token: Token,
        limit: Long,
    ): Sequence<ScanBatch> =
        generateSequence(requests.scan(token, Sorting.NEWEST, from = null, limit = limit)) { previous ->
            previous.next?.let { requests.scan(token, Sorting.NEWEST, from = it, limit = limit) }
        }
}

/** As amostras, da mais nova para a mais antiga, resumidas. */
fun List<StatsSample>.toStats(
    window: Int,
    total: Long,
): RequestStats =
    RequestStats(
        window = window,
        evaluated = size,
        total = total,
        newestSeq = firstOrNull()?.seq,
        oldestSeq = lastOrNull()?.seq,
        newestAt = firstOrNull()?.createdAt,
        oldestAt = lastOrNull()?.createdAt,
        methods = map { it.method }.countedByFrequency(),
        signature = signatureStats(),
        schema = schemaStats(),
        rules = ruleStats(),
        hourly = hourly(),
        decryption = decryptionStats(),
    )

private fun List<StatsSample>.signatureStats(): SignatureStats {
    val states = groupingBy { it.signature?.state() }.eachCount()
    val reasons =
        mapNotNull { it.signature?.reason }
            .map { it.withoutTrailingDetail() }
            .ranked()
            .map { (reason, count) -> ReasonCount(reason, count) }
    return SignatureStats(
        valid = states[SignatureState.VALID] ?: 0,
        invalid = states[SignatureState.INVALID] ?: 0,
        absent = states[SignatureState.ABSENT] ?: 0,
        unchecked = states[null] ?: 0,
        reasons = reasons,
    )
}

/** Cada caminho conta uma vez por mensagem (`""` é a raiz). */
private fun List<StatsSample>.schemaStats(): SchemaStats {
    val states = groupingBy { it.schemaState }.eachCount()
    return SchemaStats(
        valid = states[SchemaState.VALID] ?: 0,
        invalid = states[SchemaState.INVALID] ?: 0,
        unchecked = states[null] ?: 0,
        paths = flatMap { it.schemaPaths }.ranked().map { (path, count) -> PathCount(path, count) },
    )
}

private fun List<StatsSample>.ruleStats(): RuleStats =
    RuleStats(
        answered = mapNotNull { it.rule }.map { it.id to it.name }.byRule(),
        nearMiss = mapNotNull { it.nearMiss }.map { it.id to it.name }.byRule(),
        default = count { it.rule == null },
    )

/** Contagem por regra, com o nome da ocorrência mais nova (a primeira: a lista vem da mais nova para a mais antiga). */
private fun List<Pair<RuleId, String>>.byRule(): List<RuleCount> =
    groupBy({ it.first }, { it.second })
        .map { (id, names) -> RuleCount(id, names.first(), names.size) }
        .sortedWith(compareByDescending<RuleCount> { it.count }.thenBy { it.name }.thenBy { it.id.toString() })

/** As horas UTC com pelo menos uma mensagem, da mais antiga para a mais nova. */
private fun List<StatsSample>.hourly(): List<HourStats> =
    groupBy { it.createdAt.truncatedTo(ChronoUnit.HOURS) }
        .toSortedMap()
        .map { (hour, samples) -> HourStats(hour, samples.size, samples.map { it.method }.countedByFrequency()) }

/** Contagem por texto, do mais frequente ao menos frequente (empate pelo texto). */
private fun List<String>.byFrequency(): List<Pair<String, Int>> =
    groupingBy { it }
        .eachCount()
        .toList()
        .sortedWith(compareByDescending<Pair<String, Int>> { it.second }.thenBy { it.first })

/** Os [TOP] textos mais frequentes, com a contagem (empate pelo texto). */
fun List<String>.ranked(): List<Pair<String, Int>> = byFrequency().take(TOP)

private fun List<String>.countedByFrequency(): Map<String, Int> = byFrequency().toMap()
