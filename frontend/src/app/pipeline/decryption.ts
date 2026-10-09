import { localDate } from '../request-detail/dates';
import { CapturedRequest, DecryptionResult } from '../requests/webhook-request';
import { E2eeBinding, Token } from '../token/token';
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
    case 'unknown_kid': {
      const deletedAt = decryption.kid_deleted_at;
      return deletedAt
        ? {
            kind,
            state: 'unknown-kid',
            tone: 'bad',
            title: $localize`Deleted encryption key`,
            detail: $localize`The JWE kid ${kid ?? '—'}:kid: is a key this URL deleted on ${localDate(deletedAt)}:date:`,
            short: $localize`Deleted key`,
          }
        : {
            kind,
            state: 'unknown-kid',
            tone: 'bad',
            title: $localize`Unknown encryption key`,
            detail: $localize`The JWE kid ${kid ?? '—'}:kid: is not one of this URL's keys`,
            short: $localize`Unknown kid`,
          };
    }
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
        title:
          reason === 'hmac_failed'
            ? $localize`:decryption not run because the HMAC failed|:Decryption invalid`
            : $localize`Decryption invalid`,
        detail: decryptionReasonText(reason),
        short: reasonShort(reason),
      };
    }
  }
}

/**
 * O que fazer com a decifra que falhou e quem faz (o remetente, a configuração da URL, ou a
 * mensagem foi alterada), com o que a URL tem configurado hoje. Sem a URL (link só-leitura), só o
 * que fazer.
 */
export function decryptionAdvice(decryption: DecryptionResult, token: Token | null): string[] {
  const deletedAt = decryption.kid_deleted_at;
  if (decryption.state === 'unknown_kid') {
    return [...keysFact(token), unknownKidAdvice(deletedAt)];
  }
  if (decryption.state !== 'invalid') {
    return [];
  }
  const reason = decryption.reason ?? '';
  if (reason === 'decrypt_failed' && deletedAt) {
    return [
      ...configuredFact(reason, token),
      $localize`A key with this kid was deleted on ${localDate(deletedAt)}:date: and recreated: the sender encrypted to the deleted key. Ask them to fetch this URL's JWKS again.`,
    ];
  }
  return [...configuredFact(reason, token), ...reasonAdvice(reason)];
}

function keysFact(token: Token | null): string[] {
  if (!token) {
    return [];
  }
  const kids = (token.e2ee_keys ?? []).map((key) => key.kid);
  return kids.length > 0
    ? [$localize`Encryption keys here: ${kids.join(', ')}:kids:`]
    : [
        $localize`This URL has no encryption key: generate one in Checks › Decryption and publish the JWKS.`,
      ];
}

/** Com a data, a URL apagou a chave; sem, não há registro (ela guarda as 20 exclusões mais novas). */
function unknownKidAdvice(deletedAt: string | null | undefined): string {
  return deletedAt
    ? $localize`This URL deleted this key on ${localDate(deletedAt)}:date:: the sender still uses the old JWKS. Ask them to fetch it again.`
    : $localize`This URL has no record of deleting this key (it keeps its last 20 deleted keys): the sender most likely encrypted to another recipient. Check which JWKS the sender uses.`;
}

/** O que a URL configura e o motivo cita: os signatários, a audiência, o atributo, o vínculo. */
function configuredFact(reason: string, token: Token | null): string[] {
  const policy = token?.e2ee;
  if (!token || !policy) {
    return [];
  }
  const claim = /^(jti|evt|app)_mismatch$/.exec(reason)?.[1] as 'jti' | 'evt' | 'app' | undefined;
  if (claim) {
    const path = bindingPath(policy.bindings[claim]);
    return [$localize`Binding here: ${claim}:claim: ↔ ${path}:path:`];
  }
  switch (reason) {
    case 'signer_unknown':
    case 'signature_invalid': {
      const kids = policy.trusted_signers.map((jwk) => String(jwk['kid'] ?? '—'));
      return kids.length > 0
        ? [$localize`Trusted signers here: ${kids.join(', ')}:kids:`]
        : [$localize`This URL has no trusted signer.`];
    }
    case 'aud_mismatch':
      return [$localize`Audience here: ${policy.audience}:audience:`];
    case 'downgrade':
    case 'attribute_missing':
      return [$localize`Encrypted attribute here: ${policy.path}:path:`];
    case 'iat_outside_window':
      return [$localize`Max age here: ${policy.max_age_seconds}:seconds: s`];
    case 'decrypt_failed':
      return keysFact(token);
    default:
      return [];
  }
}

function bindingPath(binding: E2eeBinding): string {
  return typeof binding === 'string' ? binding : binding.path;
}

function reasonAdvice(reason: string): string[] {
  const sender = {
    body: $localize`The sender must send a JSON body carrying the encrypted attribute.`,
    epk: $localize`The sender must use a valid P-256 ephemeral key (epk) in the JWE header.`,
    claims: $localize`A message cut from another envelope, or the binding set here points at the wrong field (case only: turn on Ignore case).`,
  };
  const advice: Record<string, string> = {
    hmac_failed: $localize`Check the HMAC signature first: decryption only runs after it. The signature card says whether the sender or the secret set here is at fault.`,
    body_not_json: sender.body,
    attribute_missing: $localize`The sender did not send it, or the encrypted attribute set here points at another field: check it against a real message.`,
    downgrade: $localize`The sender sent it in plaintext, or the encrypted attribute set here points at another field.`,
    too_large: $localize`The sender must keep the JWE up to 256 KiB.`,
    malformed_jwe: $localize`The sender must send a compact JWE (five parts separated by dots).`,
    alg_not_allowed: $localize`The sender must encrypt with alg ECDH-ES (direct key agreement), the only one accepted.`,
    enc_not_allowed: $localize`The sender must encrypt with enc A256GCM, the only one accepted.`,
    zip_present: $localize`The sender must not compress the JWE (no zip in its header).`,
    kid_missing: $localize`The sender must put in the JWE header the kid of an encryption key of this URL.`,
    cty_not_jwt: $localize`The sender must put cty: JWT in the JWE header.`,
    epk_invalid: sender.epk,
    epk_off_curve: sender.epk,
    decrypt_failed: $localize`The message was altered, the key was deleted and recreated with the same kid, or the sender encrypted to another URL's key with the same kid (every lab has enc-v1 and enc-v2). Check which JWKS the sender uses.`,
    jws_missing: $localize`The sender encrypted the data directly, without signing: the format requires an ES256 JWS inside the JWE.`,
    jws_alg_not_allowed: $localize`The sender must sign the JWS with ES256.`,
    signer_unknown: $localize`If the sender rotated keys, paste the new public key in Checks › Decryption › Trusted signers; if you do not recognize this key, treat it as an unknown sender.`,
    signature_invalid: $localize`The sender rotated keys and kept the kid, the public key pasted here is wrong, or it is a forgery. Paste the sender's current public key again.`,
    claims_malformed: $localize`The sender must sign a JSON object of claims in the JWS.`,
    aud_mismatch: $localize`The sender must send aud with this URL's audience, or the audience set here is not the agreed one.`,
    jti_mismatch: sender.claims,
    evt_mismatch: sender.claims,
    app_mismatch: sender.claims,
    iat_missing: $localize`The sender must put iat (the signing time) in the JWS claims.`,
    iat_outside_window: $localize`The window goes from the max age set here into the past up to 5 min into the future: late redelivery or a wrong clock at the sender; or raise the max age here.`,
    data_missing: $localize`The sender must put the data claim (the attribute itself) in the JWS.`,
  };
  return advice[reason] ? [advice[reason]] : [];
}
