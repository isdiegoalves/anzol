package site.webhook.rules

import com.github.jknack.handlebars.Context
import com.github.jknack.handlebars.Helper
import com.github.jknack.handlebars.Options
import com.github.jknack.handlebars.helper.EachHelper
import com.github.jknack.handlebars.helper.IfHelper
import com.github.jknack.handlebars.helper.LookupHelper
import com.github.jknack.handlebars.helper.UnlessHelper
import com.github.jknack.handlebars.helper.WithHelper
import site.webhook.signature.HmacAlgorithm
import site.webhook.signature.SignatureConfig
import site.webhook.signature.SignatureEncoding
import site.webhook.signature.hmacOf
import java.math.BigDecimal
import java.math.MathContext
import java.time.DateTimeException
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.util.concurrent.ThreadLocalRandom

internal const val NOW_DATA = "site.webhook.now"
internal const val VALIDATING_DATA = "site.webhook.validating"
internal const val SIGNING_DATA = "site.webhook.signing"
private const val DEFAULT_RANDOM_LENGTH = 16
private val RANDOM_LENGTH = 1..10_000

/** `math`: texto de cada operando até este tamanho (acima, nem é lido como número). */
private const val MAX_NUMBER_TEXT = 256

/** `math`: operandos e resultado com até 100 dígitos na parte inteira e até 100 casas decimais. */
private const val MAX_DIGITS = 100

private val RANDOM_ALPHABETS =
    mapOf(
        "ALPHANUMERIC" to "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        "NUMERIC" to "0123456789",
        "HEX" to "0123456789abcdef",
    )
private val ISO_SECONDS: DateTimeFormatter = DateTimeFormatter.ISO_INSTANT

/**
 * Os únicos helpers: os de lógica do Handlebars (sem E/S), os quatro do Anexo B e o `hmac` (segredo da URL). Ficam de fora os
 * embutidos que leem arquivo ou classpath (`embedded`, `partial`, `block`, `precompile`, `i18n`,
 * `i18nJs`), o `log` (escreve no log do servidor) e o `helperMissing` (sem ele,
 * helper desconhecido é erro de compilação, o que dá o 422 ao salvar). Nenhum helper em JavaScript
 * (o Nashorn nem entra no classpath).
 */
internal val HELPERS: Map<String, Helper<*>> =
    mapOf(
        IfHelper.NAME to block(IfHelper.NAME, IfHelper.INSTANCE),
        UnlessHelper.NAME to block(UnlessHelper.NAME, UnlessHelper.INSTANCE),
        EachHelper.NAME to block(EachHelper.NAME, EachHelper.INSTANCE),
        WithHelper.NAME to block(WithHelper.NAME, WithHelper.INSTANCE),
        LookupHelper.NAME to withParams(LookupHelper.NAME, 2) { target, options -> lookup(target, options) },
        "jsonPath" to withParams("jsonPath", 2) { body, options -> jsonPathValue(body, options.param<Any?>(0), options) },
        "now" to withParams("now", 0) { _, options -> formatNow(options.data(NOW_DATA), options.hash<Any?>("format")) },
        "randomValue" to
            withParams("randomValue", 0) { _, options ->
                randomValue(options.hash<Any?>("type"), options.hash<Any?>("length"), validating = options.validating())
            },
        "math" to withParams("math", 3) { left, options -> math(left, options.param<Any?>(0), options.param<Any?>(1)) },
        "hmac" to withParams("hmac", 1) { value, options -> hmac(value, options) },
    )

/**
 * Helper que exige [count] parâmetros: faltando, a validação ao salvar recusa (422) e a execução deixa
 * o trecho vazio (o Handlebars.java aceitaria `{{#if}}` ou `{{#each}}` sem parâmetro, sobre o contexto).
 * Com dois ou mais, conta `options.params` (os depois do primeiro): o `PARAM_SIZE` de uma tag simples
 * é sobrescrito por uma subexpressão no primeiro parâmetro (`{{math (jsonPath …) '*' 2}}`). Com um,
 * vale o `PARAM_SIZE`, que num bloco é gravado depois de avaliar o parâmetro. Toda chamada de helper
 * confere o prazo da renderização ([RenderBudget.tick]).
 */
private fun withParams(
    name: String,
    count: Int,
    helper: Helper<Any?>,
): Helper<Any?> =
    Helper { context, options ->
        options.budget().tick()
        val enough =
            when (count) {
                0 -> true
                1 -> (options.data<Int?>(Context.PARAM_SIZE) ?: 0) >= 1
                else -> options.params.size >= count - 1
            }
        when {
            enough -> helper.apply(context, options)
            options.validating() -> throw IllegalArgumentException("$name requires $count parameter(s)")
            else -> ""
        }
    }

