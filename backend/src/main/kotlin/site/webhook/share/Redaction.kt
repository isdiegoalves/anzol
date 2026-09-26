package site.webhook.share

import site.webhook.capture.CapturedRequest
import site.webhook.legacy.urlDecode
import site.webhook.signature.SignatureConfig
import site.webhook.signature.headerNames
import tools.jackson.databind.JsonNode
import tools.jackson.databind.node.JsonNodeFactory

/** O que fica no lugar de um valor mascarado. */
const val REDACTED = "[redacted]"

/**
 * Cabeçalhos sempre mascarados (nomes como a mensagem os grava, em minúsculas). `php-auth-user` e `php-auth-pw` são o
 * `Authorization: Basic` decodificado que a captura grava ao lado dele, como o PHP fazia: sem eles a senha sairia crua.
 */
private val SENSITIVE_HEADERS =
    setOf(
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "x-webhook-secret",
        "php-auth-user",
        "php-auth-pw",
    )

/** Parâmetro de query cujo nome contém um destes (sem diferenciar maiúsculas) tem o valor mascarado. */
private val SENSITIVE_NAME_PARTS = listOf("token", "key", "secret", "password", "signature")

/**
 * Cabeçalho cujo nome contém um destes (sem diferenciar maiúsculas) também é mascarado, além da lista fixa: credencial
 * em cabeçalho próprio (`X-Auth-Token`, `X-Api-Keys`, `X-Client-Secret`). Sem `signature`: a assinatura mascarada é a
 * do provedor configurado na URL.
 */
private val SENSITIVE_HEADER_NAME_PARTS = listOf("token", "key", "secret", "password", "auth")

private val FAILURE_TARGET = Regex("^(header|query) ([^:]*):")

fun isSensitiveName(name: String): Boolean = SENSITIVE_NAME_PARTS.any { name.contains(it, ignoreCase = true) }

private fun isSensitiveHeader(
    name: String,
    alwaysMasked: Set<String>,
): Boolean = name.lowercase() in alwaysMasked || SENSITIVE_HEADER_NAME_PARTS.any { name.contains(it, ignoreCase = true) }

/**
 * A mensagem de um link só-leitura com `redact`: troca por [REDACTED] os valores dos cabeçalhos sensíveis (a lista fixa
 * e os de nome com [SENSITIVE_HEADER_NAME_PARTS]) e do cabeçalho de assinatura do provedor da URL ([signature]), e os
 * valores de query de nome sensível, onde quer que
 * apareçam: `query`, a query dentro de `url`, o `request` (num GET ele é a própria query) e as frases do `near_miss`
 * que citam o valor recebido de um desses cabeçalhos ou parâmetros. O corpo (`content`) não é mascarado.
 */
fun CapturedRequest.redacted(signature: SignatureConfig?): CapturedRequest {
    val headersToMask =
        SENSITIVE_HEADERS +
            signature
                ?.provider
                ?.headerNames()
                .orEmpty()
                .map { it.lowercase() }
    return copy(
        headers = headers.mapValues { (name, values) -> if (isSensitiveHeader(name, headersToMask)) values.map { REDACTED } else values },
        query = query?.withSensitiveNamesRedacted(),
        request = request?.withSensitiveNamesRedacted(),
        url = url.withSensitiveQueryRedacted(),
        nearMiss = nearMiss?.let { miss -> miss.copy(failed = miss.failed.map { it.redactedFailure(headersToMask) }) },
    )
}

/** Objeto ou lista (array do PHP) em qualquer profundidade: campo de nome sensível vira [REDACTED], inteiro. */
private fun JsonNode.withSensitiveNamesRedacted(): JsonNode {
    val factory = JsonNodeFactory.instance
    return when {
        isObject -> {
            factory.objectNode().also { copy ->
                properties().forEach { (name, value) ->
                    copy.set(name, if (isSensitiveName(name)) factory.stringNode(REDACTED) else value.withSensitiveNamesRedacted())
                }
            }
        }

        isArray -> {
            factory.arrayNode().also { copy -> values().forEach { copy.add(it.withSensitiveNamesRedacted()) } }
        }

        else -> {
            this
        }
    }
}

/** A query da `url` gravada, par a par: nome sensível (decodificado) fica com o valor [REDACTED]. */
private fun String.withSensitiveQueryRedacted(): String {
    val start = indexOf('?')
    if (start < 0) return this
    val pairs =
        substring(start + 1).split('&').joinToString("&") { pair ->
            val name = pair.substringBefore('=')
            if ('=' in pair && isSensitiveName(urlDecode(name))) "$name=$REDACTED" else pair
        }
    return substring(0, start + 1) + pairs
}

/** `header authorization: expected ..., got '...'` vira `header authorization: [redacted]`; as demais ficam. */
private fun String.redactedFailure(headersToMask: Set<String>): String {
    val match = FAILURE_TARGET.find(this) ?: return this
    val (kind, name) = match.destructured
    val sensitive = if (kind == "header") isSensitiveHeader(name, headersToMask) else isSensitiveName(name)
    return if (sensitive) "$kind $name: $REDACTED" else this
}
