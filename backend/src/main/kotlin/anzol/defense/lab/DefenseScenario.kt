package anzol.defense.lab

import anzol.signature.SignatureState
import com.fasterxml.jackson.annotation.JsonValue

/** A versão do catálogo: com a semente, identifica os vetores de uma rodada. */
const val DEFENSE_CATALOG_VERSION = "defense-catalog/1"

enum class DefenseFamily(
    @get:JsonValue val id: String,
) {
    INTEGRITY("integrity"),
    ;

    companion object {
        fun of(id: String): DefenseFamily? = entries.firstOrNull { it.id == id }
    }
}

/** Quem deve pegar o cenário: os mecanismos da URL sozinhos (piso) ou só o agente. */
enum class DefenseLayer(
    @get:JsonValue val id: String,
) {
    FLOOR("floor"),
    AGENT("agent"),
}

/** O catálogo: [floor] é o estado da assinatura que a URL grava na requisição de ataque. */
enum class DefenseScenario(
    val family: DefenseFamily,
    val layer: DefenseLayer,
    val title: String,
    val reference: String,
    val floor: SignatureState,
) {
    I1(DefenseFamily.INTEGRITY, DefenseLayer.FLOOR, "Forged signature (wrong secret)", "OWASP API2:2023", SignatureState.INVALID),
    I2(DefenseFamily.INTEGRITY, DefenseLayer.FLOOR, "Body changed after the HMAC", "OWASP API2:2023", SignatureState.INVALID),
    I3(DefenseFamily.INTEGRITY, DefenseLayer.FLOOR, "Signature absent", "OWASP API2:2023", SignatureState.ABSENT),
    I4(DefenseFamily.INTEGRITY, DefenseLayer.FLOOR, "Replay outside the timestamp tolerance", "OWASP API2:2023", SignatureState.INVALID),
    ;

    fun view(): DefenseScenarioView = DefenseScenarioView(name, family, layer, title, reference)
}

/** Um cenário do catálogo como a API o lista. */
data class DefenseScenarioView(
    val code: String,
    val family: DefenseFamily,
    val layer: DefenseLayer,
    val title: String,
    val reference: String,
)