/**
 * Bloco embutido com um parâmetro; na validação renderiza os dois ramos, para achar erro em qualquer um.
 * Os ramos escrevem direto no buffer do bloco de fora ([streamingTo]), sem virar texto em memória.
 */
private fun <T> block(
    name: String,
    helper: Helper<T>,
): Helper<Any?> =
    withParams(name, 1) { context, options ->
        val out = options.buffer()
        val streaming = options.streamingTo(AppendableWriter(out))
        if (options.validating()) {
            streaming.fn()
            streaming.inverse()
        } else {
            @Suppress("UNCHECKED_CAST")
            helper.apply(context as T, streaming)
        }
        out
    }

private fun Options.validating(): Boolean = data<Boolean?>(VALIDATING_DATA) == true

/** Como o `lookup` do Handlebars.java, mas chave ausente sai vazia (lá sai o objeto inteiro), como no Handlebars JS. */
private fun lookup(
    target: Any?,
    options: Options,
): Any? = target?.let { Context.newBuilder(options.context, it).build().get(options.param<Any?>(0).toString()) }

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

/**
 * `{{hmac valor algorithm="sha256" encoding="hex"}}`: o HMAC do valor (texto ou número) com o segredo de verificação de
 * assinatura da URL ([SIGNING_DATA]). Algoritmo ou codificação fora dos aceitos: na validação recusa o template (422);
 * ao responder, o trecho sai vazio, como sai sem segredo configurado ou com valor que não é texto.
 */
private fun hmac(
    value: Any?,
    options: Options,
): String {
    val algorithmId = (options.hash<Any?>("algorithm") ?: HmacAlgorithm.SHA256.id).toString()
    val encodingId = (options.hash<Any?>("encoding") ?: SignatureEncoding.HEX.id).toString()
    val algorithm = HmacAlgorithm.entries.firstOrNull { it.id == algorithmId }
    val encoding = SignatureEncoding.entries.firstOrNull { it.id == encodingId }
    val validating = options.validating()
    require(algorithm != null || !validating) { "hmac algorithm must be one of ${HmacAlgorithm.entries.joinToString(", ") { it.id }}" }
    require(encoding != null || !validating) { "hmac encoding must be one of ${SignatureEncoding.entries.joinToString(", ") { it.id }}" }
    val signing = options.data<SignatureConfig?>(SIGNING_DATA)
    val text = value.takeIf { it is String || it is Number }?.toString()
    return when {
        signing == null || algorithm == null || encoding == null || text == null -> ""
        else -> signing.hmacOf(text, algorithm, encoding)
    }
}

/** `length` que não é inteiro de 1 a 10000: na validação recusa o template (422); ao responder, o trecho sai vazio. */
private fun randomValue(
    type: Any?,
    length: Any?,
    validating: Boolean,
): String {
    val size = (length ?: DEFAULT_RANDOM_LENGTH).toString().toIntOrNull()?.takeIf { it in RANDOM_LENGTH }
    require(size != null || !validating) { "randomValue length must be between ${RANDOM_LENGTH.first} and ${RANDOM_LENGTH.last}" }
    val random = ThreadLocalRandom.current()
    val alphabet = RANDOM_ALPHABETS[type?.toString()?.uppercase()]
    return when {
        size == null -> ""
        type?.toString()?.uppercase() == "UUID" -> UUID.randomUUID().toString()
        alphabet == null -> ""
        else -> String(CharArray(size) { alphabet[random.nextInt(alphabet.length)] })
    }
}

/**
 * Conta de `math`. Operando ou resultado com mais de [MAX_DIGITS] dígitos na parte inteira ou nas casas
 * decimais (ex.: `1e999999999`, que por extenso teria um bilhão de dígitos) deixa o trecho vazio.
 */
private fun math(
    left: Any?,
    operator: Any?,
    right: Any?,
): String {
    val a = number(left)
    val b = number(right)
    val result =
        when {
            a == null || b == null -> null
            operator == "+" -> a.add(b)
            operator == "-" -> a.subtract(b)
            operator == "*" -> a.multiply(b)
            operator == "/" && b.signum() != 0 -> a.divide(b, MathContext.DECIMAL64)
            else -> null
        }
    return result
        ?.stripTrailingZeros()
        ?.takeIf { it.withinDigits() }
        ?.toPlainString()
        .orEmpty()
}

private fun number(value: Any?): BigDecimal? =
    value
        ?.toString()
        ?.takeIf { it.length <= MAX_NUMBER_TEXT }
        ?.toBigDecimalOrNull()
        ?.takeIf { it.withinDigits() }

private fun BigDecimal.withinDigits(): Boolean = precision() - scale() <= MAX_DIGITS && scale() <= MAX_DIGITS
