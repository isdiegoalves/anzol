package site.webhook.outbound

import org.apache.hc.client5.http.DnsResolver
import org.apache.hc.client5.http.SchemePortResolver
import org.apache.hc.client5.http.classic.methods.HttpUriRequestBase
import org.apache.hc.client5.http.config.ConnectionConfig
import org.apache.hc.client5.http.config.RequestConfig
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient
import org.apache.hc.client5.http.impl.classic.CloseableHttpResponse
import org.apache.hc.client5.http.impl.classic.HttpClients
import org.apache.hc.client5.http.impl.io.DefaultHttpClientConnectionOperator
import org.apache.hc.client5.http.impl.io.ManagedHttpClientConnectionFactory
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder
import org.apache.hc.client5.http.io.DetachedSocketFactory
import org.apache.hc.client5.http.io.HttpClientConnectionOperator
import org.apache.hc.client5.http.protocol.HttpClientContext
import org.apache.hc.client5.http.ssl.TlsSocketStrategy
import org.apache.hc.core5.http.ClassicHttpResponse
import org.apache.hc.core5.http.HttpHost
import org.apache.hc.core5.http.config.Http1Config
import org.apache.hc.core5.http.config.RegistryBuilder
import org.apache.hc.core5.http.io.entity.ByteArrayEntity
import org.apache.hc.core5.io.CloseMode
import org.apache.hc.core5.util.Timeout
import java.io.IOException
import java.io.InterruptedIOException
import java.net.InetAddress
import java.net.Socket
import java.net.URI
import java.net.UnknownHostException
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLException

/** Corpo da resposta guardado: além disto, `truncated: true`. */
const val MAX_RESPONSE_BODY = 64 * 1024

/** Maior `timeout` aceito (30 s): teto da conexão, do handshake TLS e de cada leitura. */
val MAX_TIMEOUT: Duration = Duration.ofSeconds(30)

/** Linha de cabeçalho e quantidade de cabeçalhos da resposta: alvo que manda mais que isto dá `connect`. */
private const val MAX_RESPONSE_HEADER_LINE = 8 * 1024
private const val MAX_RESPONSE_HEADERS = 100
private const val MAX_CONNECTIONS = 100
private const val MAX_CONNECTIONS_PER_ROUTE = 20
private val WITH_BODY = setOf("POST", "PUT", "PATCH")

/** Pedido de saída já montado (replay ou send): o motor não sabe de onde veio. */
class OutboundRequest(
    val method: String,
    val url: String,
    val headers: List<Pair<String, String>>,
    val body: ByteArray,
    val timeout: Duration,
)

/** Resposta do alvo, com o corpo lido até [MAX_RESPONSE_BODY] bytes. */
data class Answer(
    val status: Int,
    val headers: Map<String, List<String>>,
    val body: String,
    val truncated: Boolean,
)

/** O que a saída deu: a URL efetiva (com o alias, se trocou) e a resposta, ou o motivo de não haver. */
data class Exchange(
    val target: String,
    val answer: Checked<Answer>,
)

/** Socket comum; os testes trocam para ver em que endereço o motor conecta. */
val PLAIN_SOCKETS = DetachedSocketFactory { proxy -> if (proxy == null) Socket() else Socket(proxy) }

/**
 * O motor recebe do [DestinationPolicy] o IP já validado e o entrega pronto ao Apache ([HttpHost] com endereço):
 * o Apache não resolve nome nenhum. Se um dia tentar, este resolvedor falha, e a conexão não sai.
 */
private object NoNameResolution : DnsResolver {
    override fun resolve(host: String): Array<InetAddress> =
        throw UnknownHostException("name resolution outside the outbound policy: $host")

    override fun resolveCanonicalHostname(host: String): String = throw UnknownHostException(host)
}

/**
 * Motor de saída único do replay e do send (§1). Apache HttpClient 5 clássico, bloqueante (roda na thread virtual
 * da requisição), que aceita o IP de destino pronto e mantém o nome original no `Host` e no SNI/validação TLS.
 * Sem redirecionamento (o 3xx volta como resposta), sem retentativa, sem cookies, sem descompressão, sem proxy
 * do sistema e sem reuso de conexão: cada disparo abre a sua, no IP validado naquele disparo.
 */
