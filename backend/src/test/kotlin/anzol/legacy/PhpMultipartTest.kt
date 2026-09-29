package anzol.legacy

import org.assertj.core.api.Assertions.assertThat
import org.assertj.core.api.Assertions.entry
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import tools.jackson.databind.json.JsonMapper
import java.nio.charset.StandardCharsets.ISO_8859_1

/**
 * Casos medidos no app antigo (porta 8084, PHP 7.3.5) com o corpo cru; a saída esperada é o
 * `request` que ele gravou. No corpo das tabelas, `\r`, `\n` e `\0` são os bytes CR, LF e NUL.
 */
@DisplayName("Multipart do PHP (rfc1867.c)")
class PhpMultipartTest {
    private val jsonMapper = JsonMapper.builder().build()

    private fun bytes(escaped: String): ByteArray =
        escaped
            .replace("\\r", "\r")
            .replace("\\n", "\n")
            .replace("\\0", "\u0000")
            .toByteArray(ISO_8859_1)

    private fun fieldsAsJson(parsed: PhpMultipart): String = jsonMapper.writeValueAsString(parsed.fields.toJson())

    private fun part(
        name: String,
        value: String,
    ): String = "--XyZ\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n"

    @Nested
    @DisplayName("phpMultipartBoundary")
    inner class Boundary {
        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado um Content-Type medido no app antigo, quando procura o boundary, então acha o mesmo que o PHP")
        @CsvSource(
            delimiter = '|',
            quoteCharacter = '`',
            nullValues = ["NULL"],
            textBlock = """
            multipart/form-data; boundary=XyZ                  | XyZ
            multipart/form-data; xboundary=XyZ                 | XyZ
            multipart/form-data; BOUNDARY=XyZ                  | XyZ
            multipart/form-data; boundary="XyZ"                | XyZ
            multipart/form-data; boundary=XyZ,foo              | XyZ
            multipart/form-data; boundary=XyZ ; x=1            | `XyZ `
            multipart/form-data; boundaryfoo; x=XyZ            | XyZ
            multipart/form-data; charset=utf-8; boundary=XyZ   | XyZ
            multipart/form-data; boundary=                     | ``
            multipart/form-data; boundary="XyZ                 | NULL
            multipart/form-data                                | NULL""",
        )
        fun phpMultipartBoundary_contentTypeMedido_deveAcharOMesmoBoundary(
            contentType: String,
            expected: String?,
        ) {
            assertThat(phpMultipartBoundary(contentType)).isEqualTo(expected)
        }
    }

