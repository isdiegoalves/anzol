package site.webhook.outbound

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import java.net.Inet6Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.UnknownHostException

/** Resolvedor controlado: nomes fixos, sem DNS de verdade; o resto não resolve. */
private fun resolver(names: Map<String, List<String>>) =
    HostResolver { host -> names[host]?.map { InetAddress.ofLiteral(it) } ?: throw UnknownHostException(host) }

private val NAMES =
    resolver(
        mapOf(
            "localhost" to listOf("127.0.0.1", "::1"),
            "localhost." to listOf("127.0.0.1", "::1"),
            "metadata.test" to listOf("169.254.169.254"),
            "internal.test" to listOf("10.1.2.3"),
            "ula.test" to listOf("fd00::5"),
            "mixed.test" to listOf("93.184.216.34", "10.0.0.1"),
            "public.test" to listOf("93.184.216.34"),
            "public6.test" to listOf("2606:4700::1111"),
        ),
    )

private val STRICT = OutboundProperties(allowPrivate = false)
private val PERMISSIVE = OutboundProperties(allowPrivate = true)

/** `ok`, ou o `error.kind` que a URL dá: a leitura e a política, sem conectar. */
private fun verdict(
    url: String,
    properties: OutboundProperties,
    names: HostResolver = NAMES,
): String =
    when (val parsed = parseTarget(url)) {
        is Checked.Refused -> {
            parsed.error.kind.id
        }

        is Checked.Ok -> {
            when (val destination = DestinationPolicy(properties, names).resolve(parsed.value)) {
                is Checked.Ok -> "ok"
                is Checked.Refused -> destination.error.kind.id
            }
        }
    }

private fun destination(
    url: String,
    properties: OutboundProperties,
    names: HostResolver,
): Destination {
    val parsed = parseTarget(url) as Checked.Ok
    return (DestinationPolicy(properties, names).resolve(parsed.value) as Checked.Ok).value
}

