package site.webhook.cli

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test

@DisplayName("Leitor de SSE")
class SseParserTest {
    private fun parse(vararg lines: String): List<SseEvent> {
        val parser = SseParser()
        return lines.mapNotNull(parser::feed)
    }

    @Test
    @DisplayName("Dado event e data sem espaço após os dois-pontos, quando chega a linha vazia, então entrega o evento")
    fun feed_eventoDoServidor_deveEntregarNomeEDados() {
        val events = parse("event:request.created", "data:{\"a\":1}", "")

        assertThat(events).containsExactly(SseEvent("request.created", "{\"a\":1}"))
    }

    @Test
    @DisplayName("Dado comentários de heartbeat e linhas vazias soltas, quando lê, então não entrega evento")
    fun feed_comentariosEVazias_naoDeveEntregarEvento() {
        val events = parse(":conectado", "", ":heartbeat", "", "")

        assertThat(events).isEmpty()
    }

    @Test
    @DisplayName("Dado data em várias linhas e espaço após os dois-pontos, quando lê, então junta com quebra de linha e tira um espaço")
    fun feed_dataEmVariasLinhas_deveJuntarComQuebraDeLinha() {
        val events = parse("event: x", "data: um", "data:  dois", "")

        assertThat(events).containsExactly(SseEvent("x", "um\n dois"))
    }

    @Test
    @DisplayName("Dado evento sem nome, quando lê, então o nome é message, como no EventSource")
    fun feed_semNome_deveUsarMessage() {
        val events = parse("data:1", "", "event:a", "data:2", "")

        assertThat(events).containsExactly(SseEvent("message", "1"), SseEvent("a", "2"))
    }
}
