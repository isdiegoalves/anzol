import {
  JsonWebKey,
  KeyObject,
  createCipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';

// Mensagem cifrada como o remetente do laboratório a manda: o atributo do envelope é um JWE compacto (ECDH-ES,
// A256GCM, `cty=JWT`) de um JWS ES256 com `aud`, `jti`, `evt`, `app`, `iat` e `data`. Montado com o `node:crypto`,
// sem dependência nova no frontend; o contrato (`tests/contract`) prova a interoperabilidade com o `jose`.

export const AUDIENCIA = 'anzol-lab';

/** Par EC P-256 de quem assina: a pública (com `kid`) vai para `trusted_signers`. */
export interface Signatario {
  kid: string;
  publica: JsonWebKey;
  privada: KeyObject;
}

export function signatario(kid: string): Signatario {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { kid, publica: { ...publicKey.export({ format: 'jwk' }), kid }, privada: privateKey };
}

/** A política do laboratório: o evento original em `$.payload`, dentro do envelope do canal de notificações. */
export function politica(signatarios: JsonWebKey[]): Record<string, unknown> {
  return {
    path: '$.payload',
    required: true,
    audience: AUDIENCIA,
    bindings: {
      jti: '$.eventId',
      evt: '$.tipoEvento.nome',
      app: { path: '$.servico.nome', ignore_case: true },
    },
    max_age_seconds: 43200,
    trusted_signers: signatarios,
  };
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url');

function jws(quem: Signatario, claims: Record<string, unknown>): string {
  const entrada = `${b64(JSON.stringify({ alg: 'ES256', kid: quem.kid, typ: 'JWT' }))}.${b64(JSON.stringify(claims))}`;
  const assinatura = sign('sha256', Buffer.from(entrada), {
    key: quem.privada,
    dsaEncoding: 'ieee-p1363',
  });
  return `${entrada}.${b64(assinatura)}`;
}

function u32(valor: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(valor);
  return buffer;
}

/** Concat KDF (RFC 7518 §4.6.2) do acordo direto: `AlgorithmID` é o `enc`, sem `apu` nem `apv`. */
function chaveDerivada(segredo: Buffer, enc: string): Buffer {
  const comTamanho = (dado: Buffer) => Buffer.concat([u32(dado.length), dado]);
  const outros = Buffer.concat([
    comTamanho(Buffer.from(enc)),
    comTamanho(Buffer.alloc(0)),
    comTamanho(Buffer.alloc(0)),
    u32(256),
  ]);
  return createHash('sha256')
    .update(Buffer.concat([u32(1), segredo, outros]))
    .digest();
}

/** JWE compacto (ECDH-ES, A256GCM) de `conteudo` para a JWK pública de cifra `destino`. */
function jwe(destino: JsonWebKey, conteudo: string): string {
  const efemera = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const segredo = diffieHellman({
    privateKey: efemera.privateKey,
    publicKey: createPublicKey({ key: destino, format: 'jwk' }),
  });
  const { kty, crv, x, y } = efemera.publicKey.export({ format: 'jwk' });
  const cabecalho = b64(
    JSON.stringify({
      alg: 'ECDH-ES',
      enc: 'A256GCM',
      kid: destino['kid'],
      cty: 'JWT',
      epk: { kty, crv, x, y },
    }),
  );
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chaveDerivada(segredo, 'A256GCM'), iv);
  cifra.setAAD(Buffer.from(cabecalho, 'ascii'));
  const texto = Buffer.concat([cifra.update(conteudo, 'utf8'), cifra.final()]);
  return `${cabecalho}..${b64(iv)}.${b64(texto)}.${b64(cifra.getAuthTag())}`;
}

/**
 * Corpo do webhook: o envelope em claro e o `data` assinado por `quem`, cifrado para `destino`. Os claims casam com
 * o envelope (o `app` em minúsculas, como no laboratório).
 */
export function envelopeCifrado(
  quem: Signatario,
  destino: JsonWebKey,
  id: string,
  data: unknown,
): string {
  const claims = {
    iss: 'remetente',
    aud: AUDIENCIA,
    jti: id,
    iat: Math.floor(Date.now() / 1000),
    evt: 'PEDIDO_CRIADO',
    app: 'servico-exemplo',
    data,
  };
  return JSON.stringify({
    eventId: id,
    tipoEvento: { nome: 'PEDIDO_CRIADO' },
    servico: { nome: 'SERVICO-EXEMPLO' },
    payload: jwe(destino, jws(quem, claims)),
  });
}
