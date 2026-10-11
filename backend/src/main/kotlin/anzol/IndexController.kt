package anzol

import anzol.http.PHP_DEFAULT_CONTENT_TYPE
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import org.springframework.context.annotation.Configuration
import org.springframework.core.io.ClassPathResource
import org.springframework.core.io.Resource
import org.springframework.http.CacheControl
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import org.springframework.web.servlet.resource.EncodedResourceResolver
import org.springframework.web.servlet.resource.ResourceResolver
import org.springframework.web.servlet.resource.ResourceResolverChain
import java.time.Duration

private const val FRONTEND_LOCATION = "classpath:/static/"
private val HASHED_NAME_MAX_AGE: Duration = Duration.ofDays(365)

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
 * `styles-<hash>.css`, `favicon.ico`) e as fontes auto-hospedadas, `.woff2` em `/fonts/` (a tela roda
 * offline, sem CDN). Só nomes com essas extensões: as rotas de webhook casam UUID sem extensão, e
 * qualquer outro caminho continua sendo 404 ou 405 de rota.
 *
 * As fontes vêm de `public/fonts/` sem hash no nome: `no-cache` faz o navegador revalidar
 * (`Last-Modified` → 304) e trocar a fonte assim que a imagem nova sobe.
 *
 * `main-*`, `chunk-*` e `styles-*` trocam de nome quando o conteúdo muda, e só eles saem `immutable`; o resto o
 * navegador revalida, a começar pelo `index.html`, que aponta para os nomes novos. O `.js` e o `.css` com um `.br`
 * ou um `.gz` ao lado (gerados no `Dockerfile` da raiz) saem comprimidos para quem os aceita.
 */
@Configuration
class FrontendResources : WebMvcConfigurer {
    override fun addResourceHandlers(registry: ResourceHandlerRegistry) {
        registry
            .addResourceHandler("/main-*.js", "/chunk-*.js", "/styles-*.css")
            .addResourceLocations(FRONTEND_LOCATION)
            .setCacheControl(CacheControl.maxAge(HASHED_NAME_MAX_AGE).cachePublic().immutable())
            .resourceChain(true)
            .addResolver(BrotliFirst())
            .addResolver(EncodedResourceResolver())
        registry
            .addResourceHandler("/*.js", "/*.css", "/*.ico")
            .addResourceLocations(FRONTEND_LOCATION)
            .resourceChain(true)
            .addResolver(BrotliFirst())
            .addResolver(EncodedResourceResolver())
        registry
            .addResourceHandler("/fonts/*.woff2")
            .addResourceLocations("${FRONTEND_LOCATION}fonts/")
            .setCacheControl(CacheControl.noCache())
    }
}

/**
 * Põe o `br` na frente do `Accept-Encoding` de quem o aceita. O `EncodedResourceResolver` escolhe pela ordem em que
 * o navegador lista, e os navegadores listam `gzip` primeiro: sem isto o `.br`, que é o menor, nunca sairia.
 */
private class BrotliFirst : ResourceResolver {
    override fun resolveResource(
        request: HttpServletRequest?,
        requestPath: String,
        locations: List<Resource>,
        chain: ResourceResolverChain,
    ): Resource? = chain.resolveResource(request?.withBrotliFirst(), requestPath, locations)

    override fun resolveUrlPath(
        resourcePath: String,
        locations: List<Resource>,
        chain: ResourceResolverChain,
    ): String? = chain.resolveUrlPath(resourcePath, locations)
}

private fun HttpServletRequest.withBrotliFirst(): HttpServletRequest {
    val accepted: String = getHeader(HttpHeaders.ACCEPT_ENCODING).orEmpty()
    if (accepted.split(",").none { it.substringBefore(';').trim().equals("br", ignoreCase = true) }) return this
    return object : HttpServletRequestWrapper(this) {
        override fun getHeader(name: String): String? =
            if (name.equals(HttpHeaders.ACCEPT_ENCODING, ignoreCase = true)) "br, $accepted" else super.getHeader(name)
    }
}
