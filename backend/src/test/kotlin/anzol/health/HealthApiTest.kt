package anzol.health

import anzol.support.AiApiTest
import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.rawHttp
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.boot.info.BuildProperties
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.json.JsonMapper

@ApiTest
@DisplayName("Saúde e versão do servidor")
class HealthApiTest(
    @LocalServerPort private val port: Int,
    jsonMapper: JsonMapper,
    private val build: BuildProperties,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName("Dado o Redis no ar, quando lê /health, então 200 com status ok, a versão do build, o redis e a IA e o MCP desligados")
    fun health_redisNoAr_deveResponderOk() {
        val response = api.send("GET", "/health")

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.headers().firstValue("Content-Type")).hasValue("application/json")
        assertThat(api.json(response))
            .isEqualTo(api.tree("""{"status":"ok","version":"${build.version}","redis":"ok","ai":"off","mcp":"off"}"""))
    }

    @Test
    @DisplayName("Dado o servidor no ar, quando lê /version, então 200 com a versão do build")
    fun version_deveResponderAVersaoDoBuild() {
        val response = api.send("GET", "/version")

        assertThat(response.statusCode()).isEqualTo(200)
        assertThat(response.headers().firstValue("Content-Type")).hasValue("application/json")
        assertThat(api.json(response)).isEqualTo(api.tree("""{"version":"${build.version}"}"""))
        assertThat(build.version).isNotBlank()
    }

    /** A probe do Kubernetes chega com o IP do pod no `Host`, e o `HEALTHCHECK` da imagem, sem `Host` da lista. */
    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = ["/health", "/version"])
    @DisplayName("Dado um Host fora da lista de aceitos, quando lê a saúde e a versão, então 200 como com qualquer Host")
    fun saudeEVersao_hostDeFora_devemResponder(path: String) {
        val response = rawHttp(port, "GET $path HTTP/1.1", host = "10.42.0.17:8080")

        assertThat(response.status).isEqualTo(200)
    }
}

@AiApiTest
@DisplayName("Saúde com a IA e o MCP ligados")
class HealthFeaturesApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName("Dado o app com IA e MCP ligados, quando lê /health, então ai e mcp vêm on")
    fun health_iaEMcpLigados_deveDizerOn() {
        val health = api.json(api.send("GET", "/health"))

        assertThat(health["ai"].asString()).isEqualTo("on")
        assertThat(health["mcp"].asString()).isEqualTo("on")
    }
}