    @Nested
    @DisplayName("parseMultipart")
    inner class Parse {
        @ParameterizedTest(name = "{0}")
        @DisplayName("Dado um multipart medido no app antigo, quando é decodificado, então guarda os mesmos campos que o PHP")
        @CsvSource(
            delimiter = '|',
            quoteCharacter = '`',
            textBlock = """
            sem o boundary final         | --XyZ\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--XyZ\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n              | {"a":"1","b":"2"}
            lixo depois da última parte  | --XyZ\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--XyZ\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\nlixo sem fechar | {"a":"1","b":"2\r\nlixo sem fechar"}
            linhas só LF                 | --XyZ\nContent-Disposition: form-data; name="a"\n\n1\n--XyZ--\n                                                                              | {"a":"1"}
            preâmbulo e epílogo          | lixo antes\r\n--XyZx\r\n--XyZ\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--XyZ--\r\nepilogo                                    | {"a":"1"}
            fim no meio do boundary      | --XyZ\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--X                                                                           | {"a":"1"}
            sem CRLF no boundary final   | --XyZ\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--XyZ                                                                         | {"a":"1"}
            cabeçalho sem linha vazia    | --XyZ\r\nContent-Disposition: form-data; name="a"\r\nvalor                                                                                  | {"a":"valor"}
            cabeçalho e fim do corpo     | --XyZ\r\nContent-Disposition: form-data; name="a"\r\n                                                                                       | {"a":""}
            cabeçalho sem quebra de linha| --XyZ\r\nContent-Disposition: form-data; name="a"                                                                                           | []
            valor com CR e CRLF          | --XyZ\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\r\n--XyZ\r\nContent-Disposition: form-data; name="b"\r\n\r\n\r\n2\r\n\r\n--XyZ--  | {"a":"1\r","b":"\r\n2\r\n"}
            valor com prefixo do boundary| --XyZ\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--XyZabc\r\nContent-Disposition: form-data; name="z"\r\n\r\nz\r\n--XyZ--       | {"a":"1"}
            boundary com espaço na linha | --XyZ \r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--XyZ\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n--XyZ--           | {"b":"2"}
            NUL na linha do boundary     | --XyZ\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--XyZ\0lixo\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n--XyZ--      | {"a":"1","b":"2"}
            NUL no nome e no valor       | --XyZ\r\nContent-Disposition: form-data; name="a\0b"\r\n\r\n1\02\r\n--XyZ--                                                                  | {"a":"1\u00002"}
            só CR                        | --XyZ\rContent-Disposition: form-data; name="a"\r\r1\r--XyZ--\r                                                                             | []
            parte sem name encerra       | --XyZ\r\nContent-Disposition: form-data\r\n\r\nx\r\n--XyZ\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n--XyZ--                     | []
            parte sem Content-Disposition| --XyZ\r\nX-Foo: bar\r\n\r\nx\r\n--XyZ\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n--XyZ--                                         | {"b":"2"}
            cabeçalho em minúsculas      | --XyZ\r\ncontent-disposition: form-data; name=a\r\n\r\n1\r\n--XyZ--                                                                        | {"a":"1"}
            espaço antes do dois-pontos  | --XyZ\r\nContent-Disposition : form-data; name="a"\r\n\r\n1\r\n--XyZ--                                                                     | []
            cabeçalho continuado         | --XyZ\r\nContent-Disposition: form-data;\r\n name="a"\r\n\r\n1\r\n--XyZ--                                                                   | {"a":"1"}
            linha sem dois-pontos        | --XyZ\r\nContent-Disposition: form-data; na\r\nme="a"\r\n\r\n1\r\n--XyZ--                                                                  | {"a":"1"}
            lixo antes do cabeçalho      | --XyZ\r\nlixo\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--XyZ--                                                              | {"a":"1"}
            Content-Disposition repetido | --XyZ\r\nContent-Disposition: form-data; name="a"\r\nContent-Disposition: form-data; name="b"\r\n\r\n1\r\n--XyZ--                          | {"a":"1"}
            chave com espaço e NAME      | --XyZ\r\nContent-Disposition: form-data; name ="a"; NAME="b"\r\n\r\n1\r\n--XyZ--                                                         | {"b":"1"}
            sem form-data                | --XyZ\r\nContent-Disposition: name="a"\r\n\r\n1\r\n--XyZ--                                                                                  | {"a":"1"}
            dois sinais de igual         | --XyZ\r\nContent-Disposition: form-data; name=="a"\r\n\r\n1\r\n--XyZ--                                                                      | {"a":"1"}
            ponto e vírgula entre aspas  | --XyZ\r\nContent-Disposition: form-data; name="a;b"; x=1\r\n\r\n1\r\n--XyZ--                                                               | {"a;b":"1"}
            aspas simples                | --XyZ\r\nContent-Disposition: form-data; name='a'\r\n\r\n1\r\n--XyZ--                                                                       | {"a":"1"}
            barras de escape             | --XyZ\r\nContent-Disposition: form-data; name="a\"b"\r\n\r\n1\r\n--XyZ\r\nContent-Disposition: form-data; name=e\\f\r\n\r\n3\r\n--XyZ--     | {"a\"b":"1","e\\f":"3"}
            arquivo descartado           | --XyZ\r\nContent-Disposition: form-data; name="f"; filename="x.txt"\r\n\r\nc\r\n--XyZ\r\nContent-Disposition: form-data; name="f"\r\n\r\nt\r\n--XyZ-- | {"f":"t"}
            filename antes do name       | --XyZ\r\nContent-Disposition: form-data; filename="x"; name="a"\r\n\r\n1\r\n--XyZ\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n--XyZ-- | {"b":"2"}
            arquivo anônimo              | --XyZ\r\nContent-Disposition: form-data; filename="x.txt"\r\n\r\nc\r\n--XyZ\r\nContent-Disposition: form-data; name="0"\r\n\r\nzero\r\n--XyZ-- | ["zero"]
            nomes com a gramática do PHP | --XyZ\r\nContent-Disposition: form-data; name="a b"\r\n\r\n1\r\n--XyZ\r\nContent-Disposition: form-data; name="e[  f]"\r\n\r\n3\r\n--XyZ--      | {"a_b":"1","e":{"  f":"3"}}
            corpo vazio                  | `` | []""",
        )
        fun parseMultipart_corpoMedidoNoLegado_deveGuardarOsMesmosCampos(
            case: String,
            body: String,
            expected: String,
        ) {
            val parsed = parseMultipart(bytes(body), "XyZ")

            assertThat(jsonMapper.readTree(fieldsAsJson(parsed))).`as`(case).isEqualTo(jsonMapper.readTree(expected))
            assertThat(parsed.unread).`as`(case).isEmpty()
        }

        @Test
        @DisplayName("Dado boundary vazio e linhas \"--\", quando é decodificado, então o PHP usa \"--\" como separador")
        fun parseMultipart_boundaryVazio_deveUsarDoisTracos() {
            val parsed = parseMultipart(bytes("--\\r\\nContent-Disposition: form-data; name=\"a\"\\r\\n\\r\\n1\\r\\n--\\r\\n"), "")

            assertThat(parsed.fields).containsExactly(entry("a", "1"))
        }

        @Test
        @DisplayName("Dado mais de 1000 campos de texto, quando é decodificado, então guarda só os 1000 primeiros (max_input_vars)")
        fun parseMultipart_maisDe1000Campos_deveGuardarOsPrimeiros1000() {
            val body = (0 until 1001).joinToString("") { part("f$it", "v$it") } + "--XyZ--\r\n"

            val parsed = parseMultipart(body.toByteArray(ISO_8859_1), "XyZ")

            assertThat(parsed.fields).hasSize(1000).containsEntry("f999", "v999").doesNotContainKey("f1000")
        }

        @Test
        @DisplayName("Dado um nome de campo maior que o buffer de 5 KB do PHP, quando é decodificado, então o nome fica inteiro")
        fun parseMultipart_nomeMaiorQueOBuffer_deveGuardarONomeInteiro() {
            val name = "n".repeat(6000)

            val parsed = parseMultipart((part(name, "v") + "--XyZ--\r\n").toByteArray(ISO_8859_1), "XyZ")

            assertThat(parsed.fields).containsExactly(entry(name, "v"))
        }

        @Test
        @DisplayName("Dado UTF-8 no nome e no valor, quando é decodificado, então os campos saem em UTF-8")
        fun parseMultipart_utf8_deveGuardarEmUtf8() {
            val parsed = parseMultipart((part("ação", "é") + "--XyZ--\r\n").toByteArray(Charsets.UTF_8), "XyZ")

            assertThat(parsed.fields).containsExactly(entry("ação", "é"))
        }

        @Test
        @DisplayName(
            "Dado uma parte sem name num corpo maior que o buffer, quando o PHP desiste, então o que ele não leu sobra para php://input",
        )
        fun parseMultipart_desistenciaComCorpoGrande_deveDevolverOQueNaoFoiLido() {
            val body =
                ("--XyZ\r\nContent-Disposition: form-data\r\n\r\nx\r\n" + part("b", "y".repeat(20_000)) + "--XyZ--\r\n")
                    .toByteArray(ISO_8859_1)

            val parsed = parseMultipart(body, "XyZ")

            assertThat(parsed.fields).isEmpty()
            assertThat(parsed.unread).isEqualTo(body.copyOfRange(5 * 1024, body.size))
        }
    }
}
