package anzol.cli.support

import org.awaitility.Awaitility.await
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

private val WAIT: Duration = Duration.ofSeconds(15)

/**
 * O CLI como o usuário o roda: um processo à parte (`java anzol.cli.MainKt`) com o
 * classpath dos testes; a saída e o código de saída são observados de fora.
 */
class CliProcess(
    vararg args: String,
    env: Map<String, String> = emptyMap(),
) : AutoCloseable {
    private val process: Process =
        ProcessBuilder(listOf(javaBinary(), "-cp", System.getProperty("java.class.path"), "anzol.cli.MainKt") + args)
            .apply {
                environment().remove("ANZOL_SERVER")
                environment().putAll(env)
            }.start()
    val stdout = CopyOnWriteArrayList<String>()
    val stderr = CopyOnWriteArrayList<String>()

    init {
        thread(isDaemon = true) { process.inputStream.bufferedReader().forEachLine { stdout += it } }
        thread(isDaemon = true) { process.errorStream.bufferedReader().forEachLine { stderr += it } }
    }

    /** Espera uma linha do stdout que case inteira com [pattern] e a devolve. */
    fun awaitLine(pattern: Regex): String {
        await().atMost(WAIT).until { stdout.any(pattern::matches) || !process.isAlive }
        return stdout.firstOrNull(pattern::matches) ?: error("Sem linha $pattern; stdout=$stdout stderr=$stderr")
    }

    fun awaitExit(): Int {
        check(process.waitFor(WAIT.seconds, TimeUnit.SECONDS)) { "O CLI não terminou; stdout=$stdout stderr=$stderr" }
        return process.exitValue()
    }

    /** Ctrl+C: SIGINT no processo. */
    fun interrupt() {
        ProcessBuilder("kill", "-INT", process.pid().toString()).start().waitFor()
    }

    override fun close() {
        process.destroyForcibly().waitFor()
    }

    private fun javaBinary(): String =
        ProcessHandle
            .current()
            .info()
            .command()
            .orElse("java")
}
