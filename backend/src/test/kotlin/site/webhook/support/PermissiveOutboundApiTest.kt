package site.webhook.support

import org.springframework.test.context.TestPropertySource
import tools.jackson.databind.JsonNode
import java.net.http.HttpResponse

/** [ApiTest] com `allow-private=true`: o replay e o send alcançam o [Receiver] em 127.0.0.1 e o próprio app. */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@ApiTest
@TestPropertySource(properties = ["webhook.outbound.allow-private=true"])
annotation class PermissiveOutboundApiTest

fun ApiClient.replay(
    tokenId: String,
    requestId: String,
    body: String,
): HttpResponse<String> = send("POST", "/token/$tokenId/request/$requestId/replay", body.toByteArray(), JSON_BODY)

fun ApiClient.sendOut(
    tokenId: String,
    body: String,
): HttpResponse<String> = send("POST", "/token/$tokenId/send", body.toByteArray(), JSON_BODY)

fun ApiClient.outbound(tokenId: String): JsonNode = json(send("GET", "/token/$tokenId/outbound", headers = JSON_CLIENT))
