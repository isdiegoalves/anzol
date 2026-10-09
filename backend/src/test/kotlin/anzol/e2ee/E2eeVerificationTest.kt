package anzol.e2ee

import anzol.rules.Parsed
import anzol.signature.SignatureResult
import com.nimbusds.jose.CompressionAlgorithm
import com.nimbusds.jose.EncryptionMethod
import com.nimbusds.jose.JWEAlgorithm
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.util.Base64URL
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.util.UUID

@DisplayName("Abertura do atributo cifrado (JWE de um JWS)")
class E2eeVerificationTest {
    private val mapper = JsonMapper.builder().build()
    private val now = Instant.now()
    private val sender = ecKey("remetente-sig-1")
    private val v1 = E2eeKey.generate("enc-v1", LocalDateTime.now())
    private val v2 = E2eeKey.generate("enc-v2", LocalDateTime.now())
    private val keys = listOf(v1, v2)
    private val id = UUID.randomUUID().toString()
    private val data = mapOf("texto" to "Olá, ação concluída 🎉", "valor" to 10)

    private fun policy(
        required: Boolean = true,
        appIgnoreCase: Boolean = true,
    ): E2eePolicy =
        when (val parsed = readE2ee(policy(sender, required = required, appIgnoreCase = appIgnoreCase))) {
            is Parsed.Valid -> parsed.value
            is Parsed.Invalid -> error(parsed.errors)
        }

    private fun sealed(
        claims: Map<String, Any?> = claims(id, data),
        key: E2eeKey = v1,
    ): String = encrypt(key.jwk.toPublicJWK(), sign(sender, claims))

    private fun open(
        body: String,
        policy: E2eePolicy = policy(),
        signature: SignatureResult? = null,
    ): Opening = policy.open(body, signature, keys, now)

    private fun reason(body: String): String? = open(body).result.reason

    @Nested
    @DisplayName("Aberturas válidas")
    inner class Valid {
        @Test
        @DisplayName("Dado o JWE do laboratório, quando abre, então valid com os kids, o jti, o aud e o data com acento e emoji")
        fun open_jweDoLaboratorio_deveAbrir() {
            val opening = open(envelope(id, sealed()))

            assertThat(opening.result)
                .isEqualTo(DecryptionResult(DecryptionState.VALID, "enc-v1", "remetente-sig-1", jti = id, aud = listOf(AUDIENCE)))
            assertThat(opening.data).isEqualTo(mapper.valueToTree(data))
        }

        @Test
        @DisplayName("Dado um JWE cifrado para a v1 depois da v2 gerada, quando abre, então valid com o kid da v1")
        fun open_rotacao_deveAbrirComAChaveAntiga() {
            assertThat(open(envelope(id, sealed(key = v1))).result.kid).isEqualTo("enc-v1")
            assertThat(open(envelope(id, sealed(key = v2))).result.kid).isEqualTo("enc-v2")
        }

        @Test
        @DisplayName("Dado app servico-exemplo no JWS e SERVICO-EXEMPLO no envelope com ignore_case, quando abre, então valid")
        fun open_appComCaixaDiferente_deveAbrir() {
            assertThat(open(envelope(id, sealed(), service = "SERVICO-EXEMPLO")).result.state).isEqualTo(DecryptionState.VALID)
        }

        @Test
        @DisplayName("Dado aud em lista com a audiência, quando abre, então valid")
        fun open_audEmLista_deveAbrir() {
            val claims = claims(id, data).also { it["aud"] = listOf("outro", AUDIENCE) }

            assertThat(open(envelope(id, sealed(claims))).result.state).isEqualTo(DecryptionState.VALID)
        }

        @Test
        @DisplayName("Dado um iat 4 minutos no futuro, quando abre, então valid (relógios diferentes)")
        fun open_iatPoucoNoFuturo_deveAbrir() {
            val claims = claims(id, data, iat = now.plus(Duration.ofMinutes(4)))

            assertThat(open(envelope(id, sealed(claims))).result.state).isEqualTo(DecryptionState.VALID)
        }
    }

