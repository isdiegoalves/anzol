package anzol.stream

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime

private val QUIET: Duration = Duration.ofSeconds(30)
private val NOON: Instant = Instant.parse("2026-10-13T12:00:00Z")

@DisplayName("Avisos do armazenamento do servidor")
class StorageWatchTest {
    private val watch = StorageWatch(QUIET)

    private fun second(seconds: Long): Instant = NOON.plusSeconds(seconds)

    private fun local(seconds: Long): LocalDateTime = LocalDateTime.of(2026, 10, 13, 12, 0, 0).plusSeconds(seconds)

    @Test
    @DisplayName("Dado nenhuma recusa, quando o heartbeat pergunta, então não há o que avisar")
    fun due_semRecusa_naoDeveAvisar() {
        watch.stored(local(1))

        assertThat(watch.due(second(2))).isNull()
        assertThat(watch.announcedFull()).isNull()
    }

    @Test
    @DisplayName("Dado mil recusas e gravações alternadas, quando o heartbeat pergunta, então avisa o cheio uma vez só")
    fun due_recusasEGravacoesAlternadas_deveAvisarOCheioUmaVez() {
        repeat(1_000) {
            watch.refused(second(5))
            watch.stored(local(5))
        }

        val said = listOf(watch.due(second(5)), watch.due(second(6)), watch.due(second(20)))

        assertThat(said).containsExactly(StorageState(full = true, since = local(5)), null, null)
    }

    @Test
    @DisplayName("Dado o cheio avisado e uma mensagem gravada, quando o silêncio de recusas passa, então avisa a volta uma vez")
    fun due_silencioDepoisDaGravacao_deveAvisarAVolta() {
        watch.refused(second(0))
        watch.due(second(1))
        watch.stored(local(10))
        watch.stored(local(11))

        val early = watch.due(second(29))
        val back = watch.due(second(30))

        assertThat(early).isNull()
        assertThat(back).isEqualTo(StorageState(full = false, since = local(10)))
        assertThat(watch.due(second(31))).isNull()
        assertThat(watch.announcedFull()).isNull()
    }

    @Test
    @DisplayName("Dado uma recusa no meio do silêncio, quando o heartbeat pergunta, então a espera recomeça do zero")
    fun due_recusaNoMeioDoSilencio_deveRecomecarAEspera() {
        watch.refused(second(0))
        watch.due(second(1))
        watch.stored(local(10))
        watch.refused(second(20))

        val withoutStored = watch.due(second(55))
        watch.stored(local(56))
        val back = watch.due(second(57))

        assertThat(withoutStored).isNull()
        assertThat(back).isEqualTo(StorageState(full = false, since = local(56)))
    }

    @Test
    @DisplayName("Dado o cheio avisado e nenhuma mensagem gravada depois, quando o silêncio passa, então segue cheio")
    fun due_semGravacaoDepois_deveSeguirCheio() {
        watch.refused(second(0))
        watch.due(second(1))

        assertThat(watch.due(second(600))).isNull()
        assertThat(watch.announcedFull()).isEqualTo(StorageState(full = true, since = local(0)))
    }

    @Test
    @DisplayName("Dado o cheio só anotado, quando uma aba abre antes do heartbeat, então ela ainda não o ouve; depois do aviso, ouve")
    fun announcedFull_antesEDepoisDoAviso() {
        watch.refused(second(0))
        val beforeHeartbeat = watch.announcedFull()

        watch.due(second(1))

        assertThat(beforeHeartbeat).isNull()
        assertThat(watch.announcedFull()).isEqualTo(StorageState(full = true, since = local(0)))
    }

    @Test
    @DisplayName("Dado a volta avisada, quando o servidor enche de novo, então avisa um cheio novo, com a hora nova")
    fun due_encheDeNovo_deveAvisarCheioNovo() {
        watch.refused(second(0))
        watch.due(second(1))
        watch.stored(local(2))
        watch.due(second(30))

        watch.refused(second(40))

        assertThat(watch.due(second(41))).isEqualTo(StorageState(full = true, since = local(40)))
    }
}
