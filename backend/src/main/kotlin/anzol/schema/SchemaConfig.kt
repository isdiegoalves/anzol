package anzol.schema

import anzol.rules.Parsed
import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonValue
import com.networknt.schema.Schema
import com.networknt.schema.SchemaException
import com.networknt.schema.SchemaLocation
import com.networknt.schema.SchemaRegistry
import com.networknt.schema.SchemaRegistryConfig
import com.networknt.schema.SpecificationVersion
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.NullNode
import tools.jackson.databind.node.ObjectNode
import java.util.Locale

/** Teto do `schema` serializado (JSON compacto, em bytes UTF-8). */
const val MAX_SCHEMA_BYTES = 64 * 1024

/** Os dialetos que o `$schema` do documento pode escolher; sem `$schema`, vale o 2020-12. */
private val DIALECTS = listOf(SpecificationVersion.DRAFT_2020_12, SpecificationVersion.DRAFT_2019_09, SpecificationVersion.DRAFT_7)

/** Palavras que apontam para outro documento; só o próprio (`#…`) é aceito, para não haver rede nem leitura de arquivo. */
private val REFERENCE_KEYWORDS = setOf("\$ref", "\$dynamicRef", "\$recursiveRef")

/** Os meta-schemas oficiais vêm do classpath da biblioteca; nada mais é carregado, de lugar nenhum. */
private val META_SCHEMA_IRI = Regex("https?://json-schema\\.org/.*")

/**
 * O IRI base do documento. Sem base, a biblioteca recusa `$id` relativo (`"$id":"stripe-event"` não vira IRI
 * absoluto); com esta, vira `urn:anzol:stripe-event`. É um URN: não há de onde buscá-lo.
 */
private val DOCUMENT_BASE = SchemaLocation.of("urn:anzol:schema")

private val schemaMapper: JsonMapper = JsonMapper.builder().build()

/**
 * O validador compartilhado: mensagens em inglês (a biblioteca traduz pelo `Locale` padrão), caminhos em JSON
 * Pointer, o carregador preso aos meta-schemas oficiais e as regex com teto de custo ([TimedRegularExpressionFactory]).
 */
private val registry: SchemaRegistry =
    SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12) { builder ->
        builder
            .schemaRegistryConfig(
                SchemaRegistryConfig
                    .builder()
                    .locale(Locale.ENGLISH)
                    .regularExpressionFactory(TimedRegularExpressionFactory)
                    .build(),
            ).schemaLoader { loader -> loader.allow { iri -> META_SCHEMA_IRI.matches(iri.toString()) } }
    }

/**
 * `schema` do token: o documento JSON Schema como o dono o enviou, gravado e devolvido como está. Já passou por
 * [readSchema] ao ser salvo; o do Redis não é conferido de novo (uma falha dele aparece no resultado da mensagem).
 */
data class SchemaConfig(
    val document: ObjectNode,
) {
    @JsonValue
    fun toJson(): JsonNode = document

    /** O validador do documento; lança [SchemaException] (ou outra falha da biblioteca) se não compilar. */
    fun compile(): Schema = registry.getSchema(DOCUMENT_BASE, document).also { it.initializeValidators() }

    companion object {
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun fromJson(value: ObjectNode): SchemaConfig = SchemaConfig(value)
    }
}

/**
 * Lê `schema` da API (`POST`/`PUT /token`). Inválido é 422 em `schema`, com o motivo: não é objeto, passa de
 * [MAX_SCHEMA_BYTES], `$schema` fora dos dialetos aceitos, referência que não é interna, ou não compila (o
 * documento não segue o meta-schema do dialeto, ou a biblioteca o recusa).
 */
fun readSchema(value: Any?): Parsed<SchemaConfig> {
    val document = (value as? Map<*, *>)?.let { schemaMapper.valueToTree<ObjectNode>(it) } ?: return invalid("it must be a JSON object")
    val problem =
        when {
            schemaMapper.writeValueAsBytes(document).size > MAX_SCHEMA_BYTES -> "it is larger than 64 KB"
            else -> document.dialectProblem() ?: document.externalReference() ?: SchemaConfig(document).compileProblem()
        }
    return if (problem == null) Parsed.Valid(SchemaConfig(document)) else invalid(problem)
}

private fun invalid(reason: String): Parsed<Nothing> =
    Parsed.Invalid(mapOf("schema" to listOf("The schema is invalid: ${reason.removeSuffix(".")}.")))

/** A primeira linha da mensagem da biblioteca (a do regex inválido traz o padrão na linha seguinte). */
fun Throwable.reason(): String = (message ?: javaClass.simpleName).lineSequence().first()

/** `$schema` do documento: ausente, ou um dos [DIALECTS] (com ou sem o `#` final). */
private fun ObjectNode.dialectProblem(): String? {
    val declared = get("\$schema") ?: return null
    val known = declared.isString && dialectOf(declared.stringValue()) != null
    return if (known) null else "unsupported \$schema ${declared.toString().trim('"')}"
}

private fun dialectOf(id: String): SpecificationVersion? = DIALECTS.firstOrNull { it.dialectId.removeSuffix("#") == id.removeSuffix("#") }

/** A primeira referência (`$ref`, `$dynamicRef`, `$recursiveRef`) que não começa em `#`, em qualquer nível. */
private fun JsonNode.externalReference(): String? =
    when {
        isObject -> {
            properties().firstNotNullOfOrNull { (name, value) ->
                if (name in REFERENCE_KEYWORDS && value.isString && !value.stringValue().startsWith("#")) {
                    "$name ${value.stringValue()} is not internal (only #… is allowed)"
                } else {
                    value.externalReference()
                }
            }
        }

        isArray -> {
            firstNotNullOfOrNull { it.externalReference() }
        }

        else -> {
            null
        }
    }

/**
 * O documento contra o meta-schema do dialeto dele e, passando, a compilação e uma validação de `null`: um `$ref`
 * que aponta para si mesmo sem consumir a instância não termina com instância nenhuma (estoura a pilha).
 */
@Suppress("TooGenericExceptionCaught") // qualquer recusa da biblioteca é um schema inválido (422), nunca um 500
private fun SchemaConfig.compileProblem(): String? {
    val dialect = document["\$schema"]?.stringValue()?.let(::dialectOf) ?: SpecificationVersion.DRAFT_2020_12
    return try {
        val violation = registry.getSchema(SchemaLocation.of(dialect.dialectId)).validate(document).firstOrNull()
        if (violation == null) compile().validate(NullNode.instance)
        violation?.let { located(it.instanceLocation.toString(), it.message) }
    } catch (e: RuntimeException) {
        e.reason()
    } catch (_: StackOverflowError) {
        "\$ref cycle that never ends"
    }
}

/** `/properties/a/type: <mensagem>`; na raiz, só a mensagem. */
private fun located(
    pointer: String,
    message: String,
): String = if (pointer.isEmpty()) message else "$pointer: $message"
