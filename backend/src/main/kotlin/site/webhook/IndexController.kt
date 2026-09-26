package site.webhook

import org.springframework.context.annotation.Configuration
import org.springframework.core.io.ClassPathResource
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import site.webhook.http.PHP_DEFAULT_CONTENT_TYPE

private const val FRONTEND_LOCATION = "classpath:/static/"

/**
 * `GET /`: o `index.html` do build do Angular, que o `Dockerfile` da raiz põe em `static/`.
 * Sem o build (backend rodando sozinho, com a tela no `ng serve`), responde o 404 de rota.
 */
@RestController
class IndexController {
    private val page = ClassPathResource("static/index.html")

    @GetMapping("/")
    fun index(): ResponseEntity<ByteArray> {
        if (!page.exists()) throw ResponseStatusException(HttpStatus.NOT_FOUND)
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, PHP_DEFAULT_CONTENT_TYPE).body(page.contentAsByteArray)
    }
}

/**
 * Arquivos do build do Angular, publicados na raiz (`main-<hash>.js`, `chunk-<hash>.js`,
 * `styles-<hash>.css`, `favicon.ico`). Só nomes com essas extensões: as rotas de webhook casam
 * UUID sem extensão, e qualquer outro caminho continua sendo 404 ou 405 de rota.
 */
@Configuration
class FrontendResources : WebMvcConfigurer {
    override fun addResourceHandlers(registry: ResourceHandlerRegistry) {
        registry.addResourceHandler("/*.js", "/*.css", "/*.ico").addResourceLocations(FRONTEND_LOCATION)
    }
}
