package site.webhook.cli

import java.security.SecureRandom
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/** `{{{{` (escape de `{{`) ou um placeholder `{{…}}` numa linha só. */
private val MARK = Regex("""\{\{\{\{|\{\{(.*?)}}""")
private const val ESCAPE = "{{{{"
private val RANDOM = Regex("""random\s+(\d{1,3})""")
private val RANDOM_LENGTH = 1..256
private const val ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
private val secureRandom = SecureRandom()

/** Os valores de um envio: as tentativas dele (retentativas do mesmo evento) usam o que foi resolvido uma vez. */
data class Event(
    val seq: Int,
    val at: Instant,
    val uuid: UUID,
)

/** Um pedaço do template: texto literal ou um placeholder. */
private sealed interface Segment {
    data class Text(
        val value: String,
    ) : Segment

    data object Uuid : Segment

    data object Now : Segment

    data object Timestamp : Segment

    data object Seq : Segment

    data class Random(
        val length: Int,
    ) : Segment
}

/** Corpo ou valor de header com placeholders, já validado; [render] resolve para um envio. */
class Template private constructor(
    private val segments: List<Segment>,
) {
    /** `{{random N}}` sorteia a cada chamada; o resto vem de [event]. */
    fun render(event: Event): String =
        segments.joinToString("") {
            when (it) {
                is Segment.Text -> it.value
                Segment.Uuid -> event.uuid.toString()
                Segment.Now -> event.at.truncatedTo(ChronoUnit.SECONDS).toString()
                Segment.Timestamp -> event.at.epochSecond.toString()
                Segment.Seq -> event.seq.toString()
                is Segment.Random -> String(CharArray(it.length) { ALPHANUMERIC[secureRandom.nextInt(ALPHANUMERIC.length)] })
            }
        }

    companion object {
        /** Lê [text]; placeholder desconhecido ou `{{` sem fechar é [IllegalArgumentException] com o motivo. */
        fun parse(text: String): Template {
            val segments = mutableListOf<Segment>()
            var literalStart = 0
            MARK.findAll(text).forEach { mark ->
                segments += literal(text.substring(literalStart, mark.range.first))
                segments += if (mark.value == ESCAPE) Segment.Text("{{") else placeholder(mark.value, mark.groupValues[1].trim())
                literalStart = mark.range.last + 1
            }
            segments += literal(text.substring(literalStart))
            return Template(segments)
        }

        private fun literal(text: String): Segment.Text {
            require("{{" !in text) { "unclosed {{" }
            return Segment.Text(text)
        }

        private fun placeholder(
            mark: String,
            name: String,
        ): Segment {
            val random = RANDOM.matchEntire(name)
            return when {
                name == "uuid" -> Segment.Uuid
                name == "now" -> Segment.Now
                name == "timestamp" -> Segment.Timestamp
                name == "seq" -> Segment.Seq
                random != null -> randomOf(mark, random.groupValues[1].toInt())
                else -> throw IllegalArgumentException("unknown placeholder $mark")
            }
        }

        private fun randomOf(
            mark: String,
            length: Int,
        ): Segment {
            require(length in RANDOM_LENGTH) { "{{random N}} takes N from ${RANDOM_LENGTH.first} to ${RANDOM_LENGTH.last}: $mark" }
            return Segment.Random(length)
        }
    }
}