    @Nested
    @DisplayName("Forja, troca e downgrade")
    inner class Forgery {
        @Test
        @DisplayName("Dado um JWE sem JWS dentro (o canal cifrou com a JWK pública), quando abre, então jws_missing")
        fun open_jweSemJws_deveRecusar() {
            assertThat(reason(envelope(id, encrypt(v1.jwk.toPublicJWK(), json(data))))).isEqualTo("jws_missing")
        }

        @Test
        @DisplayName("Dado um JWS de chave fora dos confiáveis, quando abre, então signer_unknown")
        fun open_signatarioDesconhecido_deveRecusar() {
            val jwe = encrypt(v1.jwk.toPublicJWK(), sign(ecKey("canal"), claims(id, data)))

            assertThat(reason(envelope(id, jwe))).isEqualTo("signer_unknown")
        }

        @Test
        @DisplayName("Dado um JWS com o kid confiável mas assinado por outra chave, quando abre, então signature_invalid")
        fun open_assinaturaDeOutraChave_deveRecusar() {
            val jwe = encrypt(v1.jwk.toPublicJWK(), sign(ecKey("remetente-sig-1"), claims(id, data)))

            assertThat(reason(envelope(id, jwe))).isEqualTo("signature_invalid")
        }

        @Test
        @DisplayName("Dado o ciphertext de M1 no envelope de M2, quando abre, então jti_mismatch")
        fun open_ciphertextColadoEmOutraMensagem_deveRecusar() {
            assertThat(reason(envelope(UUID.randomUUID().toString(), sealed()))).isEqualTo("jti_mismatch")
        }

        @Test
        @DisplayName("Dado o payload em claro com a decifra exigida, quando abre, então downgrade; sem exigir, absent")
        fun open_textoEmClaro_deveSerDowngrade() {
            assertThat(reason(envelope(id, data))).isEqualTo("downgrade")
            assertThat(open(envelope(id, data), policy(required = false)).result).isEqualTo(DecryptionResult(DecryptionState.ABSENT))
        }

        @Test
        @DisplayName("Dado um JWS no lugar do JWE (só assinado, não cifrado), quando abre, então downgrade")
        fun open_jwsSemCifra_deveSerDowngrade() {
            assertThat(reason(envelope(id, sign(sender, claims(id, data))))).isEqualTo("downgrade")
        }

        @Test
        @DisplayName("Dado o HMAC da URL inválido, quando abre, então hmac_failed sem decifrar")
        fun open_hmacInvalido_deveRecusarAntes() {
            val opening = open(envelope(id, sealed()), signature = SignatureResult("github", valid = false, reason = "signature mismatch"))

            assertThat(opening.result).isEqualTo(DecryptionResult(DecryptionState.INVALID, reason = "hmac_failed"))
            assertThat(opening.data).isNull()
        }
    }

    @Nested
    @DisplayName("Cabeçalho do JWE fora da lista permitida")
    inner class Header {
        @Test
        @DisplayName("Dado um kid que a URL não tem, quando abre, então unknown_kid com o kid")
        fun open_kidDesconhecido_deveSerUnknownKid() {
            val result = open(envelope(id, encrypt(ecKey("enc-v9"), sign(sender, claims(id, data))))).result

            assertThat(result).isEqualTo(DecryptionResult(DecryptionState.UNKNOWN_KID, kid = "enc-v9"))
        }

        @Test
        @DisplayName("Dado alg ECDH-ES+A256KW, enc A128CBC-HS256 ou zip DEF, quando abre, então o motivo de cada um")
        fun open_algEncZip_deveRecusar() {
            val jws = sign(sender, claims(id, data))
            val public = v1.jwk.toPublicJWK()

            assertThat(reason(envelope(id, encrypt(public, jws, algorithm = JWEAlgorithm.ECDH_ES_A256KW)))).isEqualTo("alg_not_allowed")
            assertThat(reason(envelope(id, encrypt(public, jws, method = EncryptionMethod.A128CBC_HS256)))).isEqualTo("enc_not_allowed")
            assertThat(
                reason(envelope(id, encrypt(public, jws) { compressionAlgorithm(CompressionAlgorithm.DEF) })),
            ).isEqualTo("zip_present")
        }

        @Test
        @DisplayName("Dado um epk fora da curva, quando abre, então epk_off_curve antes de decifrar")
        fun open_epkForaDaCurva_deveRecusar() {
            val jwe = sealed()
            val header = header(jwe)

            @Suppress("UNCHECKED_CAST")
            val epk = (header["epk"] as Map<String, Any?>).toMutableMap()
            val y = Base64URL(epk["y"].toString()).decode().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
            epk["y"] = Base64URL.encode(y).toString()

            assertThat(reason(envelope(id, withHeader(jwe, header + ("epk" to epk))))).isEqualTo("epk_off_curve")
        }

        @Test
        @DisplayName("Dado um epk com coordenadas de 100 KB, quando abre, então epk_off_curve sem fazer a conta")
        fun open_epkGigante_deveRecusarPeloTamanho() {
            val jwe = sealed()
            val header = header(jwe)

            @Suppress("UNCHECKED_CAST")
            val epk = (header["epk"] as Map<String, Any?>) + ("x" to Base64URL.encode(ByteArray(100_000) { 1 }).toString())

            assertThat(reason(envelope(id, withHeader(jwe, header + ("epk" to epk))))).isEqualTo("epk_off_curve")
        }

        @Test
        @DisplayName("Dado o cabeçalho sem kid ou com cty diferente de JWT, quando abre, então kid_missing e cty_not_jwt")
        fun open_semKidOuCty_deveRecusar() {
            val jwe = sealed()

            assertThat(reason(envelope(id, withHeader(jwe, header(jwe) - "kid")))).isEqualTo("kid_missing")
            assertThat(reason(envelope(id, withHeader(jwe, header(jwe) + ("cty" to "json"))))).isEqualTo("cty_not_jwt")
        }

        @Test
        @DisplayName("Dado um JWE acima de 256 KiB, quando abre, então too_large")
        fun open_jweGrande_deveRecusar() {
            val jwe = sealed()
            val big = jwe.substringBeforeLast('.') + "A".repeat(MAX_JWE_LENGTH) + "." + jwe.substringAfterLast('.')

            assertThat(reason(envelope(id, big))).isEqualTo("too_large")
        }

        @Test
        @DisplayName("Dado um JWE com o cabeçalho trocado, quando abre, então decrypt_failed (o cabeçalho é autenticado)")
        fun open_cabecalhoAdulterado_deveFalharADecifra() {
            val jwe = sealed()

            assertThat(reason(envelope(id, withHeader(jwe, header(jwe) + ("x-extra" to 1))))).isEqualTo("decrypt_failed")
        }

        @Test
        @DisplayName("Dado cinco pedaços que não são JWE, quando abre, então malformed_jwe")
        fun open_lixoComCincoPartes_deveRecusar() {
            assertThat(reason(envelope(id, "a.b.c.d.e"))).isEqualTo("malformed_jwe")
        }
    }

