package site.webhook.http

import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.HttpStatusCode
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.util.HtmlUtils

/** `default_mimetype` do PHP-FPM: o Content-Type das páginas e das respostas em que o Symfony não põe um. */
const val PHP_DEFAULT_CONTENT_TYPE = "text/html; charset=UTF-8"

/** Envelope de `Exceptions/Handler::renderJson` (sem os campos de depuração do `APP_DEBUG`). */
data class ErrorEnvelope(
    val success: Boolean,
    val error: ErrorDetail,
)

data class ErrorDetail(
    val message: String,
    val id: String?,
)

/** Mensagem do 400 de um pedido JSON cujo corpo não é um objeto JSON. */
const val MALFORMED_JSON_MESSAGE = "The body must be a valid JSON object."

/**
 * O ponto único por onde uma rota de gestão lê os campos do corpo ([LegacyInput.inputBag]). Recusa (400, no envelope
 * de erro) o pedido com `Content-Type` JSON cujo corpo não é um objeto JSON, antes de qualquer leitura ou gravação:
 * lido como entrada vazia, o `POST /token` criaria com os padrões, o `PUT` voltaria a URL inteira aos padrões e o
 * link só-leitura nasceria com os padrões. As rotas que leem o corpo cru e o validam por conta própria (regras, busca,
 * espera, envio, IA) respondem o 422 delas. O `MalformedJsonCoverageApiTest` percorre os mapeamentos para provar que
 * nenhuma rota aceita JSON quebrado.
 */
fun HttpServletRequest.requireJsonObject(): LegacyInput =
    legacyInput().also { if (it.malformedJson) throw ResponseStatusException(HttpStatus.BAD_REQUEST, MALFORMED_JSON_MESSAGE) }

/** `$request->ajax() || $request->wantsJson() || $request->isJson()`: quem recebe erro em JSON. */
fun HttpServletRequest.wantsJsonError(): Boolean = isAjax() || wantsJson() || isLaravelJson(contentType.orEmpty())

/** `FormRequest::expectsJson()`: quem recebe o 422; os demais são redirecionados. */
fun HttpServletRequest.expectsJson(): Boolean = (isAjax() && getHeader("X-PJAX") == null) || wantsJson()

private fun HttpServletRequest.isAjax(): Boolean = getHeader("X-Requested-With") == "XMLHttpRequest"

/** `Request::wantsJson()`: o tipo de maior qualidade do Accept contém `/json` ou `+json`. */
private fun HttpServletRequest.wantsJson(): Boolean {
    val preferred =
        getHeader(HttpHeaders.ACCEPT)
            .orEmpty()
            .split(',')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .sortedByDescending { item -> item.qualityParameter() }
            .firstOrNull()
            .orEmpty()
    return "/json" in preferred || "+json" in preferred
}

private fun String.qualityParameter(): Double =
    split(';')
        .drop(1)
        .map { it.trim() }
        .firstOrNull { it.startsWith("q=") }
        ?.removePrefix("q=")
        ?.toDoubleOrNull() ?: 1.0

/** Erro no formato do app antigo: JSON para cliente de API, página HTML para os demais. */
fun HttpServletRequest.legacyError(
    status: HttpStatusCode,
    message: String,
    headers: HttpHeaders = HttpHeaders(),
): ResponseEntity<Any> {
    val builder = ResponseEntity.status(status).headers(headers)
    return if (wantsJsonError()) {
        builder.contentType(MediaType.APPLICATION_JSON).body(ErrorEnvelope(success = false, error = ErrorDetail(message, id = null)))
    } else {
        builder.header(HttpHeaders.CONTENT_TYPE, PHP_DEFAULT_CONTENT_TYPE).body(errorPage(status, message))
    }
}

private fun errorPage(
    status: HttpStatusCode,
    message: String,
): String {
    val escaped = HtmlUtils.htmlEscape(message)
    val title = if (status.value() == HttpStatus.GONE.value()) "Error: $escaped" else "$status"
    return "<!DOCTYPE html>\n<html>\n<head>\n    <title>$title</title>\n</head>\n<body>\n" +
        "<h1>Error</h1>\n<p class=\"lead\">$escaped</p>\n<p><a href=\"/\">Back to Anzol &rarr;</a></p>\n</body>\n</html>\n"
}

/**
 * Falha de validação do `FormRequest`: 422 com `{campo: [mensagens]}` para quem espera JSON ou manda JSON (o
 * `Content-Type` JSON já basta para receber os outros erros em JSON, ver [wantsJsonError]); para os demais (o
 * formulário e a query string sem `Accept`), 302 para a página anterior (Referer) ou para a raiz, como o Laravel faz.
 */
fun HttpServletRequest.validationFailure(errors: Map<String, List<String>>): ResponseEntity<Any> {
    if (expectsJson() || isLaravelJson(contentType.orEmpty())) {
        return ResponseEntity.unprocessableContent().contentType(MediaType.APPLICATION_JSON).body(errors)
    }
    val target = previousUrl()
    val escaped = HtmlUtils.htmlEscape(target)
    return ResponseEntity
        .status(HttpStatus.FOUND)
        .header(HttpHeaders.LOCATION, target)
        .header(HttpHeaders.CONTENT_TYPE, PHP_DEFAULT_CONTENT_TYPE)
        .body(
            "<!DOCTYPE html>\n<html>\n    <head>\n        <meta charset=\"UTF-8\" />\n" +
                "        <meta http-equiv=\"refresh\" content=\"0;url=$escaped\" />\n\n" +
                "        <title>Redirecting to $escaped</title>\n    </head>\n" +
                "    <body>\n        Redirecting to <a href=\"$escaped\">$escaped</a>.\n    </body>\n</html>",
        )
}

/** `UrlGenerator::previous()`: o Referer se for URL, senão a raiz do site. */
private fun HttpServletRequest.previousUrl(): String {
    val root = "$scheme://${getHeader(HttpHeaders.HOST) ?: serverName}"
    val referer = getHeader(HttpHeaders.REFERER)
    return when {
        referer.isNullOrEmpty() -> root
        referer.startsWith("http://") || referer.startsWith("https://") || referer.startsWith("//") -> referer
        else -> "$root/${referer.trimStart('/')}"
    }
}
