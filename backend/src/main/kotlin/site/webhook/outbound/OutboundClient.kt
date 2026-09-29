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
import org.apache.hc.client5.http.io.ManagedHttpClientConnection
import org.apache.hc.client5.http.protocol.HttpClientContext
import org.apache.hc.client5.http.ssl.TlsSocketStrategy
import org.apache.hc.core5.concurrent.Cancellable
import org.apache.hc.core5.http.ClassicHttpResponse
import org.apache.hc.core5.http.Header
import org.apache.hc.core5.http.HttpHost
import org.apache.hc.core5.http.config.Http1Config
import org.apache.hc.core5.http.config.RegistryBuilder
import org.apache.hc.core5.http.io.SocketConfig
import org.apache.hc.core5.http.io.entity.ByteArrayEntity
import org.apache.hc.core5.http.protocol.HttpContext
import org.apache.hc.core5.io.CloseMode
import org.apache.hc.core5.net.NamedEndpoint
import org.apache.hc.core5.util.Timeout
import java.io.IOException
import java.io.InterruptedIOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.net.UnknownHostException
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.Path
import java.time.Duration
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLException

/** Corpo da resposta guardado: além disto, `truncated: true`. */
const val MAX_RESPONSE_BODY = 64 * 1024

/**
 * Cabeçalhos da resposta guardados (nomes + valores), à parte dos 64 KiB do corpo, que o contrato fixa (corpo de
 * exatamente 64 KiB volta inteiro): os que passam disto saem inteiros, na ordem, e o resultado fica `truncated: true`.
 */
const val MAX_RESPONSE_HEADER_BYTES = 16 * 1024

/** Falha de conexão com `allow-private=false`: sem o IP em que tentou (a mensagem do Apache o traz). */
const val CONNECT_FAILED = "could not connect to the destination"

/** Maior `timeout` aceito (30 s): teto da conexão, do handshake TLS e de cada leitura. */
val MAX_TIMEOUT: Duration = Duration.ofSeconds(30)

/** Linha de cabeçalho e quantidade de cabeçalhos da resposta: alvo que manda mais que isto dá `connect`. */
private const val MAX_RESPONSE_HEADER_LINE = 8 * 1024
private const val MAX_RESPONSE_HEADERS = 100
private const val MAX_CONNECTIONS = 100
private const val MAX_CONNECTIONS_PER_ROUTE = 20

/** Prazo que sobra depois do DNS abaixo do qual não vale abrir conexão (o Apache lê `Timeout` zero como sem prazo). */
private val MIN_PHASE: Duration = Duration.ofMillis(1)

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

/**
 * O que a saída deu: a URL efetiva (com o alias, se trocou) e a resposta, ou o motivo de não haver; nula quando o caos
 * cortou o corpo ou desistiu de esperar (não há resposta lida nem falha de saída).
 */
data class Exchange(
    val target: String,
    val answer: Checked<Answer>?,
)

/** Uma cópia do disparo: o que deu (como em [Exchange.answer]), quanto levou e o que o caos fez nela. */
data class Shot(
    val answer: Checked<Answer>?,
    val duration: Duration,
    val injected: Set<Injection> = emptySet(),
)

