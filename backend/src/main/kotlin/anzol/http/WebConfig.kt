package anzol.http

import anzol.capture.WebhookController
import jakarta.servlet.http.HttpServletRequest
import org.apache.tomcat.util.buf.EncodedSolidusHandling
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory
import org.springframework.boot.web.server.WebServerFactoryCustomizer
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.boot.webmvc.autoconfigure.WebMvcRegistrations
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.filter.UrlHandlerFilter
import org.springframework.web.method.HandlerMethod
import org.springframework.web.servlet.HandlerExecutionChain
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import java.time.Clock

/** Valor do Tomcat para "sem limite". */
private const val UNLIMITED = -1

@Configuration
class WebConfig {
    @Bean
    fun clock(): Clock = Clock.systemUTC()

    /**
     * O conector aceita o que o nginx do app antigo deixava passar e o Tomcat recusaria com 400:
     * `%2F` e `%5C` no caminho (`/{token}/a%2Fb`), `\` cru, qualquer quantidade de cabeçalhos
     * (o nginx só limita o tamanho), e o `Host` e os escapes de [LegacyHttpProtocol].
     */
    @Bean
    fun nginxTolerantConnector(): WebServerFactoryCustomizer<TomcatServletWebServerFactory> =
        WebServerFactoryCustomizer { factory ->
            factory.protocol = LegacyHttpProtocol::class.java.name
            factory.addConnectorCustomizers({ connector ->
                connector.encodedSolidusHandling = EncodedSolidusHandling.PASS_THROUGH.value
                connector.encodedReverseSolidusHandling = EncodedSolidusHandling.PASS_THROUGH.value
                connector.allowBackslash = true
                (connector.protocolHandler as LegacyHttpProtocol).maxHeaderCount = UNLIMITED
            })
        }

    /** O Laravel ignora a `/` final na escolha da rota (`/token/{id}/` é `/token/{id}`). */
    @Bean
    fun trailingSlashFilter(): FilterRegistrationBean<UrlHandlerFilter> =
        FilterRegistrationBean(UrlHandlerFilter.trailingSlashHandler("/**").wrapRequest().build()).apply {
            order = Ordered.HIGHEST_PRECEDENCE + 1
        }

    /**
     * Preflight CORS (`OPTIONS` com `Origin` e `Access-Control-Request-Method`) para o webhook
     * chega ao controller, como no app antigo: é gravado e responde com os cabeçalhos do token.
     * Sem isto o Spring MVC responde o preflight sozinho e a mensagem se perde.
     */
    @Bean
    fun webhookPreflightPassThrough(): WebMvcRegistrations =
        object : WebMvcRegistrations {
            override fun getRequestMappingHandlerMapping(): RequestMappingHandlerMapping =
                object : RequestMappingHandlerMapping() {
                    override fun getCorsHandlerExecutionChain(
                        request: HttpServletRequest,
                        chain: HandlerExecutionChain,
                        config: CorsConfiguration?,
                    ): HandlerExecutionChain {
                        val handler = chain.handler
                        val isWebhook = handler is HandlerMethod && handler.beanType == WebhookController::class.java
                        return if (isWebhook) chain else super.getCorsHandlerExecutionChain(request, chain, config)
                    }
                }
        }
}