    @Nested
    @DisplayName("JWS e claims")
    inner class Claims {
        @Test
        @DisplayName("Dado um JWS alg none ou HS256, quando abre, então jws_alg_not_allowed")
        fun open_jwsNoneOuHs256_deveRecusar() {
            val part = { value: Map<String, Any?> -> Base64URL.encode(json(value)).toString() }
            val none = part(mapOf("alg" to "none", "kid" to "remetente-sig-1")) + "." + part(claims(id, data)) + "."
            val hs256 = sign(sender, claims(id, data), JWSAlgorithm.HS256)

            assertThat(reason(envelope(id, encrypt(v1.jwk.toPublicJWK(), none)))).isEqualTo("jws_alg_not_allowed")
            assertThat(reason(envelope(id, encrypt(v1.jwk.toPublicJWK(), hs256)))).isEqualTo("jws_alg_not_allowed")
        }

        @Test
        @DisplayName("Dado aud, evt ou app diferentes (app sem ignore_case), quando abre, então o mismatch de cada um")
        fun open_claimsDiferentes_deveRecusar() {
            val aud = claims(id, data).also { it["aud"] = "outro" }
            val evt = claims(id, data).also { it["evt"] = "pedido_criado" }

            assertThat(reason(envelope(id, sealed(aud)))).isEqualTo("aud_mismatch")
            assertThat(reason(envelope(id, sealed(evt)))).isEqualTo("evt_mismatch")
            assertThat(open(envelope(id, sealed()), policy(appIgnoreCase = false)).result.reason).isEqualTo("app_mismatch")
        }

        @Test
        @DisplayName("Dado iat ausente, velho (13 h) ou 10 minutos no futuro, quando abre, então iat_missing e iat_outside_window")
        fun open_iatForaDaJanela_deveRecusar() {
            val missing = claims(id, data).also { it.remove("iat") }

            assertThat(reason(envelope(id, sealed(missing)))).isEqualTo("iat_missing")
            assertThat(
                reason(envelope(id, sealed(claims(id, data, iat = now.minus(Duration.ofHours(13)))))),
            ).isEqualTo("iat_outside_window")
            assertThat(
                reason(envelope(id, sealed(claims(id, data, iat = now.plus(Duration.ofMinutes(10)))))),
            ).isEqualTo("iat_outside_window")
        }

        @Test
        @DisplayName("Dado um JWS sem data, quando abre, então data_missing com o jti assinado")
        fun open_semData_deveRecusar() {
            val result = open(envelope(id, sealed(claims(id, data).also { it.remove("data") }))).result

            assertThat(result.reason).isEqualTo("data_missing")
            assertThat(result.jti).isEqualTo(id)
            assertThat(result.signatureKid).isEqualTo("remetente-sig-1")
        }
    }

    @Nested
    @DisplayName("Envelope")
    inner class Envelope {
        @Test
        @DisplayName("Dado um corpo que não é JSON ou sem o atributo, quando abre, então body_not_json e attribute_missing")
        fun open_semEnvelope_deveRecusar() {
            assertThat(reason("não é json")).isEqualTo("body_not_json")
            assertThat(reason("""{"eventId":"$id"}""")).isEqualTo("attribute_missing")
        }
    }
}
