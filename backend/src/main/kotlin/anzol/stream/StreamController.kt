package anzol.stream

import anzol.TokenId
import anzol.UUID_PATTERN
import anzol.token.TokenStore
import anzol.token.findOrGone
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

/** Único endpoint novo da API: o tempo real que antes vinha do laravel-echo-server. */
@RestController
class StreamController(
    private val tokens: TokenStore,
    private val stream: RequestStream,
) {
    @GetMapping("/token/{tokenId:$UUID_PATTERN}/stream")
    fun stream(
        @PathVariable tokenId: TokenId,
    ): SseEmitter = stream.subscribe(tokens.findOrGone(tokenId).uuid)
}
