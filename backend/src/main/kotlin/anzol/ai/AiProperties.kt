package anzol.ai

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

private const val DEFAULT_TIMEOUT_SECONDS = 90L

/**
 * `ANZOL_AI_*`: o LLM OpenAI-compatível das rotas de IA (o oMLX local do dono). [enabled] falso (o padrão) deixa as
 * rotas em 503 e nada é montado. [baseUrl] é a raiz do servidor, sem o `/v1`; [apiKey] vazia sai sem `Authorization`.
 * [timeout] é o prazo da chamada inteira (modelo frio leva de 9 a 31 s para carregar).
 */
@ConfigurationProperties("anzol.ai")
data class AiProperties(
    val enabled: Boolean = false,
    val baseUrl: String = "http://localhost:8000",
    val apiKey: String = "",
    val modelJson: String = "NVIDIA-Nemotron-3.5-Lightning-30B-A3B-4bit",
    val modelText: String = "KAT-Coder-V2.5-Dev-oQ4e-mtp",
    val timeout: Duration = Duration.ofSeconds(DEFAULT_TIMEOUT_SECONDS),
) {
    /** A chave nunca aparece: nem no log de quem imprimir as propriedades. */
    override fun toString(): String =
        "AiProperties(enabled=$enabled, baseUrl=$baseUrl, apiKey=${if (apiKey.isEmpty()) "<none>" else "<set>"}, " +
            "modelJson=$modelJson, modelText=$modelText, timeout=$timeout)"
}
