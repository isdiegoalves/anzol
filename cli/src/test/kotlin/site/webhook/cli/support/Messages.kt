package site.webhook.cli.support

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID

private val TIMESTAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

/** Uma linha de mensagem do CLI: `HH:mm:ss MÉTODO caminho -> status (n ms)`. */
fun forwardedLine(
    method: String,
    target: String,
    status: Int,
): Regex = Regex("""\d{2}:\d{2}:\d{2} $method ${Regex.escape(target)} -> $status \(\d+ ms\)""")

/**
 * Mensagem gravada no formato de `tests/contract/` (`GET /token/{id}/request/{rid}`), recebida
 * pelo webhook.site em `http://localhost:8084/{token}{target}`; [target] é o caminho após o
 * token com a query (`/a/b?x=1`).
 */
fun message(
    token: String,
    method: String = "POST",
    target: String = "",
    headers: Map<String, List<String>> = mapOf("content-type" to listOf("text/plain"), "content-length" to listOf("0")),
    content: String = "",
): JsonObject {
    val createdAt = LocalDateTime.now(ZoneOffset.UTC).format(TIMESTAMP)
    return buildJsonObject {
        put("uuid", UUID.randomUUID().toString())
        put("token_id", token)
        put("ip", "172.18.0.1")
        put("hostname", "localhost")
        put("method", method)
        put("user_agent", headers["user-agent"]?.lastOrNull())
        put("content", content)
        put("query", JsonNull)
        putJsonObject("headers") {
            headers.forEach { (name, values) -> putJsonArray(name) { values.forEach { add(JsonPrimitive(it)) } } }
        }
        put("url", "http://localhost:8084/$token$target")
        put("created_at", createdAt)
        put("updated_at", createdAt)
    }
}

/** A mensagem com [key] trocado (ou acrescentado), ex.: `request` de um multipart. */
fun JsonObject.with(
    key: String,
    value: JsonElement,
): JsonObject = JsonObject(this + (key to value))

fun JsonObject.uuid(): String = getValue("uuid").jsonPrimitive.content
