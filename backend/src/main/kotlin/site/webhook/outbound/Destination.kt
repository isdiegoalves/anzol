package site.webhook.outbound

import java.net.InetAddress
import java.net.URI
import java.net.URISyntaxException
import java.net.UnknownHostException

private val SCHEMES = setOf("http", "https")
private val PORTS = 1..65_535
private const val MAX_HOST_LENGTH = 253

/** Nome de host em ASCII: rótulos de letras, dígitos, `-` e `_` (nome de serviço do Docker), com ponto final opcional. */
private val HOST_NAME = Regex("[a-z0-9_-]+(\\.[a-z0-9_-]+)*\\.?")

/** Resolve um nome em todos os seus IPs; [UnknownHostException] quando não resolve. */
fun interface HostResolver {
    fun resolve(host: String): List<InetAddress>
}

val SYSTEM_RESOLVER = HostResolver { host -> InetAddress.getAllByName(host).toList() }

/** Ou o valor, ou o motivo de não sair (vira o `error` do resultado). */
sealed interface Checked<out T> {
    data class Ok<T>(
        val value: T,
    ) : Checked<T>

    data class Refused(
        val error: OutboundError,
    ) : Checked<Nothing>
}

private fun refused(
    kind: ErrorKind,
    message: String,
) = Checked.Refused(OutboundError(kind, message))

/**
 * Alvo lido da URL: esquema e host em minúsculas (IPv6 sem colchetes), porta escrita ou `-1` (a do esquema) e
 * caminho com query, crus. O fragmento não sai.
 */
data class TargetUrl(
    val scheme: String,
    val host: String,
    val port: Int,
    val pathAndQuery: String,
) {
    fun hostForUrl(): String = if (':' in host) "[$host]" else host

    override fun toString(): String = "$scheme://${hostForUrl()}${if (port < 0) "" else ":$port"}$pathAndQuery"
}

/**
 * Lê a URL do alvo. Esquema que não é http(s) é `blocked` (não há o que conectar); o resto que não serve é
 * `invalid_url`: sem host, porta fora de 1–65535, credenciais na URL, host fora do ASCII ou número que não é IPv4
 * válido (`1.2.3.4.5`, `0x1g`), IPv6 inválido. IPv6 com zona (`[fe80::1%25en0]`) é sempre `blocked`.
 */
fun parseTarget(url: String): Checked<TargetUrl> {
    val uri = uriOrNull(url)
    val scheme = uri?.scheme?.lowercase()
    val raw = uri?.rawAuthority
    val authority = raw?.let(::authority)
    val error =
        when {
            uri == null -> invalidUrl("not a valid URL")
            scheme == null -> invalidUrl("the URL must start with http:// or https://")
            scheme !in SCHEMES -> OutboundError(ErrorKind.BLOCKED, "scheme '$scheme' is not allowed; only http and https")
            raw == null || authority == null -> invalidUrl("the URL has no host")
            '@' in raw -> invalidUrl("credentials in the URL are not supported; send an Authorization header")
            else -> authority.problem()
        }
    return if (error != null) {
        Checked.Refused(error)
    } else {
        val path = checkNotNull(uri).rawPath.orEmpty().ifEmpty { "/" } + uri.rawQuery?.let { "?$it" }.orEmpty()
        val valid = checkNotNull(authority)
        Checked.Ok(TargetUrl(checkNotNull(scheme), valid.host, checkNotNull(valid.port), path))
    }
}

private fun uriOrNull(url: String): URI? =
    try {
        URI(url)
    } catch (_: URISyntaxException) {
        null
    }

private fun invalidUrl(message: String) = OutboundError(ErrorKind.INVALID_URL, message)

/** Host (minúsculo, IPv6 sem colchetes) e porta da autoridade crua; porta ausente é `-1`, porta inválida é nula. */
private data class Authority(
    val host: String,
    val bracketed: Boolean,
    val port: Int?,
) {
    /** O que impede a saída, ou nulo quando o host e a porta servem. */
    fun problem(): OutboundError? =
        when {
            port == null -> invalidUrl("invalid port")
            bracketed && '%' in host -> OutboundError(ErrorKind.BLOCKED, "blocked: ${AddressKind.SCOPED.label}")
            bracketed && ipv6Literal(host) == null -> invalidUrl("invalid IPv6 address")
            !bracketed && (host.length > MAX_HOST_LENGTH || !HOST_NAME.matches(host)) -> invalidUrl("invalid host")
            !bracketed && numericHost(host) == NumericHost.Invalid -> invalidUrl("invalid IPv4 address")
            else -> null
        }
}