@DisplayName("Política de destino do motor de saída")
class DestinationPolicyTest {
    /**
     * Em ordem: link-local (metadados de nuvem) em toda forma de escrever; IPv6 com zona; não especificado, 0.0.0.0/8,
     * multicast, broadcast e reservado; loopback em toda forma (decimal inteiro, hexa, octal, curto, mapeado,
     * compatível, nome); privados, CGNAT e ULA; nome com um IP público e um privado (todos são validados); públicos,
     * inclusive nas bordas das faixas; esquema que não é http(s); URL que não serve; nome que não resolve.
     */
    @ParameterizedTest(name = "{0}: allow-private=false → {1}, allow-private=true → {2}")
    @CsvSource(
        delimiter = '|',
        textBlock = """
        http://169.254.169.254/latest/meta-data | blocked | blocked
        http://2852039166/                      | blocked | blocked
        http://0xa9fea9fe/                      | blocked | blocked
        http://0251.0376.0251.0376/             | blocked | blocked
        http://169.254.43518/                   | blocked | blocked
        http://0xA9.0xFE.0xA9.0xFE/             | blocked | blocked
        http://[::ffff:169.254.169.254]/        | blocked | blocked
        http://[::ffff:a9fe:a9fe]/              | blocked | blocked
        http://[::169.254.169.254]/             | blocked | blocked
        http://[64:ff9b::a9fe:a9fe]/            | blocked | blocked
        http://[2002:a9fe:a9fe::1]/             | blocked | blocked
        http://[fe80::1]/                       | blocked | blocked
        http://[FE80::abcd]:8080/               | blocked | blocked
        http://metadata.test/                   | blocked | blocked
        http://[fe80::1%25lo0]/                 | blocked | blocked
        http://[2001:db8::1%25eth0]/            | blocked | blocked
        http://[::1%251]/                       | blocked | blocked
        http://0.0.0.0/                         | blocked | blocked
        http://0/                               | blocked | blocked
        http://0x0/                             | blocked | blocked
        http://[::]/                            | blocked | blocked
        http://[::ffff:0.0.0.0]/                | blocked | blocked
        http://0.1.2.3/                         | blocked | blocked
        http://0.250.250.254/                   | blocked | blocked
        http://224.0.0.1/                       | blocked | blocked
        http://239.255.255.250:1900/            | blocked | blocked
        http://[ff02::1]/                       | blocked | blocked
        http://255.255.255.255/                 | blocked | blocked
        http://240.0.0.1/                       | blocked | blocked
        http://127.0.0.1:8080/x                 | blocked | ok
        http://2130706433/                      | blocked | ok
        http://0x7f000001/                      | blocked | ok
        http://0177.0.0.1/                      | blocked | ok
        http://127.000.000.001/                 | blocked | ok
        http://127.1/                           | blocked | ok
        http://0x7f.1/                          | blocked | ok
        http://127.0.0.1./                      | blocked | ok
        http://[::1]/                           | blocked | ok
        http://[0:0:0:0:0:0:0:1]/               | blocked | ok
        http://[::ffff:127.0.0.1]/              | blocked | ok
        http://[::ffff:7f00:1]/                 | blocked | ok
        http://[::127.0.0.1]/                   | blocked | ok
        http://localhost:3000/                  | blocked | ok
        http://LOCALHOST./                      | blocked | ok
        http://10.0.0.1/                        | blocked | ok
        http://172.16.0.1/                      | blocked | ok
        http://172.31.255.255/                  | blocked | ok
        http://192.168.1.1/                     | blocked | ok
        http://100.64.0.1/                      | blocked | ok
        http://100.127.255.255/                 | blocked | ok
        http://[fc00::1]/                       | blocked | ok
        http://[fd00:ec2::254]/                 | blocked | ok
        http://[::ffff:10.0.0.1]/               | blocked | ok
        http://[64:ff9b::a00:1]/                | blocked | ok
        http://[fec0::1]/                       | blocked | ok
        http://internal.test/                   | blocked | ok
        http://ula.test/                        | blocked | ok
        http://mixed.test/                      | blocked | ok
        http://8.8.8.8/                         | ok      | ok
        http://172.32.0.1/                      | ok      | ok
        http://172.15.255.255/                  | ok      | ok
        http://100.128.0.1/                     | ok      | ok
        http://169.253.255.255/                 | ok      | ok
        http://11.0.0.1/                        | ok      | ok
        http://192.169.0.1/                     | ok      | ok
        http://223.255.255.255/                 | ok      | ok
        http://[2606:4700::1111]/               | ok      | ok
        http://[::ffff:8.8.8.8]/                | ok      | ok
        http://[2002:808:808::]/                | ok      | ok
        https://public.test:8443/x?y=1          | ok      | ok
        http://public6.test/                    | ok      | ok
        file:///etc/passwd                      | blocked | blocked
        gopher://127.0.0.1:6379/_INFO           | blocked | blocked
        ftp://8.8.8.8/                          | blocked | blocked
        dict://127.0.0.1:11211/stat             | blocked | blocked
        javascript:alert(1)                     | blocked | blocked
        http://1.2.3.4.5/                       | invalid_url | invalid_url
        http://0x1g.1/                          | invalid_url | invalid_url
        http://256.1.1.1/                       | invalid_url | invalid_url
        http://08.1.1.1/                        | invalid_url | invalid_url
        http://1.16777216/                      | invalid_url | invalid_url
        http://4294967296/                      | invalid_url | invalid_url
        http://+1.0.0.127/                      | invalid_url | invalid_url
        http://example.123/                     | invalid_url | invalid_url
        http://user:pw@8.8.8.8/                 | invalid_url | invalid_url
        http://8.8.8.8:0/                       | invalid_url | invalid_url
        http://8.8.8.8:70000/                   | invalid_url | invalid_url
        http://[zz::1]/                         | invalid_url | invalid_url
        http://%31%32%37.0.0.1/                 | invalid_url | invalid_url
        http://exa mple.com/                    | invalid_url | invalid_url
        /relative/path                          | invalid_url | invalid_url
        http:/                                  | invalid_url | invalid_url
        http://nx.test/                         | dns     | dns""",
    )
    fun faixas_dosDoisModos_bloqueiamOuLiberam(
        url: String,
        strict: String,
        permissive: String,
    ) {
        assertThat(verdict(url, STRICT)).describedAs("allow-private=false").isEqualTo(strict)
        assertThat(verdict(url, PERMISSIVE)).describedAs("allow-private=true").isEqualTo(permissive)
    }

    @ParameterizedTest(name = "::ffff:{0}")
    @CsvSource("169.254.169.254, LINK_LOCAL", "127.0.0.1, LOOPBACK", "10.0.0.1, PRIVATE", "0.0.0.0, UNSPECIFIED", "8.8.8.8, PUBLIC")
    @DisplayName("Dado um IPv4 mapeado que chega como Inet6Address (resolvedor), quando classifica, então vale o IPv4 embutido")
    fun mapeadoComo16Bytes_deveValerOIpv4(
        ipv4: String,
        kind: AddressKind,
    ) {
        val mapped = ByteArray(10) + byteArrayOf(-1, -1) + InetAddress.ofLiteral(ipv4).address
        val address = Inet6Address.getByAddress(null, mapped, null as NetworkInterface?)

        assertThat(address).isInstanceOf(Inet6Address::class.java)
        assertThat(address.kind()).isEqualTo(kind)
    }

    @Test
    @DisplayName("Dado um nome, quando resolve, então o destino é o IP resolvido e a URL mantém o nome")
    fun nome_resolvido_deveConectarNoIpComONome() {
        val destination = destination("https://public.test:8443/a?b=1#frag", STRICT, NAMES)

        assertThat(destination.address).isEqualTo(InetAddress.ofLiteral("93.184.216.34"))
        assertThat(destination.url.toString()).isEqualTo("https://public.test:8443/a?b=1")
    }

