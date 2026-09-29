package anzol.rules

import anzol.RequestId
import java.time.Instant
import java.util.UUID

/** A mensagem e a hora de chegada dos testes em que o sorteio e a janela não entram. */
val ANY_REQUEST = RequestId(UUID.fromString("3c2e0b6a-1f4d-4e8b-9a7c-5d6e7f8091a2"))
val ANY_TIME: Instant = Instant.parse("2026-09-29T12:00:00Z")
