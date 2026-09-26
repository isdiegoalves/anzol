package site.webhook

import java.util.UUID

/*
 * Formatos herdados do app antigo (Laravel), num lugar só (docs/padroes-kotlin.md §3).
 * Mudar qualquer um deles deixa ilegíveis os tokens e mensagens já gravados no Redis.
 */

/** Regex de `app/Http/routes.php:5-6`: só minúsculas, como o `Uuid::uuid4()->toString()` grava. */
const val UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

/** `Carbon::now()->toDateTimeString()`, sempre em UTC (`config/app.php`). */
const val TIMESTAMP_PATTERN = "yyyy-MM-dd HH:mm:ss"

/** `preg_match('/[1-5][0-9][0-9]/', ...)` sem âncora, como em `RequestController::create`. */
val STATUS_IN_PATH = Regex("[1-5][0-9][0-9]")

@JvmInline
value class TokenId(
    val value: UUID,
) {
    override fun toString(): String = value.toString()
}

@JvmInline
value class RequestId(
    val value: UUID,
) {
    override fun toString(): String = value.toString()
}

/** Chaves de `Storage/Token.php` e `Storage/Request.php`, e as que vieram depois: todos os nomes num lugar só (§3). */
@Suppress("TooManyFunctions")
object RedisKeys {
    fun token(id: TokenId): String = "token:$id"

    fun requests(id: TokenId): String = "token:$id:requests"

    /** ZSET uuid da mensagem → chegada em microssegundos: a ordem e a paginação de [requests]. */
    fun requestIndex(id: TokenId): String = "token:$id:requests:index"

    /** Maior `seq` já dado na URL: apagar a mais nova (ou todas) não o faz voltar. */
    fun requestSeq(id: TokenId): String = "token:$id:requests:seq"

    /** Regras de resposta da URL: o JSON da lista, com o TTL das demais chaves dela. */
    fun rules(id: TokenId): String = "token:$id:rules"

    /** Estado dos cenários das regras: hash nome → estado, com o TTL das demais chaves da URL. */
    fun scenarios(id: TokenId): String = "token:$id:scenarios"

    /** Histórico de replay e send da URL: lista de resultados em JSON, o mais novo primeiro, com o TTL da URL. */
    fun outbound(id: TokenId): String = "token:$id:outbound"

    /** Disparos de replay e send na janela de um minuto (limite por URL). */
    fun outboundRate(id: TokenId): String = "token:$id:outbound:rate"

    /** Chamadas de IA (`rules/suggest` e `explain`) na janela de um minuto (limite por URL). */
    fun aiRate(id: TokenId): String = "token:$id:ai:rate"

    /** Tentativas erradas do segredo de leitura (unlock e header) na janela de um minuto (limite por URL). */
    fun secretFailures(id: TokenId): String = "token:$id:secret:failures"

    /** Links só-leitura ativos da URL: ZSET id do link → expiração em milissegundos. */
    fun shares(id: TokenId): String = "token:$id:shares"

    /** Um link só-leitura: o JSON dele, com TTL igual à expiração. */
    fun share(id: String): String = "share:$id"

    /** Chave do servidor (32 bytes em Base64) que assina o cookie de desbloqueio; criada no primeiro uso, sem TTL. */
    const val SERVER_KEY = "webhook:server-key"
}
