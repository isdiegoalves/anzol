package site.webhook.outbound

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

private const val IPV4_BYTES = 4
private const val BITS_PER_BYTE = 8
private const val BYTE_MASK = 0xff
private const val MAX_IPV4 = 0xffff_ffffL
private const val HEX_RADIX = 16
private const val OCTAL_RADIX = 8
private const val DECIMAL_RADIX = 10

/** Os 12 primeiros bytes de um IPv4 mapeado em IPv6 (`::ffff:a.b.c.d`). */
@Suppress("MagicNumber")
private val IPV4_MAPPED_PREFIX = ByteArray(10) + byteArrayOf(-1, -1)

/** Onde um endereço de destino cai na §1; [allowable] diz se `allow-private=true` o libera. */
enum class AddressKind(
    val label: String,
    val allowable: Boolean,
) {
    UNSPECIFIED("unspecified address", allowable = false),
    THIS_NETWORK("0.0.0.0/8 address", allowable = false),
    LINK_LOCAL("link-local address", allowable = false),
    MULTICAST("multicast address", allowable = false),
    RESERVED("broadcast/reserved address", allowable = false),

    /** Faixa que o registro de uso especial da IANA marca como não globalmente alcançável (documentação, benchmark…). */
    SPECIAL_PURPOSE("special-purpose address", allowable = false),
    SCOPED("IPv6 address with a zone", allowable = false),
    LOOPBACK("loopback address", allowable = true),
    PRIVATE("private address", allowable = true),
    SHARED("shared (CGNAT) address", allowable = true),
    UNIQUE_LOCAL("unique local address", allowable = true),

    /** O IP para o qual o `localhost-alias` resolve agora (o host do Docker). */
    ALIAS("host alias address", allowable = true),
    PUBLIC("public address", allowable = true),
}

/** Faixa CIDR sobre os bytes do endereço (4 ou 16). */
private class Cidr(
    network: String,
    private val prefix: Int,
    val kind: AddressKind,
) {
    /** O Java lê `::ffff:0:0` como o IPv4 `0.0.0.0`: faixa escrita em IPv6 fica com os 16 bytes do IPv6. */
    private val bytes =
        InetAddress.ofLiteral(network).address.let { parsed ->
            if (':' in network && parsed.size == IPV4_BYTES) IPV4_MAPPED_PREFIX + parsed else parsed
        }

    fun contains(address: ByteArray): Boolean {
        val whole = prefix / BITS_PER_BYTE
        val rest = prefix % BITS_PER_BYTE
        val mask = (BYTE_MASK shl (BITS_PER_BYTE - rest)) and BYTE_MASK
        return address.size == bytes.size &&
            (0 until whole).all { address[it] == bytes[it] } &&
            (rest == 0 || (address[whole].toInt() and mask) == (bytes[whole].toInt() and mask))
    }
}

/**
 * A tabela única das faixas que não são destino público. Fonte: IANA IPv4 e IPv6 Special-Purpose Address
 * Registry (iana.org/assignments/iana-ipv4-special-registry e iana-ipv6-special-registry): toda faixa que o
 * registro marca como "Globally Reachable: False" está aqui. As liberáveis por `allow-private` (loopback, RFC 1918,
 * CGNAT, ULA) são as da §1; o resto é sempre bloqueado. A primeira faixa que contém o endereço decide, então a
 * mais específica vem antes da mais larga que a contém.
 */