    @Test
    @DisplayName("Dada uma recusa por faixa, quando monta a mensagem, então diz a faixa e não o IP resolvido")
    fun recusa_mensagem_deveDizerAFaixaSemOIp() {
        val parsed = parseTarget("http://internal.test/") as Checked.Ok
        val refused = DestinationPolicy(STRICT, NAMES).resolve(parsed.value) as Checked.Refused

        assertThat(refused.error.message).contains("private address", "WEBHOOK_OUTBOUND_ALLOW_PRIVATE").doesNotContain("10.1.2.3")
    }

    /** O host do Docker no OrbStack: `host.docker.internal` → `0.250.250.254`, dentro de `0.0.0.0/8`. */
    @Nested
    @DisplayName("localhost-alias")
    inner class Alias {
        private val names =
            resolver(
                mapOf(
                    "localhost" to listOf("127.0.0.1", "::1"),
                    "host.docker.internal" to listOf("0.250.250.254"),
                    "other.test" to listOf("0.250.250.254"),
                ),
            )
        private val permissive = OutboundProperties(allowPrivate = true, localhostAlias = "host.docker.internal")
        private val strict = OutboundProperties(allowPrivate = false, localhostAlias = "host.docker.internal")

        @ParameterizedTest(name = "{0}")
        @CsvSource(
            "http://host.docker.internal:3000/",
            "http://0.250.250.254:3000/",
            "http://[::ffff:0.250.250.254]:3000/",
            "http://other.test:3000/",
            "http://localhost:3000/",
            "http://127.0.0.1:3000/",
            "http://[::1]:3000/",
        )
        @DisplayName("Dado o alias com allow-private=true, quando o alvo cai no IP do alias, então sai")
        fun ipDoAlias_comAllowPrivate_deveSair(url: String) {
            assertThat(verdict(url, permissive, names)).isEqualTo("ok")
        }

        @ParameterizedTest(name = "{0}")
        @CsvSource("http://host.docker.internal:3000/", "http://0.250.250.254:3000/", "http://localhost:3000/", "http://127.0.0.1:3000/")
        @DisplayName("Dado o alias com allow-private=false, quando o alvo cai no IP do alias, então é bloqueado")
        fun ipDoAlias_semAllowPrivate_deveBloquear(url: String) {
            assertThat(verdict(url, strict, names)).isEqualTo("blocked")
        }

        @ParameterizedTest(name = "{0}")
        @CsvSource("http://0.250.250.253/", "http://0.0.0.1/", "http://0.0.0.0/", "http://0/", "http://[::]/")
        @DisplayName("Dado o alias com allow-private=true, quando o alvo é outro IP de 0.0.0.0/8 ou o não especificado, então é bloqueado")
        fun outroIpDaFaixaZero_comAlias_deveBloquear(url: String) {
            assertThat(verdict(url, permissive, names)).isEqualTo("blocked")
        }

        @Test
        @DisplayName("Dado um alias que resolve para 0.0.0.0, quando o alvo é 0.0.0.0, então segue bloqueado")
        fun aliasEmZero_naoLiberaONaoEspecificado() {
            val zero = resolver(mapOf("host.docker.internal" to listOf("0.0.0.0")))

            assertThat(verdict("http://0.0.0.0/", permissive, zero)).isEqualTo("blocked")
            assertThat(verdict("http://host.docker.internal/", permissive, zero)).isEqualTo("blocked")
        }

        @Test
        @DisplayName("Dado localhost, quando há alias, então a URL efetiva troca o host pelo alias, com porta, caminho e query")
        fun localhost_comAlias_deveTrocarOHost() {
            val destination = destination("http://localhost:3000/hooks?a=1", permissive, names)

            assertThat(destination.url.toString()).isEqualTo("http://host.docker.internal:3000/hooks?a=1")
            assertThat(destination.address).isEqualTo(InetAddress.ofLiteral("0.250.250.254"))
        }

        @Test
        @DisplayName("Dado o alias, quando muda de IP entre disparos, então vale o IP resolvido em cada disparo")
        fun alias_resolvidoACadaDisparo() {
            var current = "0.250.250.254"
            val changing =
                HostResolver { host ->
                    if (host == "host.docker.internal") listOf(InetAddress.ofLiteral(current)) else throw UnknownHostException(host)
                }
            val policy = DestinationPolicy(permissive, changing)
            val target = (parseTarget("http://0.250.250.254/") as Checked.Ok).value

            assertThat(policy.resolve(target)).isInstanceOf(Checked.Ok::class.java)
            current = "0.250.250.200"
            assertThat(policy.resolve(target)).isInstanceOf(Checked.Refused::class.java)
        }
    }
}