class OutboundClient(
    properties: OutboundProperties,
    resolver: HostResolver = SYSTEM_RESOLVER,
    sockets: DetachedSocketFactory = PLAIN_SOCKETS,
) : AutoCloseable {
    private val policy = DestinationPolicy(properties, resolver)
    private val http = httpClient(sockets)
    private val deadlines = Executors.newSingleThreadScheduledExecutor(Thread.ofVirtual().factory())

    fun exchange(request: OutboundRequest): Exchange {
        val url =
            when (val parsed = parseTarget(request.url)) {
                is Checked.Ok -> parsed.value
                is Checked.Refused -> return Exchange(request.url, parsed)
            }
        return when (val destination = policy.resolve(url)) {
            is Checked.Ok -> Exchange(destination.value.url.toString(), send(destination.value, request))
            is Checked.Refused -> Exchange(url.toString(), destination)
        }
    }

    /**
     * Um disparo com prazo total: [OutboundRequest.timeout] vale para cada fase (conexão, TLS, cada leitura) e, por
     * cima, cancela o disparo inteiro quando vence (alvo que pinga um byte por vez não segura a thread).
     */
    private fun send(
        destination: Destination,
        request: OutboundRequest,
    ): Checked<Answer> {
        val url = destination.url
        val target = HttpHost(url.scheme, destination.address, url.host, url.port)
        val outgoing = HttpUriRequestBase(request.method, URI(url.toString()))
        request.headers.forEach { (name, value) -> outgoing.addHeader(name, value) }
        if (request.body.isNotEmpty() || request.method in WITH_BODY) outgoing.entity = ByteArrayEntity(request.body, null)
        val timeout = Timeout.of(request.timeout)
        val context = HttpClientContext.create()
        context.requestConfig = requestConfig(timeout)
        val expired = AtomicBoolean(false)
        val deadline =
            deadlines.schedule(
                {
                    expired.set(true)
                    outgoing.cancel()
                },
                request.timeout.toMillis(),
                TimeUnit.MILLISECONDS,
            )
        return try {
            (http.executeOpen(target, outgoing, context) as CloseableHttpResponse).let { response ->
                try {
                    Checked.Ok(response.answer())
                } finally {
                    // Sem drenar o resto do corpo: fecha a conexão na hora.
                    response.close(CloseMode.IMMEDIATE)
                }
            }
        } catch (e: IOException) {
            Checked.Refused(e.toError(expired.get(), request.timeout))
        } finally {
            deadline.cancel(false)
        }
    }

    override fun close() {
        deadlines.shutdownNow()
        http.close(CloseMode.IMMEDIATE)
    }
}

/** O prazo em cada fase; a conexão também pelo prazo do pedido (o `ConnectionConfig` só dá o teto de 30 s). */
@Suppress("DEPRECATION")
private fun requestConfig(timeout: Timeout): RequestConfig =
    RequestConfig
        .custom()
        .setRedirectsEnabled(false)
        .setConnectionRequestTimeout(timeout)
        .setConnectTimeout(timeout)
        .setResponseTimeout(timeout)
        .build()

private fun ClassicHttpResponse.answer(): Answer {
    val bytes = entity?.content?.readNBytes(MAX_RESPONSE_BODY + 1) ?: ByteArray(0)
    return Answer(
        status = code,
        headers = headers.groupBy({ it.name.lowercase() }, { it.value }),
        body = String(bytes, 0, minOf(bytes.size, MAX_RESPONSE_BODY), UTF_8),
        truncated = bytes.size > MAX_RESPONSE_BODY,
    )
}

private fun IOException.toError(
    expired: Boolean,
    timeout: Duration,
): OutboundError =
    when {
        expired || this is InterruptedIOException -> OutboundError(ErrorKind.TIMEOUT, "no response within ${timeout.toMillis()} ms")
        this is SSLException -> OutboundError(ErrorKind.TLS, message ?: "TLS handshake failed")
        else -> OutboundError(ErrorKind.CONNECT, message ?: javaClass.simpleName)
    }

private fun httpClient(sockets: DetachedSocketFactory): CloseableHttpClient {
    val builder =
        object : PoolingHttpClientConnectionManagerBuilder() {
            override fun createConnectionOperator(
                schemePortResolver: SchemePortResolver?,
                dnsResolver: DnsResolver?,
                tlsSocketStrategy: TlsSocketStrategy?,
            ): HttpClientConnectionOperator =
                DefaultHttpClientConnectionOperator(
                    sockets,
                    schemePortResolver,
                    NoNameResolution,
                    RegistryBuilder.create<TlsSocketStrategy>().register("https", tlsSocketStrategy).build(),
                )
        }
    val http1 =
        Http1Config
            .custom()
            .setMaxLineLength(MAX_RESPONSE_HEADER_LINE)
            .setMaxHeaderCount(MAX_RESPONSE_HEADERS)
            .build()
    val maxTimeout = Timeout.of(MAX_TIMEOUT)
    val connections =
        builder
            .setConnectionFactory(ManagedHttpClientConnectionFactory.builder().http1Config(http1).build())
            .setDefaultConnectionConfig(
                ConnectionConfig
                    .custom()
                    .setConnectTimeout(maxTimeout)
                    .setSocketTimeout(maxTimeout)
                    .build(),
            ).setMaxConnTotal(MAX_CONNECTIONS)
            .setMaxConnPerRoute(MAX_CONNECTIONS_PER_ROUTE)
            .build()
    return HttpClients
        .custom()
        .setConnectionManager(connections)
        .setConnectionReuseStrategy { _, _, _ -> false }
        .disableRedirectHandling()
        .disableAutomaticRetries()
        .disableContentCompression()
        .disableCookieManagement()
        .disableAuthCaching()
        .build()
}
