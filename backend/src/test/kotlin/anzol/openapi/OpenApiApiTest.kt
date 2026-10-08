package anzol.openapi

import anzol.support.ApiClient
import anzol.support.ApiTest
import anzol.support.routes
import com.networknt.schema.InputFormat
import com.networknt.schema.SchemaRegistry
import com.networknt.schema.SpecificationVersion
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.core.io.ClassPathResource
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping
import tools.jackson.databind.json.JsonMapper
import tools.jackson.dataformat.yaml.YAMLMapper
import java.nio.charset.StandardCharsets.UTF_8

/** As rotas que o documento não descreve: a tela (SPA), o erro do Spring e o próprio documento. */
private val UNDOCUMENTED = setOf("GET /", "GET /error", "POST /error", "GET /openapi.yaml", "GET /openapi.json")

private val OPERATIONS = setOf("get", "put", "post", "delete", "options", "head", "patch", "trace")

@ApiTest
@DisplayName("Documento OpenAPI 3.1")
class OpenApiApiTest(
    @LocalServerPort port: Int,
    jsonMapper: JsonMapper,
    @param:Qualifier("requestMappingHandlerMapping") private val mapping: RequestMappingHandlerMapping,
) {
    private val api = ApiClient(port, jsonMapper)

    @Test
    @DisplayName("Dado o documento, quando é lido em YAML e em JSON, então os dois são o mesmo OpenAPI 3.1.0")
    fun documento_yamlEJson_devemSerOMesmo() {
        val yaml = api.send("GET", "/openapi.yaml")
        val json = api.send("GET", "/openapi.json")

        assertThat(yaml.statusCode()).isEqualTo(200)
        assertThat(yaml.headers().firstValue("Content-Type")).hasValueSatisfying { assertThat(it).startsWith("application/yaml") }
        assertThat(json.headers().firstValue("Content-Type")).hasValue("application/json")
        assertThat(api.json(json)).isEqualTo(YAMLMapper().readTree(yaml.body()))
        assertThat(api.json(json)["openapi"].asString()).isEqualTo("3.1.0")
    }

    @Test
    @DisplayName("Dado o documento, quando é validado contra o schema oficial do OpenAPI 3.1, então não há erro")
    fun documento_schemaOficial_deveValidar() {
        val official = ClassPathResource("openapi/oas-3.1-schema.json").getContentAsString(UTF_8)
        val schema = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12).getSchema(official, InputFormat.JSON)

        val errors = schema.validate(api.send("GET", "/openapi.json").body(), InputFormat.JSON)

        assertThat(errors.map { "${it.instanceLocation}: ${it.message}" }).isEmpty()
    }

    @Test
    @DisplayName("Dado os mapeamentos do Spring, quando comparados com o documento, então toda rota está nele e ele não tem rota a mais")
    fun cobertura_rotas_devemBaterNosDoisSentidos() {
        val spring = mapping.routes().map { "${it.method} ${normalized(it.pattern)}" }.toSet() - UNDOCUMENTED
        val paths = api.json(api.send("GET", "/openapi.json"))["paths"]
        val documented =
            paths
                .properties()
                .flatMap { (path, item) ->
                    item.propertyNames().filter { it in OPERATIONS }.map { "${it.uppercase()} $path" }
                }.toSet()

        assertThat(spring - documented).`as`("rotas do Spring sem descrição no documento").isEmpty()
        assertThat(documented - spring).`as`("operações do documento que o Spring não tem").isEmpty()
    }

    @Test
    @DisplayName("Dado o documento, quando lista as operações, então cada uma tem operationId único")
    fun documento_operationId_deveSerUnico() {
        val paths = api.json(api.send("GET", "/openapi.json"))["paths"]
        val ids =
            paths.properties().flatMap { (_, item) ->
                item.properties().filter { it.key in OPERATIONS }.map { it.value["operationId"]?.asString() }
            }

        assertThat(ids).doesNotContainNull().doesNotHaveDuplicates()
    }

    /** `/token/{tokenId:[0-9a-f]{8}-…}/x` vira `/token/{tokenId}/x`; o curinga de caminho da captura vira `/{path}`. */
    private fun normalized(pattern: String): String {
        val out = StringBuilder()
        var index = 0
        while (index < pattern.length) {
            if (pattern[index] != '{') {
                out.append(pattern[index++])
                continue
            }
            var depth = 0
            val start = index
            do {
                if (pattern[index] == '{') depth++
                if (pattern[index] == '}') depth--
                index++
            } while (depth > 0)
            out.append("{").append(pattern.substring(start + 1, index - 1).substringBefore(':')).append("}")
        }
        return out.toString().replace("/**", "/{path}")
    }
}