/** O disparo: o alvo, a primeira cópia (a do resultado), a segunda (com `duplicate`) e se esperou o `delay_ms`. */
data class Delivery(
    val target: String,
    val first: Shot,
    val second: Shot? = null,
    val delayed: Boolean = false,
) {
    /** O que foi injetado, na ordem de [Injection]. */
    fun injected(): List<Injection> {
        val around = setOfNotNull(Injection.DELAY_MS.takeIf { delayed }, Injection.DUPLICATE.takeIf { second != null })
        return (around + first.injected + second?.injected.orEmpty()).sorted()
    }
}

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
    private val properties: OutboundProperties,
    resolver: HostResolver = SYSTEM_RESOLVER,
    sockets: DetachedSocketFactory = PLAIN_SOCKETS,
) : AutoCloseable {
    private val policy = DestinationPolicy(properties, resolver)
    private val http = httpClient(sockets)
    private val deadlines = Executors.newSingleThreadScheduledExecutor(Thread.ofVirtual().factory())
    private val lookups = Executors.newVirtualThreadPerTaskExecutor()

    fun exchange(request: OutboundRequest): Exchange = exchange(request, Chaos()).let { Exchange(it.target, it.first.answer) }

    /**
     * O disparo com [chaos]. O prazo ([OutboundRequest.timeout]) conta desde aqui: a resolução do nome (e a do alias)
     * entra nele, e a conexão fica com o que sobrou. O destino é conferido antes de qualquer caos: recusado, nada é
     * injetado. O `delay_ms` fica entre a conferência e a conexão, fora do prazo e da duração; a segunda cópia sai no
     * mesmo IP validado, com o prazo inteiro.
     */
    fun exchange(
        request: OutboundRequest,
        chaos: Chaos,
    ): Delivery {
        val started = System.nanoTime()
        val (target, checked) = destination(request)
        val resolution = Duration.ofNanos(System.nanoTime() - started)
        return when (checked) {
            is Checked.Ok -> deliver(checked.value, request, chaos, resolution)
            is Checked.Refused -> Delivery(target, Shot(checked, resolution))
        }
    }

    /**
     * Só a conferência do destino (URL, faixa, DNS no prazo), sem sair: a recusa, ou nula quando o destino passa.
     * O `send` com cabeçalhos acima dos tetos usa para escolher entre o 422 e o resultado recusado.
     */
    fun refused(request: OutboundRequest): Exchange? {
        val (target, checked) = destination(request)
        return if (checked is Checked.Refused) Exchange(target, checked) else null
    }

    /** O destino validado e o alvo que o resultado mostra (a URL lida, ou a crua quando nem leu). */
    private fun destination(request: OutboundRequest): Pair<String, Checked<Destination>> =
        when (val parsed = parseTarget(request.url)) {
            is Checked.Refused -> request.url to parsed
            is Checked.Ok -> parsed.value.toString() to resolveWithin(parsed.value, request.timeout)
        }

    /** O [DestinationPolicy] numa thread virtual, com o prazo do disparo: DNS que não responde a tempo dá `timeout`. */
    private fun resolveWithin(
        url: TargetUrl,
        timeout: Duration,
    ): Checked<Destination> {
        val lookup = lookups.submit(Callable { policy.resolve(url) })
        return try {
            lookup.get(timeout.toNanos(), TimeUnit.NANOSECONDS)
        } catch (_: TimeoutException) {
            lookup.cancel(true)
            Checked.Refused(timedOut(timeout))
        } catch (e: ExecutionException) {
            throw e.cause ?: e
        }
    }

    private fun deliver(
        destination: Destination,
        request: OutboundRequest,
        chaos: Chaos,
        resolution: Duration,
    ): Delivery {
        val target = destination.url.toString()
        val left = request.timeout - resolution
        if (left < MIN_PHASE) return Delivery(target, Shot(Checked.Refused(timedOut(request.timeout)), resolution))
        val delay = Duration.ofMillis(chaos.delayMs)
        if (!delay.isZero) Thread.sleep(delay)
        val first = send(destination, request, left, chaos)
        val second = if (chaos.duplicate) send(destination, request, request.timeout, chaos) else null
        return Delivery(target, first.copy(duration = resolution + first.duration), second, delayed = !delay.isZero)
    }

    /**
     * Uma cópia com o prazo que sobrou ([left]): vale para cada fase (conexão, TLS, cada leitura) e, por cima, cancela
     * o disparo inteiro quando vence (alvo que pinga um byte por vez não segura a thread). O `timeout_ms` do [chaos]
     * cancela do mesmo jeito, contado também do início da conexão.
     */
    private fun send(
        destination: Destination,
        request: OutboundRequest,
        left: Duration,
        chaos: Chaos,
    ): Shot {
        val started = System.nanoTime()
        val url = destination.url
        val target = HttpHost(url.scheme, destination.address, url.host, url.port)
        val outgoing = HttpUriRequestBase(request.method, URI(url.toString()))
        request.headers.forEach { (name, value) -> outgoing.addHeader(name, value) }
        val context = HttpClientContext.create()
        context.requestConfig = requestConfig(Timeout.of(left))
        val body = chaos.body(request.body, context)
        if (body != null) {
            outgoing.entity = body
        } else if (request.body.isNotEmpty() || request.method in WITH_BODY) {
            outgoing.entity = ByteArrayEntity(request.body, null)
        }
        val deadline = Deadline(left, outgoing)
        val giveUp = chaos.timeoutMs?.let { Deadline(Duration.ofMillis(it), outgoing) }
        val (answer, stopped) =
            try {
                execute(target, outgoing, context)
            } catch (_: BodyCut) {
                null to Injection.ABORT_MID_BODY
            } catch (e: IOException) {
                if (giveUp?.passed() == true) {
                    null to Injection.TIMEOUT_MS
                } else {
                    Checked.Refused(e.toError(deadline.passed(), request.timeout, detailed = properties.allowPrivate)) to null
                }
            } finally {
                deadline.cancel()
                giveUp?.cancel()
            }
        val slow = Injection.SLOW_BODY_BPS.takeIf { body?.started == true && chaos.slowBodyBps != null }
        return Shot(answer, Duration.ofNanos(System.nanoTime() - started), setOfNotNull(slow, stopped))
    }

    private fun execute(
        target: HttpHost,
        outgoing: HttpUriRequestBase,
        context: HttpClientContext,
    ): Pair<Checked<Answer>, Injection?> =
        (http.executeOpen(target, outgoing, context) as CloseableHttpResponse).let { response ->
            try {
                Checked.Ok(response.answer()) to null
            } finally {
                // Sem drenar o resto do corpo: fecha a conexão na hora.
                response.close(CloseMode.IMMEDIATE)
            }
        }

    /** Cancela [outgoing] quando [after] vence. */
    private inner class Deadline(
        after: Duration,
        outgoing: Cancellable,
    ) {
        private val passed = AtomicBoolean(false)
        private val task =
            deadlines.schedule(
                {
                    passed.set(true)
                    outgoing.cancel()
                },
                after.toMillis(),
                TimeUnit.MILLISECONDS,
            )

        fun passed(): Boolean = passed.get()

        fun cancel() {
            task.cancel(false)
        }
    }

    override fun close() {
        lookups.shutdownNow()
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
    val all = headers
    val kept = all.keptWithin(MAX_RESPONSE_HEADER_BYTES)
    return Answer(
        status = code,
        headers = kept.groupBy({ it.name.lowercase() }, { it.value.orEmpty() }),
        body = String(bytes, 0, minOf(bytes.size, MAX_RESPONSE_BODY), UTF_8),
        truncated = bytes.size > MAX_RESPONSE_BODY || kept.size < all.size,
    )
}

/** Os primeiros cabeçalhos cujos nomes e valores somados cabem em [budget] (ISO-8859-1: um caractere, um byte). */
private fun Array<Header>.keptWithin(budget: Int): List<Header> {
    val sizes = runningFold(0) { total, header -> total + header.name.length + header.value.orEmpty().length }.drop(1)
    return take(sizes.count { it <= budget })
}

private fun timedOut(timeout: Duration) = OutboundError(ErrorKind.TIMEOUT, "no response within ${timeout.toMillis()} ms")

/** Com [detailed] (`allow-private=true`, uso local), a mensagem do Apache; sem, a de `connect` não traz o IP. */
private fun IOException.toError(
    expired: Boolean,
    timeout: Duration,
    detailed: Boolean,
): OutboundError =
    when {
        expired || this is InterruptedIOException -> timedOut(timeout)
        this is SSLException -> OutboundError(ErrorKind.TLS, message ?: "TLS handshake failed")
        detailed -> OutboundError(ErrorKind.CONNECT, message ?: javaClass.simpleName)
        else -> OutboundError(ErrorKind.CONNECT, CONNECT_FAILED)
    }

/** O operador de conexão do Apache, que ainda deixa o socket da conexão aberta no contexto ([CONNECTION_SOCKET]). */
private class SocketInContext(
    sockets: DetachedSocketFactory,
    schemePortResolver: SchemePortResolver?,
    tlsSocketStrategy: TlsSocketStrategy?,
) : DefaultHttpClientConnectionOperator(
        sockets,
        schemePortResolver,
        NoNameResolution,
        RegistryBuilder.create<TlsSocketStrategy>().register("https", tlsSocketStrategy).build(),
    ) {
    override fun connect(
        conn: ManagedHttpClientConnection,
        endpointHost: HttpHost,
        endpointName: NamedEndpoint?,
        unixDomainSocket: Path?,
        localAddress: InetSocketAddress?,
        connectTimeout: Timeout?,
        socketConfig: SocketConfig,
        attachment: Any?,
        context: HttpContext,
    ) {
        super.connect(conn, endpointHost, endpointName, unixDomainSocket, localAddress, connectTimeout, socketConfig, attachment, context)
        context.setAttribute(CONNECTION_SOCKET, conn.socket)
    }
}

private fun httpClient(sockets: DetachedSocketFactory): CloseableHttpClient {
    val builder =
        object : PoolingHttpClientConnectionManagerBuilder() {
            override fun createConnectionOperator(
                schemePortResolver: SchemePortResolver?,
                dnsResolver: DnsResolver?,
                tlsSocketStrategy: TlsSocketStrategy?,
            ): HttpClientConnectionOperator = SocketInContext(sockets, schemePortResolver, tlsSocketStrategy)
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
