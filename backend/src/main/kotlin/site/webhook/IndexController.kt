package site.webhook

import org.springframework.core.io.ClassPathResource
import org.springframework.http.HttpHeaders
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import site.webhook.http.PHP_DEFAULT_CONTENT_TYPE

/** `GET /`: a página do app. O build do Angular entra no item 05; até lá, uma página simples. */
@RestController
class IndexController {
    private val page = ClassPathResource("static/index.html").contentAsByteArray

    @GetMapping("/")
    fun index(): ResponseEntity<ByteArray> = ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, PHP_DEFAULT_CONTENT_TYPE).body(page)
}
