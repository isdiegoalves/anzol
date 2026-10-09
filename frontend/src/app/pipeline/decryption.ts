import { CapturedRequest } from '../requests/webhook-request';
import type { CheckResult } from './pipeline';

/** O motivo do servidor numa frase, com o código como veio: "aud does not match (aud_mismatch)". */
export function decryptionReasonText(reason: string): string {
  const phrases: Record<string, string> = {
    hmac_failed: $localize`the URL signature did not pass, so nothing was opened`,
    body_not_json: $localize`the body is not JSON`,
    attribute_missing: $localize`the attribute is missing`,
    downgrade: $localize`the attribute arrived in plaintext`,
    too_large: $localize`the JWE is over 256 KiB`,
    malformed_jwe: $localize`the attribute is not a compact JWE`,
    alg_not_allowed: $localize`the JWE alg is not ECDH-ES`,
    enc_not_allowed: $localize`the JWE enc is not A256GCM`,
    zip_present: $localize`a compressed JWE (zip) is not accepted`,
    kid_missing: $localize`the JWE has no kid`,
    cty_not_jwt: $localize`the JWE cty is not JWT`,
    epk_invalid: $localize`the ephemeral key (epk) is invalid`,
    epk_off_curve: $localize`the ephemeral key (epk) is off the P-256 curve`,
    decrypt_failed: $localize`decryption failed: another key, or the JWE was altered`,
    jws_missing: $localize`there is no JWS inside the JWE`,
    jws_alg_not_allowed: $localize`the JWS alg is not ES256`,
    signer_unknown: $localize`the JWS kid is not a trusted signer`,
    signature_invalid: $localize`the JWS signature does not verify`,
    claims_malformed: $localize`the JWS claims are not a JSON object`,
    aud_mismatch: $localize`aud does not include the audience`,
    jti_mismatch: $localize`jti does not match the envelope`,
    evt_mismatch: $localize`evt does not match the envelope`,
    app_mismatch: $localize`app does not match the envelope`,
    iat_missing: $localize`the JWS has no iat`,
    iat_outside_window: $localize`iat is outside the allowed window`,
    data_missing: $localize`the JWS has no data claim`,
  };
  const phrase = phrases[reason];
  return phrase ? `${phrase} (${reason})` : reason;
}

/** O selo da decifra inválida em poucas palavras; o código fica no motivo, no nome acessível. */
function reasonShort(reason: string): string {
  const shorts: Record<string, string> = {
    hmac_failed: $localize`:decryption seal|:HMAC blocked`,
    body_not_json: $localize`:decryption seal|:Not JSON`,
    attribute_missing: $localize`:decryption seal|:Attribute missing`,
    downgrade: $localize`:decryption seal|:Plaintext · refused`,
    too_large: $localize`:decryption seal|:JWE too large`,
    malformed_jwe: $localize`:decryption seal|:Malformed JWE`,
    alg_not_allowed: $localize`:decryption seal|:alg not allowed`,
    enc_not_allowed: $localize`:decryption seal|:enc not allowed`,
    zip_present: $localize`:decryption seal|:Compressed JWE`,
    kid_missing: $localize`:decryption seal|:No kid`,
    cty_not_jwt: $localize`:decryption seal|:cty not JWT`,
    epk_invalid: $localize`:decryption seal|:Invalid epk`,
    epk_off_curve: $localize`:decryption seal|:epk off curve`,
    decrypt_failed: $localize`:decryption seal|:Decrypt failed`,
    jws_missing: $localize`:decryption seal|:No JWS inside`,
    jws_alg_not_allowed: $localize`:decryption seal|:JWS alg not allowed`,
    signer_unknown: $localize`:decryption seal|:Unknown signer`,
    signature_invalid: $localize`:decryption seal|:JWS signature invalid`,
    claims_malformed: $localize`:decryption seal|:Malformed claims`,
    aud_mismatch: $localize`:decryption seal|:aud mismatch`,
    jti_mismatch: $localize`:decryption seal|:jti mismatch`,
    evt_mismatch: $localize`:decryption seal|:evt mismatch`,
    app_mismatch: $localize`:decryption seal|:app mismatch`,
    iat_missing: $localize`:decryption seal|:No iat`,
    iat_outside_window: $localize`:decryption seal|:iat outside window`,
    data_missing: $localize`:decryption seal|:No data claim`,
  };
  return shorts[reason] ?? reason;
}

/** A decifra gravada, pronta para o selo e o cartão; `null` quando a URL não decifrava. */
export function decryptionResult(request: CapturedRequest): CheckResult | null {
  const decryption = request.decryption;
  if (!decryption) {
    return null;
  }
  const kind = 'decryption';
  const { kid, signature_kid: signer } = decryption;
  switch (decryption.state) {
    case 'valid': {
      const duplicate = decryption.duplicate_of;
      return {
        kind,
        state: 'valid',
        tone: 'ok',
        title: duplicate ? $localize`Decrypted · repeated jti` : $localize`Decrypted`,
        detail: $localize`key ${kid ?? '—'}:kid: · signed by ${signer ?? '—'}:signer:`,
        short: duplicate ? $localize`Repeated jti` : $localize`Decrypted`,
      };
    }
    case 'unknown_kid':
      return {
        kind,
        state: 'unknown-kid',
        tone: 'bad',
        title: $localize`Unknown encryption key`,
        detail: $localize`The JWE kid ${kid ?? '—'}:kid: is not one of this URL's keys`,
        short: $localize`Unknown kid`,
      };
    case 'absent':
      return {
        kind,
        state: 'absent',
        tone: 'none',
        title: $localize`Not encrypted`,
        detail: $localize`The attribute arrived in plaintext, which this URL accepts`,
        short: $localize`Plaintext`,
      };
    default: {
      const reason = decryption.reason ?? 'invalid';
      return {
        kind,
        state: 'invalid',
        tone: 'bad',
        title: $localize`Decryption invalid`,
        detail: decryptionReasonText(reason),
        short: reasonShort(reason),
      };
    }
  }
}
