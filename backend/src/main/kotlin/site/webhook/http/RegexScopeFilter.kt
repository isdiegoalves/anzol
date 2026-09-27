package site.webhook.http

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import site.webhook.rules.withRegexMemo

/** Depois do `LegacyRequestFilter`, da barra final e do `AllowedHostFilter`; antes de qualquer controller. */
private const val REGEX_SCOPE_ORDER = Ordered.HIGHEST_PRECEDENCE + 3

/**
 * Cada requisição HTTP (webhook, `rules/test`, trace, busca, wait-for e as ferramentas do MCP) é um escopo do teto das
 * regex: o padrão que estoura nela não roda de novo até ela acabar ([withRegexMemo]).
 */
@Component
@Order(REGEX_SCOPE_ORDER)
class RegexScopeFilter : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) = withRegexMemo { filterChain.doFilter(request, response) }
}