@Suppress("MagicNumber")
private val RANGES =
    listOf(
        // IANA IPv4 0.0.0.0/32, "This host on this network" (RFC 1122).
        Cidr("0.0.0.0", 32, AddressKind.UNSPECIFIED),
        // IANA IPv4 0.0.0.0/8, "This network" (RFC 791).
        Cidr("0.0.0.0", 8, AddressKind.THIS_NETWORK),
        // IANA IPv4 10.0.0.0/8, "Private-Use" (RFC 1918).
        Cidr("10.0.0.0", 8, AddressKind.PRIVATE),
        // IANA IPv4 100.64.0.0/10, "Shared Address Space" (RFC 6598).
        Cidr("100.64.0.0", 10, AddressKind.SHARED),
        // IANA IPv4 127.0.0.0/8, "Loopback" (RFC 1122).
        Cidr("127.0.0.0", 8, AddressKind.LOOPBACK),
        // IANA IPv4 169.254.0.0/16, "Link Local" (RFC 3927): metadados de nuvem.
        Cidr("169.254.0.0", 16, AddressKind.LINK_LOCAL),
        // IANA IPv4 172.16.0.0/12, "Private-Use" (RFC 1918).
        Cidr("172.16.0.0", 12, AddressKind.PRIVATE),
        // IANA IPv4 192.0.0.0/24, "IETF Protocol Assignments" (RFC 6890); inclui 192.0.0.192, metadado da Oracle Cloud.
        Cidr("192.0.0.0", 24, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv4 192.0.2.0/24, "Documentation (TEST-NET-1)" (RFC 5737).
        Cidr("192.0.2.0", 24, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv4 192.88.99.0/24, "Deprecated (6to4 Relay Anycast)" (RFC 7526).
        Cidr("192.88.99.0", 24, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv4 192.168.0.0/16, "Private-Use" (RFC 1918).
        Cidr("192.168.0.0", 16, AddressKind.PRIVATE),
        // IANA IPv4 198.18.0.0/15, "Benchmarking" (RFC 2544).
        Cidr("198.18.0.0", 15, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv4 198.51.100.0/24, "Documentation (TEST-NET-2)" (RFC 5737).
        Cidr("198.51.100.0", 24, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv4 203.0.113.0/24, "Documentation (TEST-NET-3)" (RFC 5737).
        Cidr("203.0.113.0", 24, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv4 Multicast Address Space 224.0.0.0/4 (RFC 5771); fora do registro de uso especial, bloqueado pela §1.
        Cidr("224.0.0.0", 4, AddressKind.MULTICAST),
        // IANA IPv4 240.0.0.0/4, "Reserved" (RFC 1112), e 255.255.255.255/32, "Limited Broadcast" (RFC 919), dentro dela.
        Cidr("240.0.0.0", 4, AddressKind.RESERVED),
        // IANA IPv6 ::/128, "Unspecified Address" (RFC 4291).
        Cidr("::", 128, AddressKind.UNSPECIFIED),
        // IANA IPv6 ::1/128, "Loopback Address" (RFC 4291).
        Cidr("::1", 128, AddressKind.LOOPBACK),
        // IANA IPv6 ::ffff:0:0:0/96, "IPv4-IPv6 Translat." (SIIT, RFC 2765); o mapeado ::ffff:0:0/96 vale pelo IPv4 embutido.
        Cidr("::ffff:0:0:0", 96, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv6 64:ff9b:1::/48, "IPv4-IPv6 Translat." de uso local (RFC 8215).
        Cidr("64:ff9b:1::", 48, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv6 100::/64, "Discard-Only Address Block" (RFC 6666).
        Cidr("100::", 64, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv6 2001::/23, "IETF Protocol Assignments" (RFC 2928), com Teredo 2001::/32 (RFC 4380) dentro.
        Cidr("2001::", 23, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv6 2001:db8::/32, "Documentation" (RFC 3849).
        Cidr("2001:db8::", 32, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv6 3fff::/20, "Documentation" (RFC 9637).
        Cidr("3fff::", 20, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv6 5f00::/16, "Segment Routing (SRv6) SIDs" (RFC 9602).
        Cidr("5f00::", 16, AddressKind.SPECIAL_PURPOSE),
        // IANA IPv6 fc00::/7, "Unique-Local" (RFC 4193).
        Cidr("fc00::", 7, AddressKind.UNIQUE_LOCAL),
        // IANA IPv6 fe80::/10, "Link-Local Unicast" (RFC 4291).
        Cidr("fe80::", 10, AddressKind.LINK_LOCAL),
        // Site-local fec0::/10 (RFC 3879, obsoleto, fora do registro), ainda roteado em rede interna antiga: privado.
        Cidr("fec0::", 10, AddressKind.PRIVATE),
        // IANA IPv6 Multicast ff00::/8 (RFC 4291); fora do registro de uso especial, bloqueado pela §1.
        Cidr("ff00::", 8, AddressKind.MULTICAST),
    )

/**
 * IPv6 que carrega um IPv4 e chega nele por tradução (mapeado `::ffff:0:0/96`, compatível `::/96`, NAT64
 * `64:ff9b::/96` e 6to4 `2002::/16`): o endereço vale pelo IPv4 embutido.
 */
@Suppress("MagicNumber")
private val EMBEDDING_IPV4 =
    listOf(
        Cidr("::ffff:0:0", 96, AddressKind.PUBLIC) to 12,
        Cidr("::", 96, AddressKind.PUBLIC) to 12,
        Cidr("64:ff9b::", 96, AddressKind.PUBLIC) to 12,
        Cidr("2002::", 16, AddressKind.PUBLIC) to 2,
    )

/**
 * O endereço como a política o avalia: o IPv4 embutido num IPv6 de tradução; `::` e `::1` ficam como
 * estão (são `::/96`, mas não carregam IPv4).
 */
fun InetAddress.normalized(): InetAddress {
    val bytes = address
    val offset = EMBEDDING_IPV4.firstOrNull { (range, _) -> range.contains(bytes) }?.second
    return if (offset == null || isAnyLocalAddress || isLoopbackAddress) {
        this
    } else {
        InetAddress.getByAddress(bytes.copyOfRange(offset, offset + IPV4_BYTES))
    }
}

/** A faixa do endereço; IPv6 com zona (`%en0`) é sempre recusado, em qualquer faixa. */
fun InetAddress.kind(): AddressKind {
    if (this is Inet6Address && (scopeId != 0 || scopedInterface != null)) return AddressKind.SCOPED
    val bytes = normalized().address
    return RANGES.firstOrNull { it.contains(bytes) }?.kind ?: AddressKind.PUBLIC
}

/** Leitura de um host que termina em número: o IPv4, ou [Invalid] quando não é IPv4 válido em forma alguma. */
sealed interface NumericHost {
    data class Address(
        val address: Inet4Address,
    ) : NumericHost

    data object Invalid : NumericHost
}

private val NUMERIC_LABEL = Regex("0[xX][0-9a-fA-F]*|[0-9]+")

/**
 * Host cujo último rótulo é número (decimal, `0x` hexa ou `0` octal) é IPv4 em qualquer forma que o `inet_aton`
 * e os navegadores aceitam: `2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1`. Lido aqui, e não pelo resolvedor
 * do sistema (o Java lê `0177.0.0.1` como decimal), para que a forma estranha valha o mesmo IP que o
 * usuário quis dizer. Nulo para nome comum, que vai ao resolvedor.
 */
fun numericHost(host: String): NumericHost? {
    val labels = host.removeSuffix(".").split('.')
    return if (NUMERIC_LABEL.matches(labels.last())) ipv4(labels) else null
}

/** De 1 a 4 rótulos numéricos; os primeiros valem um byte cada e o último preenche os bytes que sobram. */
private fun ipv4(labels: List<String>): NumericHost {
    val parts = labels.map { label -> label.takeIf { NUMERIC_LABEL.matches(it) }?.ipv4Part() }
    val valid =
        labels.size <= IPV4_BYTES &&
            parts.all { it != null } &&
            parts.dropLast(1).all { checkNotNull(it) <= BYTE_MASK } &&
            checkNotNull(parts.last()) < 1L shl (BITS_PER_BYTE * (IPV4_BYTES + 1 - labels.size))
    if (!valid) return NumericHost.Invalid
    val numbers = parts.map { checkNotNull(it) }
    val value = numbers.dropLast(1).foldIndexed(numbers.last()) { index, sum, part -> sum + (part shl byteShift(index)) }
    check(value in 0..MAX_IPV4) { "IPv4 fora da faixa: $value" }
    val bytes = ByteArray(IPV4_BYTES) { index -> (value shr byteShift(index)).toByte() }
    return NumericHost.Address(InetAddress.getByAddress(bytes) as Inet4Address)
}

/** Deslocamento do byte [index] (0 é o mais alto) num IPv4 de 32 bits. */
private fun byteShift(index: Int): Int = BITS_PER_BYTE * (IPV4_BYTES - 1 - index)

/** Um rótulo numérico do `inet_aton`: `0x…` hexa (vazio é 0), `0…` octal, senão decimal; nulo se inválido ou grande demais. */
private fun String.ipv4Part(): Long? {
    val (digits, radix) =
        when {
            startsWith("0x") || startsWith("0X") -> substring(2).ifEmpty { "0" } to HEX_RADIX
            length > 1 && startsWith("0") -> substring(1) to OCTAL_RADIX
            else -> this to DECIMAL_RADIX
        }
    return digits.toLongOrNull(radix)?.takeIf { it in 0..MAX_IPV4 }
}
