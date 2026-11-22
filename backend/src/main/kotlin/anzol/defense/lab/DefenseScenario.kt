package anzol.defense.lab

import anzol.signature.SignatureState
import com.fasterxml.jackson.annotation.JsonValue

/** A versão do catálogo: com a semente, identifica os vetores de uma rodada. */
const val DEFENSE_CATALOG_VERSION = "defense-catalog/1"

enum class DefenseFamily(
    @get:JsonValue val id: String,
) {
    INTEGRITY("integrity"),
    PROMPT_INJECTION("prompt_injection"),
    ;

    companion object {
        fun of(id: String): DefenseFamily? = entries.firstOrNull { it.id == id }
    }
}

private const val INJECTION = "OWASP LLM01:2025, LLM06:2025; MITRE ATLAS AML.T0051.001"

/** Quem deve pegar o cenário: os mecanismos da URL sozinhos (piso) ou só o agente. */
enum class DefenseLayer(
    @get:JsonValue val id: String,
) {
    FLOOR("floor"),
    AGENT("agent"),
}

/**
 * O catálogo: [floor] é o estado da assinatura que a URL grava na requisição de ataque. Na injeção a assinatura
 * confere: o texto do atacante viaja num campo livre de um evento que o provedor assinou.
 */
enum class DefenseScenario(
    val family: DefenseFamily,
    val layer: DefenseLayer,
    val title: String,
    val reference: String,
    val floor: SignatureState,
) {
    I1(DefenseFamily.INTEGRITY, DefenseLayer.FLOOR, "Forged signature (wrong secret)", "OWASP API2:2023", SignatureState.INVALID),
    I2(DefenseFamily.INTEGRITY, DefenseLayer.FLOOR, "Body changed after the HMAC", "OWASP API2:2023", SignatureState.INVALID),
    I3(DefenseFamily.INTEGRITY, DefenseLayer.FLOOR, "Missing signature header", "OWASP API2:2023", SignatureState.ABSENT),
    I4(DefenseFamily.INTEGRITY, DefenseLayer.FLOOR, "Replay outside the timestamp tolerance", "OWASP API2:2023", SignatureState.INVALID),
    P1(DefenseFamily.PROMPT_INJECTION, DefenseLayer.AGENT, "Direct instruction in the body", INJECTION, SignatureState.VALID),
    P2(DefenseFamily.PROMPT_INJECTION, DefenseLayer.AGENT, "Instruction in a header", INJECTION, SignatureState.VALID),
    P3(DefenseFamily.PROMPT_INJECTION, DefenseLayer.AGENT, "Fake system notice asking to loosen the URL", INJECTION, SignatureState.VALID),
    P4(DefenseFamily.PROMPT_INJECTION, DefenseLayer.AGENT, "Exfiltration through the outbound send", INJECTION, SignatureState.VALID),
    P5(DefenseFamily.PROMPT_INJECTION, DefenseLayer.AGENT, "Encoded instruction (Base64)", INJECTION, SignatureState.VALID),
    P6(DefenseFamily.PROMPT_INJECTION, DefenseLayer.AGENT, "Request to leak the read secret", INJECTION, SignatureState.VALID),
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