private fun authority(raw: String): Authority {
    val bracketed = raw.startsWith("[")
    val host = if (bracketed) raw.substring(1).substringBefore(']') else raw.substringBeforeLast(':')
    val portText = if (bracketed) raw.substringAfter(']').removePrefix(":") else raw.substringAfterLast(':', "")
    val port = if (portText.isEmpty()) -1 else portText.toIntOrNull()?.takeIf { it in PORTS }
    return Authority(host.lowercase(), bracketed, port)
}

private fun ipv6Literal(text: String): InetAddress? =
    try {
        InetAddress.ofLiteral(text).takeIf { ':' in text }
    } catch (_: IllegalArgumentException) {
        null
    }

/** Onde conectar: a URL efetiva (com o alias, se trocou) e o IP validado, o único em que o motor conecta. */
data class Destination(
    val url: TargetUrl,
    val address: InetAddress,
)

/**
 * Resolve o host uma vez, valida **todos** os IPs pela §1 e escolhe o primeiro: o motor conecta nele, sem
 * resolver de novo (DNS rebinding não troca o destino depois da validação).
 *
 * Com `localhost-alias`, alvo cujos IPs são todos loopback (`localhost`, `127.0.0.1`, `::1` em qualquer forma) vira
 * o alias. Com `allow-private=true` e alias, os IPs para os quais o alias resolve agora contam como privados,
 * liberados mesmo em `0.0.0.0/8` (o OrbStack põe o host em `0.250.250.254`); `0.0.0.0` e `::` seguem bloqueados.
 */
class DestinationPolicy(
    private val properties: OutboundProperties,
    private val resolver: HostResolver,
) {
    fun resolve(url: TargetUrl): Checked<Destination> {
        val found = lookup(url.host)
        val alias = properties.alias()
        val aliased = alias != null && found is Checked.Ok && found.value.all { it.kind() == AddressKind.LOOPBACK }
        val effective = if (aliased) url.copy(host = checkNotNull(alias)) else url
        return when (val resolved = if (aliased) lookup(effective.host) else found) {
            is Checked.Ok -> validated(effective, resolved.value, aliased)
            is Checked.Refused -> resolved
        }
    }

    /** Todos os IPs passam pela §1; o destino é o primeiro. */
    private fun validated(
        url: TargetUrl,
        addresses: List<InetAddress>,
        aliased: Boolean,
    ): Checked<Destination> {
        val alias = properties.alias()
        val hostAddresses = if (properties.allowPrivate && alias != null) aliasAddresses(alias, aliased, addresses) else emptySet()
        val refusal = addresses.firstNotNullOfOrNull { refusal(it, hostAddresses) }
        return if (refusal != null) Checked.Refused(refusal) else Checked.Ok(Destination(url, addresses.first()))
    }

    /** Os IPs do alias agora; alias que não resolve não libera nada. */
    private fun aliasAddresses(
        alias: String,
        aliased: Boolean,
        addresses: List<InetAddress>,
    ): Set<InetAddress> {
        val resolved = if (aliased) addresses else (lookup(alias) as? Checked.Ok)?.value.orEmpty()
        return resolved.map { it.normalized() }.toSet()
    }

    private fun refusal(
        address: InetAddress,
        hostAddresses: Set<InetAddress>,
    ): OutboundError? {
        val kind = address.kind()
        val viaAlias = kind != AddressKind.UNSPECIFIED && kind != AddressKind.SCOPED && address.normalized() in hostAddresses
        val effective = if (viaAlias) AddressKind.ALIAS else kind
        return when {
            !effective.allowable -> {
                OutboundError(ErrorKind.BLOCKED, "blocked: ${effective.label} (always blocked)")
            }

            effective != AddressKind.PUBLIC && !properties.allowPrivate -> {
                OutboundError(ErrorKind.BLOCKED, "blocked: ${effective.label} — set WEBHOOK_OUTBOUND_ALLOW_PRIVATE=true to allow")
            }

            else -> {
                null
            }
        }
    }

    /** IPv6 e IPv4 escritos (em qualquer forma numérica) valem por si; nome vai ao resolvedor. */
    private fun lookup(host: String): Checked<List<InetAddress>> {
        val literal = if (':' in host) ipv6Literal(host) else (numericHost(host) as? NumericHost.Address)?.address
        if (literal != null) return Checked.Ok(listOf(literal))
        return try {
            resolver
                .resolve(host)
                .takeIf { it.isNotEmpty() }
                ?.let { Checked.Ok(it) }
                ?: refused(ErrorKind.DNS, "could not resolve host $host")
        } catch (_: UnknownHostException) {
            refused(ErrorKind.DNS, "could not resolve host $host")
        }
    }
}
