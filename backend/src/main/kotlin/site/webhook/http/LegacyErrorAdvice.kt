package site.webhook.http

import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.dao.DataAccessException
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

/** Mensagem do 507: o Redis atingiu o `maxmemory` (política `noeviction`) e recusou a gravação. */
const val STORAGE_FULL_MESSAGE = "Storage is full; the request was not stored."

/** Tratamento HTTP centralizado, no formato de `Exceptions/Handler.php`. */
@RestControllerAdvice
class LegacyErrorAdvice {
    private val log = LoggerFactory.getLogger(javaClass)

    /** 410 de token, 404 de mensagem: a mensagem vai para o cliente. */
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

    /**
     * Redis no teto de memória (`maxmemory` + `noeviction`, docker-compose.yml): a gravação é recusada
     * inteira pelo Redis, sem estado parcial. Qualquer outra falha de acesso a dados segue como 500.
     */
    @ExceptionHandler(DataAccessException::class)
    fun onDataAccess(
        error: DataAccessException,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        if (!error.isRedisOutOfMemory()) return onUnexpected(error, request)
        log.warn("Redis cheio: {} {} recusado", request.method, request.requestURI)
        return request.legacyError(HttpStatus.INSUFFICIENT_STORAGE, STORAGE_FULL_MESSAGE)
    }

    @ExceptionHandler(Exception::class)
    fun onUnexpected(
        error: Exception,
        request: HttpServletRequest,
    ): ResponseEntity<Any> {
        log.error("Erro inesperado em {} {}", request.method, request.requestURI, error)
        return request.legacyError(HttpStatus.INTERNAL_SERVER_ERROR, "An internal error occurred")
    }
}

/** O Redis responde `OOM command not allowed when used memory > 'maxmemory'` quando recusa por falta de memória. */
private fun Throwable.isRedisOutOfMemory(): Boolean = generateSequence(this) { it.cause }.any { it.message?.startsWith("OOM ") == true }
