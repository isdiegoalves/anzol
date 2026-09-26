package site.webhook.support

import org.springframework.web.bind.annotation.RequestMethod
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping

/** Uma rota do Spring MVC: método e padrão como declarado (`/token/{tokenId:[0-9a-f]{8}-...}/requests`). */
data class Route(
    val method: String,
    val pattern: String,
) {
    /** O caminho com cada `{nome[:regex]}` trocado pelo valor de [values] (ou `x`), respeitando chaves aninhadas na regex. */
    fun path(values: Map<String, String>): String {
        val out = StringBuilder()
        var index = 0
        while (index < pattern.length) {
            if (pattern[index] != '{') {
                out.append(pattern[index++])
                continue
            }
            var depth = 0
            val start = index
            do {
                if (pattern[index] == '{') depth++
                if (pattern[index] == '}') depth--
                index++
            } while (depth > 0)
            val name = pattern.substring(start + 1, index - 1).substringBefore(':')
            out.append(values[name] ?: "x")
        }
        return out.toString().removeSuffix("/**")
    }

    override fun toString(): String = "$method $pattern"
}

/** Todas as rotas mapeadas por anotação; sem método declarado, a rota aceita todos: vale um só, [RequestMethod.GET]. */
fun RequestMappingHandlerMapping.routes(): List<Route> =
    handlerMethods.keys.flatMap { info ->
        val methods = info.methodsCondition.methods.ifEmpty { setOf(RequestMethod.GET) }
        info.patternValues.flatMap { pattern -> methods.map { Route(it.name, pattern) } }
    }
