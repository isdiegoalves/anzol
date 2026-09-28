package site.webhook.cli

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import java.io.DataInputStream

/** `major_version` do formato de classe do Java 21 (JVMS §4.1): 44 + a versão. */
private const val JAVA_21_CLASS_VERSION = 65
private const val CLASS_FILE_MAGIC = 0xCAFEBABE.toInt()

/**
 * O CLI é construído com o JDK 25 e roda em Java 21 (o LTS que as máquinas de dev e de CI têm): as classes saem no
 * formato do 21, e o compilador recusa API do JDK que só existe depois dele (`-Xjdk-release`).
 */
@DisplayName("Bytecode do CLI")
class BytecodeTargetTest {
    private fun majorVersion(resource: String): Int {
        val stream = checkNotNull(javaClass.classLoader.getResourceAsStream(resource)) { "classe $resource fora do classpath" }
        return DataInputStream(stream).use { input ->
            check(input.readInt() == CLASS_FILE_MAGIC) { "$resource não é uma classe" }
            input.readUnsignedShort() // minor_version
            input.readUnsignedShort()
        }
    }

    @Test
    @DisplayName("Dado o CLI compilado, quando lê a versão das classes, então é a do Java 21")
    fun classes_doCli_devemSerJava21() {
        val classes = listOf("site/webhook/cli/MainKt.class", "site/webhook/cli/WebhookServer.class", "site/webhook/cli/Listen.class")

        assertThat(classes.map(::majorVersion)).containsOnly(JAVA_21_CLASS_VERSION)
    }
}
