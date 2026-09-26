package site.webhook.http

import jakarta.servlet.RequestDispatcher
import jakarta.servlet.http.HttpServletRequest
import org.springframework.boot.webmvc.error.ErrorController
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.HttpStatusCode
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/**
 * No lugar do `BasicErrorController` do Spring Boot: é para `/error` que o Tomcat despacha os
 * erros que não passam por controller (405 de método que o Spring MVC nem roteia, exceção num
 * filtro, 413). Saem no formato de `Exceptions/Handler.php` (envelope para cliente JSON, página
 * para os demais); o 413 sai na página do nginx, que no app antigo respondia antes do PHP.
 * Chamado direto, `/error` é rota inexistente (404), como no app antigo.
 */
@RestController
class LegacyErrorController : ErrorController {
    @RequestMapping("\${server.error.path:/error}")
    fun error(request: HttpServletRequest): ResponseEntity<Any> {
        val status =
            (request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE) as? Int)
                ?: return request.legacyError(HttpStatus.NOT_FOUND, "")
        return when {
            status == HttpStatus.CONTENT_TOO_LARGE.value() -> {
                ResponseEntity
                    .status(status)
                    .header(HttpHeaders.CONTENT_TYPE, "text/html; charset=utf-8")
                    .header(HttpHeaders.CONNECTION, "close")
                    .body(TOO_LARGE_PAGE)
            }

            HttpStatusCode.valueOf(status).is5xxServerError -> {
                request.legacyError(HttpStatusCode.valueOf(status), "An internal error occurred")
            }

            else -> {
                request.legacyError(HttpStatusCode.valueOf(status), "")
            }
        }
    }
}
