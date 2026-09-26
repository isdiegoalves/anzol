package site.webhook.ai

import com.openai.errors.OpenAIException
import com.openai.errors.OpenAIServiceException
import io.micrometer.observation.ObservationRegistry
import org.springframework.ai.chat.client.ChatClient
import org.springframework.ai.chat.messages.Message
import org.springframework.ai.chat.prompt.Prompt
import org.springframework.ai.openai.OpenAiChatModel
import org.springframework.ai.openai.OpenAiChatOptions
import org.springframework.beans.factory.ObjectProvider
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import site.webhook.telemetry.WebhookTelemetry
import tools.jackson.databind.json.JsonMapper
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.UnknownHostException

/** Uma chamada ao LLM: o `content` da resposta, ou por que falhou (a frase vai para o 502). */
sealed interface Completion {
    data class Answered(
        val content: String,
    ) : Completion

    data class Failed(
        val reason: String,
    ) : Completion
}

/**
 * O cliente só existe com `webhook.ai.enabled`: desligada, nenhuma rota de IA chega a ele (503) e a inicialização
 * não depende de chave nem do LLM no ar. Sem retentativa (uma chamada fria de 90 s repetida seria o triplo); a
 * observação do Spring AI dá o span de cada chamada.
 */
@Configuration(proxyBeanMethods = false)
class AiConfiguration {
    @Bean
    @ConditionalOnBooleanProperty("webhook.ai.enabled")
    fun llmClient(
        properties: AiProperties,
        observations: ObjectProvider<ObservationRegistry>,
    ): LlmClient {
        val registry = observations.getIfAvailable { ObservationRegistry.NOOP }
        val options =
            OpenAiChatOptions
                .builder()
                .baseUrl(properties.baseUrl.trimEnd('/') + "/v1")
                .apiKey(properties.apiKey)
                .timeout(properties.timeout)
                .maxRetries(0)
                .temperature(0.0)
                .build()
        val model =
            OpenAiChatModel
                .builder()
                .options(options)
                .observationRegistry(registry)
                .build()
        return LlmClient(ChatClient.create(model, registry), properties)
    }

    @Bean
    @ConditionalOnBooleanProperty("webhook.ai.enabled")
    fun ruleSuggester(
        llm: LlmClient,
        properties: AiProperties,
        telemetry: WebhookTelemetry,
    ): RuleSuggester = RuleSuggester(llm, properties.modelJson, telemetry)

    @Bean
    @ConditionalOnBooleanProperty("webhook.ai.enabled")
    fun explainer(
        llm: LlmClient,
        properties: AiProperties,
        jsonMapper: JsonMapper,
        telemetry: WebhookTelemetry,
    ): Explainer = Explainer(llm, properties.modelText, jsonMapper, telemetry)
}

/**
 * Chat completions num servidor OpenAI-compatível. Lê só o `content` da resposta: o `reasoning_content` dos modelos
 * que pensam fica de fora. Temperatura 0; [schema] liga a saída estruturada (`json_schema` estrito).
 */
class LlmClient(
    private val chat: ChatClient,
    private val properties: AiProperties,
) {
    fun complete(
        messages: List<Message>,
        model: String,
        schema: String? = null,
    ): Completion {
        val options = OpenAiChatOptions.builder().model(model)
        if (schema != null) {
            options.responseFormat(
                OpenAiChatModel.ResponseFormat
                    .builder()
                    .jsonSchema(schema)
                    .strict(true)
                    .build(),
            )
        }
        return try {
            val text =
                chat
                    .prompt(Prompt(messages, options.build()))
                    .call()
                    .chatResponse()
                    ?.result
                    ?.output
                    ?.text
            if (text.isNullOrBlank()) Completion.Failed("the model returned an empty answer") else Completion.Answered(text)
        } catch (error: OpenAIException) {
            Completion.Failed(error.reason())
        }
    }

    /** Uma frase sobre a falha, sem a chave, os cabeçalhos ou o corpo que o servidor devolveu. */
    private fun OpenAIException.reason(): String {
        val causes = generateSequence<Throwable>(this) { it.cause }.toList()
        return when {
            this is OpenAIServiceException -> "the model server answered HTTP ${statusCode()}"
            causes.any { it is InterruptedIOException } -> "the model did not answer within ${properties.timeout.seconds} s"
            causes.any { it is ConnectException || it is UnknownHostException } -> "could not connect to the model server"
            else -> "the model server gave an invalid answer"
        }
    }
}
