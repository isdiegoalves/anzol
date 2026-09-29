package anzol.legacy

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import tools.jackson.databind.json.JsonMapper

/** Casos medidos no app antigo (porta 8084) com `curl -g`; a saída esperada é o JSON que ele gravou. */
@DisplayName("Arrays do PHP")
class PhpArraysTest {
    private val jsonMapper = JsonMapper.builder().build()

    private fun parsedAsJson(raw: String): String = jsonMapper.writeValueAsString(parseStr(raw.toByteArray()).toJson())

    @Nested
    @DisplayName("parseStr")
    inner class ParseStr {
        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado uma query medida no app antigo, quando é decodificada, então sai o mesmo array do PHP")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            b=2&a=1&a=3&c[]=x&c[]=y&d.e=5&f        | {"b":"2","a":"3","c":["x","y"],"d_e":"5","f":""}
            x=1+2&y=%41&z[a][b]=1&z[a][c]=2&e=&=v  | {"x":"1 2","y":"A","z":{"a":{"b":"1","c":"2"}},"e":""}
            a%20b=1                                | {"a_b":"1"}
            1=b&0=a&010=x&-5=y&1.5=z               | {"1":"b","0":"a","010":"x","-5":"y","1_5":"z"}
            0=a&1=b                                | ["a","b"]
            a[]=1&a=2                              | {"a":"2"}
            a=2&a[]=1                              | {"a":["1"]}
            a[x]=1&a[]=2                           | {"a":{"x":"1","0":"2"}}
            %5B=1&x%5By%5D=2&a+b=3&c%2Ed=4         | {"x":{"y":"2"},"a_b":"3","c_d":"4"}
            a[b][]=1&a[b][]=2&a[][]=3              | {"a":{"b":["1","2"],"0":["3"]}}
            x&y&&z=1&                              | {"x":"","y":"","z":"1"}""",
        )
        fun parseStr_queryMedidaNoLegado_deveGerarOMesmoArray(
            raw: String,
            expected: String,
        ) {
            assertThat(jsonMapper.readTree(parsedAsJson(raw))).isEqualTo(jsonMapper.readTree(expected))
        }

        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado colchete sem fechamento, quando é decodificado, então o PHP troca o [ por _ e usa o índice corrente")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            m[=1          | {"m_":"1"}
            o[a.b=1       | {"o_a.b":"1"}
            p.q[r=1       | {"p_q_r":"1"}
            a[b][c=1      | {"a":{"b":"1"}}
            k[ ]=1&k[ ]=2 | {"k":["1","2"]}""",
        )
        fun parseStr_colcheteAberto_deveSeguirOPhp(
            raw: String,
            expected: String,
        ) {
            assertThat(jsonMapper.readTree(parsedAsJson(raw))).isEqualTo(jsonMapper.readTree(expected))
        }

        @Test
        @DisplayName("Dado bytes que não são UTF-8, quando é decodificado, então o valor fica com U+FFFD em vez de falhar")
        fun parseStr_utf8Invalido_deveSubstituirPorReplacement() {
            val parsed = parseStr("q=%FF&ok=%C3%A7".toByteArray())

            assertThat(parsed).containsEntry("q", "�").containsEntry("ok", "ç")
        }

        @Test
        @DisplayName("Dado uma query vazia, quando é decodificada, então o array é vazio")
        fun parseStr_vazio_deveGerarArrayVazio() {
            assertThat(parseStr(ByteArray(0))).isEmpty()
        }
    }

    @Nested
    @DisplayName("normalizeQueryString")
    inner class NormalizeQueryString {
        @ParameterizedTest(name = "{0} → {1}")
        @DisplayName("Dado uma query, quando o Symfony a normaliza, então ordena pelo nome e recodifica")
        @CsvSource(
            delimiter = '|',
            textBlock = """
            b=2&a=1&a=3&c[]=x&c[]=y&d.e=5&f  | a=1&a=3&b=2&c%5B%5D=x&c%5B%5D=y&d.e=5&f
            10=a&9=b&b=1&B=2&a=2&a=1         | 9=b&10=a&B=2&a=1&a=2&b=1
            x&y&&z=1&=v&                     | x&y&z=1
            plus=a+b&sp=a%20b&%C3%A7=%C3%A3  | plus=a%20b&sp=a%20b&%C3%A7=%C3%A3
            ~a=1&-b=2                        | -b=2&~a=1""",
        )
        fun normalizeQueryString_queryMedida_deveOrdenarERecodificar(
            raw: String,
            expected: String,
        ) {
            assertThat(normalizeQueryString(raw)).isEqualTo(expected)
        }

        @Test
        @DisplayName("Dado uma query ausente, quando é normalizada, então fica vazia")
        fun normalizeQueryString_nula_deveFicarVazia() {
            assertThat(normalizeQueryString(null)).isEmpty()
        }
    }
}
