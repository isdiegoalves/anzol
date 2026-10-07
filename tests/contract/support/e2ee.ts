import { CompactEncrypt, SignJWT, exportJWK, generateKeyPair, importJWK, type JWK } from 'jose';

// Decifra de atributo por URL (plano "e2ee-lab"): o atributo do envelope chega como JWE compacto (ECDH-ES,
// A256GCM, P-256, `cty=JWT`) de um JWS ES256 com os claims `iss`, `aud`, `jti`, `iat`, `evt`, `app` e `data`.
// O contrato cifra e assina com o `jose` (outra implementação que não a do servidor), e monta à mão os vetores
// que o `jose` se recusa a gerar.

export const AUDIENCIA = 'anzol-lab';

/** Par EC P-256 com `kid`: a pública vai para o servidor, a privada assina (remetente) ou fica com o teste. */
export interface ParEc {
  kid: string;
  publica: JWK;
  privada: JWK;
}

export async function parEc(kid: string, crv: 'P-256' | 'P-384' = 'P-256'): Promise<ParEc> {
  const { publicKey, privateKey } = await generateKeyPair(crv === 'P-256' ? 'ES256' : 'ES384', { crv, extractable: true });
  return { kid, publica: { ...(await exportJWK(publicKey)), kid }, privada: { ...(await exportJWK(privateKey)), kid } };
}

/** A pública com o `y` trocado num bit: um ponto fora da curva. */
export function foraDaCurva(jwk: JWK): JWK {
  const y = Buffer.from(jwk.y!, 'base64url');
  y[y.length - 1] ^= 1;
  return { ...jwk, y: y.toString('base64url') };
}

/** O bloco `e2ee` do laboratório: o evento original em `$.payload`, dentro do envelope do canal de notificações. */
export function politica(signatarios: JWK[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path: '$.payload',
    audience: AUDIENCIA,
    bindings: {
      jti: '$.eventId',
      evt: '$.tipoEvento.nome',
      app: { path: '$.servico.nome', ignore_case: true },
    },
    trusted_signers: signatarios,
    ...extra,
  };
}

export interface Claims {
  iss?: string;
  aud?: string | string[];
  jti?: string;
  iat?: number;
  evt?: string;
  app?: string;
  data?: unknown;
}

/** JWS ES256 compacto com [claims], assinado pela privada do remetente. */
export async function assinar(remetente: ParEc, claims: Claims, cabecalho: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT(claims as Record<string, unknown>)
    .setProtectedHeader({ alg: 'ES256', kid: remetente.kid, typ: 'JWT', ...cabecalho })
    .sign(await importJWK(remetente.privada, 'ES256'));
}

/** JWE compacto (ECDH-ES, A256GCM) de [conteudo] para a pública de cifra do destinatário. */
export async function cifrar(destinatario: JWK, conteudo: string, cabecalho: Record<string, unknown> = {}): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(conteudo))
    .setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', kid: destinatario.kid, cty: 'JWT', ...cabecalho })
    .encrypt(await importJWK(destinatario, 'ECDH-ES'));
}

/** Cabeçalho JWE trocado por [cabecalho] (base64url de JSON), com o resto do token como está: o vetor que o `jose` não gera. */
export function comCabecalho(jwe: string, cabecalho: Record<string, unknown>): string {
  const [, ...resto] = jwe.split('.');
  return [Buffer.from(JSON.stringify(cabecalho)).toString('base64url'), ...resto].join('.');
}

export function cabecalhoDe(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
}

/** JWS sem assinatura (`alg=none`), como um atacante o montaria. */
export function semAssinatura(claims: Claims): string {
  const parte = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${parte({ alg: 'none', typ: 'JWT' })}.${parte(claims)}.`;
}

export function agora(): number {
  return Math.floor(Date.now() / 1000);
}

/** Envelope do canal de notificações: o evento original em `payload` (cifrado ou não) e os metadados em claro. */
export function envelope(id: string, payload: unknown, evento = 'PEDIDO_CRIADO', servico = 'SERVICO-EXEMPLO'): Record<string, unknown> {
  return { eventId: id, tipoEvento: { nome: evento }, servico: { nome: servico }, payload };
}

/** O JWE do laboratório: JWS do remetente com os claims que casam com [envelope], cifrado para [destinatario]. */
export async function selar(
  remetente: ParEc,
  destinatario: JWK,
  id: string,
  data: unknown,
  claims: Claims = {},
): Promise<string> {
  const jws = await assinar(remetente, {
    iss: 'remetente', aud: AUDIENCIA, jti: id, iat: agora(), evt: 'PEDIDO_CRIADO', app: 'servico-exemplo', data, ...claims,
  });
  return cifrar(destinatario, jws);
}

/** `decryption` da mensagem gravada; `null` sem `e2ee` na URL. */
export interface ResultadoDecifra {
  state: 'valid' | 'invalid' | 'unknown_kid' | 'absent';
  kid: string | null;
  signature_kid: string | null;
  reason: string | null;
  jti: string | null;
  duplicate_of: string | null;
}
