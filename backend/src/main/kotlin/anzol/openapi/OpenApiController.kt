package anzol.openapi

import org.springframework.core.io.ClassPathResource
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.databind.json.JsonMapper
import tools.jackson.dataformat.yaml.YAMLMapper
import java.nio.charset.StandardCharsets.UTF_8

private val YAML_TYPE = MediaType("application", "yaml", UTF_8)

/**
 * O documento OpenAPI 3.1 da API, escrito à mão em `openapi/anzol.yaml`: as rotas leem o corpo do
 * `HttpServletRequest` (como o app antigo), então nada no código diz o formato dos corpos. O teste de cobertura
 * compara os caminhos dele com os mapeamentos do Spring, e o contrato valida as respostas reais contra os schemas.
 */
@RestController
class OpenApiController(
    jsonMapper: JsonMapper,
) {
    private val yaml = ClassPathResource("openapi/anzol.yaml").getContentAsString(UTF_8)
    private val json = jsonMapper.writeValueAsString(YAMLMapper().readTree(yaml))

    @GetMapping("/openapi.yaml")
    fun yaml(): ResponseEntity<String> = ResponseEntity.ok().contentType(YAML_TYPE).body(yaml)

    @GetMapping("/openapi.json")
    fun json(): ResponseEntity<String> = ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(json)
}
