package anzol.e2ee.lab

import anzol.http.requireJsonObject
import anzol.http.validationFailure
import anzol.rules.Parsed
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** URLs de laboratório E2EE: criar uma pronta para os cenários (ver [LabService]). */
@RestController
@RequestMapping("/e2ee-lab")
class LabController(
    private val labs: LabService,
) {
    @PostMapping
    fun create(request: HttpServletRequest): ResponseEntity<Any> =
        when (val created = labs.create(request.requireJsonObject().inputBag(), request.remoteAddr, request.getHeader("User-Agent"))) {
            is Parsed.Valid -> ResponseEntity.status(HttpStatus.CREATED).body(created.value)
            is Parsed.Invalid -> request.validationFailure(created.errors)
        }
}
