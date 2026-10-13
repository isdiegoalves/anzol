package anzol.stream

import anzol.token.toLegacyDateTime
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.util.concurrent.atomic.AtomicReference

/**
 * O que os pedidos viram do armazenamento do servidor e o que as abas já ouviram. O pedido que é recusado por falta
 * de espaço ([refused]) ou gravado ([stored]) só anota; quem avisa as abas é o heartbeat, que pergunta por [due] uma
 * vez por intervalo. Assim o custo de avisar todas as abas não cai no pedido de ninguém, e a quantidade de avisos não
 * depende de quantos pedidos chegam nem de como se alternam: no máximo um por heartbeat, e a volta só depois de
 * [quiet] sem recusa.
 */
class StorageWatch(
    private val quiet: Duration,
) {
    private data class Seen(
        val fullSince: LocalDateTime? = null,
        val announced: Boolean = false,
        val refusedAt: Instant = Instant.EPOCH,
        val storedAt: LocalDateTime? = null,
    )

    private val seen = AtomicReference(Seen())

    /** O cheio que as abas já ouviram: a aba que abre agora o ouve também. Nulo enquanto elas não ouviram nada. */
    fun announcedFull(): StorageState? {
        val current = seen.get()
        return current.fullSince?.takeIf { current.announced }?.let { StorageState(full = true, since = it) }
    }

    /** Uma gravação foi recusada por falta de espaço: recomeça o silêncio que a volta espera. */
    fun refused(now: Instant) {
        seen.updateAndGet { it.copy(fullSince = it.fullSince ?: now.toLegacyDateTime(), refusedAt = now, storedAt = null) }
    }

    /** Uma mensagem foi gravada em [at]: com o servidor cheio, a primeira depois da última recusa é a hora da volta. */
    fun stored(at: LocalDateTime) {
        if (seen.get().fullSince == null) return
        seen.updateAndGet { if (it.fullSince != null && it.storedAt == null) it.copy(storedAt = at) else it }
    }

    /**
     * O aviso que cabe agora, ou nulo: o cheio que as abas ainda não ouviram; ou a volta, quando uma mensagem foi
     * gravada depois da última recusa e essa recusa tem [quiet] ou mais.
     */
    fun due(now: Instant): StorageState? {
        val current = seen.get()
        val fullSince = current.fullSince
        val storedAt = current.storedAt
        val quietSince = Duration.between(current.refusedAt, now)
        val (next, announcement) =
            when {
                fullSince == null -> current to null
                !current.announced -> current.copy(announced = true) to StorageState(full = true, since = fullSince)
                storedAt != null && quietSince >= quiet -> Seen() to StorageState(full = false, since = storedAt)
                else -> current to null
            }
        // Perdeu para um pedido que anotou no meio: o próximo heartbeat decide de novo.
        return announcement?.takeIf { seen.compareAndSet(current, next) }
    }
}
