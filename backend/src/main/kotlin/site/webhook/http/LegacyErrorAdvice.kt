package site.webhook.http

import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.ErrorResponse
import org.springframework.web.HttpRequestMethodNotSupportedException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.context.request.async.AsyncRequestNotUsableException
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.servlet.NoHandlerFoundException
import org.springframework.web.servlet.resource.NoResourceFoundException

/** Tratamento HTTP centralizado, no formato de `Exceptions/Handler.php`. */
@RestControllerAdvice
class LegacyErrorAdvice {
    private val log = LoggerFactory.getLogger(javaClass)

    /** 410 de token, 404 de mensagem, 410 de limite: a mensagem vai para o cliente. */
    @ExceptionHandler(ResponseStatusException::class)
    fun onStatus(
        error: ResponseStatusException,
        request: HttpServletRequest,
    ): ResponseEntity<Any> = request.legacyError(error.statusCode, error.reason.orEmpty(), error.headers)

    /** Rota inexistente e método não permitido: o Symfony responde com mensagem vazia. */
    @ExceptionHandler(NoHandlerFoundException::class, NoResourceFoundException::class, HttpRequestMethodNotSupportedException::class)
    fun onRouting(
        error: Exception,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        val routing = error as ErrorResponse
        return request.legacyError(routing.statusCode, "", routing.headers)
    }

    /** Cliente que desconectou (ex.: aba do SSE fechada): não há a quem responder. */
    @ExceptionHandler(AsyncRequestNotUsableException::class)
    fun onDisconnected() = Unit

    @ExceptionHandler(Exception::class)
    fun onUnexpected(
        error: Exception,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        log.error("Erro inesperado em {} {}", request.method, request.requestURI, error)
        return request.legacyError(HttpStatus.INTERNAL_SERVER_ERROR, "An internal error occurred")
    }
}
