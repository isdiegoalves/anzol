import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { assinaturaGithub } from '../../support/assinatura.js';
import { BASE_URL, CHAVES_MENSAGEM, DATA_HORA, type Mensagem } from '../../support/contrato.js';
import {
  agora, assinar, cabecalhoDe, cifrar, comCabecalho, envelope, parEc, politica, selar, semAssinatura, type ParEc,
} from '../../support/e2ee.js';
import { capturar, comSegredo, expect, http, mensagem, test, type Urls } from '../../support/privacidade.js';

// Decifra do atributo na captura (plano "e2ee-lab", R2). Com `e2ee` na URL, a mensagem grava `decryption`
// {state, kid, signature_kid, reason, jti, duplicate_of, kid_deleted_at} e, só quando válida, `decrypted` (o claim `data`); o
// `content` fica como chegou. Ordem: HMAC da URL (`hmac_failed`), atributo em JWE (`downgrade` quando exigido),
// cabeçalho permitido antes de decifrar (`alg_not_allowed`, `enc_not_allowed`, `zip_present`, `epk_off_curve`…),
// `kid` da URL (`unknown_kid`), JWS ES256 de um signatário confiável (`jws_missing`, `jws_alg_not_allowed`,
// `signer_unknown`, `signature_invalid`) e os claims contra o envelope (`aud`, `jti`, `evt`, `app`, `iat`).
// `kid_deleted_at`: com `unknown_kid` ou `decrypt_failed`, quando a URL apagou uma chave com o `kid` do JWE (a data
// da exclusão mais recente, no formato de `created_at`); `null` sem registro. A URL guarda as 20 exclusões mais novas.

interface Lab {
  uuid: string;
  segredo: string;
  remetente: ParEc;
  /** A pública da chave de cifra `enc-v1` da URL, como o JWKS a publica. */
  cifra: Record<string, unknown>;
}

async function lab(urls: Urls, extra: Record<string, unknown> = {}): Promise<Lab> {
  const remetente = await parEc('remetente-sig-1');
  const { uuid, segredo } = await urls.proteger({ e2ee: politica([remetente.publica]), ...extra });
  return { uuid, segredo, remetente, cifra: await novaChave(uuid, segredo, 'enc-v1') };
}

async function novaChave(uuid: string, segredo: string, kid: string): Promise<Record<string, unknown>> {
  const res = await http('POST', `/token/${uuid}/keys`, { headers: comSegredo(segredo), corpo: { kid } });
  expect(res.status, res.texto).toBe(201);
  return res.json<{ jwk: Record<string, unknown> }>().jwk;
}

async function entregar(l: Lab, corpo: string, headers: Record<string, string> = {}): Promise<Mensagem> {
  const rid = await capturar(l.uuid, '', { body: corpo, headers: { 'Content-Type': 'application/json', ...headers } });
  return mensagem(l.uuid, rid, comSegredo(l.segredo));
}

async function decifra(l: Lab, payload: unknown, id = randomUUID()): Promise<NonNullable<Mensagem['decryption']>> {
  const msg = await entregar(l, JSON.stringify(envelope(id, payload)));
  expect(msg.decryption).not.toBeNull();
  return msg.decryption!;
}

const DADOS = { texto: 'Olá, ação concluída 🎉', valor: 10, lista: [1, 'dois'] };

test.describe('decifra válida', () => {
  test('ida e volta: valid com os kids e o jti, decrypted == data com acento e emoji, content como chegou', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const corpo = JSON.stringify(envelope(id, await selar(l.remetente, l.cifra, id, DADOS)));

    const msg = await entregar(l, corpo);

    expect(Object.keys(msg).sort()).toEqual([...CHAVES_MENSAGEM, 'decrypted'].sort());
    expect(msg.decryption).toEqual({
      state: 'valid', kid: 'enc-v1', signature_kid: 'remetente-sig-1', reason: null, jti: id, duplicate_of: null,
      kid_deleted_at: null,
    });
    expect(msg.decrypted).toEqual(DADOS);
    expect(msg.content).toBe(corpo);
  });

  test('rotação: cifrada com a v1 e entregue depois da v2 gerada → valid com kid enc-v1', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const jwe = await selar(l.remetente, l.cifra, id, DADOS);
    await novaChave(l.uuid, l.segredo, 'enc-v2');

    expect(await decifra(l, jwe, id)).toMatchObject({ state: 'valid', kid: 'enc-v1' });
  });

  test('reentrega idêntica: as duas valid, a segunda com duplicate_of da primeira', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const corpo = JSON.stringify(envelope(id, await selar(l.remetente, l.cifra, id, DADOS)));

    const primeira = await entregar(l, corpo);
    const segunda = await entregar(l, corpo);

    expect(primeira.decryption).toMatchObject({ state: 'valid', duplicate_of: null });
    expect(segunda.decryption).toMatchObject({ state: 'valid', duplicate_of: primeira.uuid });
  });

  test('app servico-exemplo no JWS e SERVICO-EXEMPLO no envelope (ignore_case) → valid; evt com outra caixa → evt_mismatch', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    expect(await decifra(l, await selar(l.remetente, l.cifra, id, DADOS, { app: 'servico-exemplo' }), id)).toMatchObject({ state: 'valid' });
    const outro = randomUUID();
    expect(await decifra(l, await selar(l.remetente, l.cifra, outro, DADOS, { evt: 'pedido_criado' }), outro))
      .toMatchObject({ state: 'invalid', reason: 'evt_mismatch' });
  });

  test('URL sem e2ee: decryption null e sem decrypted', async ({ urls }) => {
    const token = await urls.abrir();
    const rid = await capturar(token.uuid, '', { body: JSON.stringify({ payload: 'a.b.c.d.e' }) });
    const msg = await mensagem(token.uuid, rid);
    expect(msg.decryption).toBeNull();
    expect(msg).not.toHaveProperty('decrypted');
  });
});

test.describe('forja, troca e downgrade', () => {
  test('JWE sem JWS dentro (o canal cifra com a JWK pública) → jws_missing', async ({ urls }) => {
    const l = await lab(urls);
    expect(await decifra(l, await cifrar(l.cifra, JSON.stringify(DADOS)))).toMatchObject({ state: 'invalid', reason: 'jws_missing' });
  });

  test('JWS de chave fora dos confiáveis → signer_unknown; kid confiável com outra chave → signature_invalid', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const canal = await parEc('canal');
    expect(await decifra(l, await selar(canal, l.cifra, id, DADOS), id)).toMatchObject({ reason: 'signer_unknown' });
    const impostor = await parEc('remetente-sig-1');
    expect(await decifra(l, await selar(impostor, l.cifra, id, DADOS), id))
      .toMatchObject({ state: 'invalid', reason: 'signature_invalid', signature_kid: 'remetente-sig-1' });
  });

  test('ciphertext de M1 colado no envelope de M2 → jti_mismatch, e nada aberto', async ({ urls }) => {
    const l = await lab(urls);
    const m1 = randomUUID();
    const jwe = await selar(l.remetente, l.cifra, m1, DADOS);
    const msg = await entregar(l, JSON.stringify(envelope(randomUUID(), jwe)));
    expect(msg.decryption).toMatchObject({ state: 'invalid', reason: 'jti_mismatch', jti: m1 });
    expect(msg).not.toHaveProperty('decrypted');
  });

  test('texto em claro com a decifra exigida → downgrade; sem exigir → absent', async ({ urls }) => {
    const l = await lab(urls);
    expect(await decifra(l, DADOS)).toMatchObject({ state: 'invalid', reason: 'downgrade' });
    const livre = await lab(urls, { e2ee: politica([(await parEc('sig')).publica], { required: false }) });
    expect(await decifra(livre, DADOS)).toEqual({
      state: 'absent', kid: null, signature_kid: null, reason: null, jti: null, duplicate_of: null,
      kid_deleted_at: null,
    });
  });

  test('1 byte do corpo alterado com HMAC na URL → assinatura invalid e decifra hmac_failed', async ({ urls }) => {
    const segredoHmac = 'segredo-hmac-do-lab';
    const l = await lab(urls, { signature: { provider: 'github', secret: segredoHmac } });
    const id = randomUUID();
    const corpo = JSON.stringify(envelope(id, await selar(l.remetente, l.cifra, id, DADOS)));
    const alterado = corpo.replace('SERVICO-EXEMPLO', 'SERVICO-EXEMPLA');

    const msg = await entregar(l, alterado, { 'X-Hub-Signature-256': assinaturaGithub(segredoHmac, corpo) });

    expect(msg.signature).toMatchObject({ valid: false });
    expect(msg.decryption).toMatchObject({ state: 'invalid', reason: 'hmac_failed' });
    const integro = await entregar(l, corpo, { 'X-Hub-Signature-256': assinaturaGithub(segredoHmac, corpo) });
    expect(integro.decryption).toMatchObject({ state: 'valid' });
  });
});

test.describe('cabeçalho JWE fora da lista permitida', () => {
  test('kid que a URL nunca teve → unknown_kid, com o kid e kid_deleted_at null', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const outra = await parEc('enc-v9');
    expect(await decifra(l, await selar(l.remetente, outra.publica, id, DADOS), id))
      .toMatchObject({ state: 'unknown_kid', kid: 'enc-v9', kid_deleted_at: null });
  });

  test('alg ECDH-ES+A256KW, enc A128CBC-HS256 e zip DEF → o motivo de cada um', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const jws = await assinar(l.remetente, { aud: 'anzol-lab', jti: id, iat: agora(), evt: 'PEDIDO_CRIADO', app: 'servico-exemplo', data: DADOS });
    expect(await decifra(l, await cifrar(l.cifra, jws, { alg: 'ECDH-ES+A256KW' }), id)).toMatchObject({ reason: 'alg_not_allowed' });
    expect(await decifra(l, await cifrar(l.cifra, jws, { enc: 'A128CBC-HS256' }), id)).toMatchObject({ reason: 'enc_not_allowed' });
    const jwe = await cifrar(l.cifra, jws);
    expect(await decifra(l, comCabecalho(jwe, { ...cabecalhoDe(jwe), zip: 'DEF' }), id)).toMatchObject({ reason: 'zip_present' });
  });

  test('epk fora da curva → epk_off_curve (antes de decifrar)', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const jwe = await selar(l.remetente, l.cifra, id, DADOS);
    const cabecalho = cabecalhoDe(jwe) as { epk: { y: string } };
    const y = Buffer.from(cabecalho.epk.y, 'base64url');
    y[y.length - 1] ^= 1;
    const adulterado = comCabecalho(jwe, { ...cabecalho, epk: { ...cabecalho.epk, y: y.toString('base64url') } });
    expect(await decifra(l, adulterado, id)).toMatchObject({ state: 'invalid', reason: 'epk_off_curve' });
  });

  test('JWE acima de 256 KiB → too_large', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const jwe = await selar(l.remetente, l.cifra, id, { grande: 'x'.repeat(200 * 1024) });
    expect(await decifra(l, jwe, id)).toMatchObject({ reason: 'too_large' });
  });
});

test.describe('chave de cifra apagada', () => {
  const apagar = async (l: Lab, kid: string) => {
    const res = await http('DELETE', `/token/${l.uuid}/keys/${kid}`, { headers: comSegredo(l.segredo) });
    expect(res.status, res.texto).toBe(204);
  };

  test('cifrada para a chave que a URL apagou → unknown_kid com kid_deleted_at', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const jwe = await selar(l.remetente, l.cifra, id, DADOS);
    await apagar(l, 'enc-v1');

    const resultado = await decifra(l, jwe, id);

    expect(resultado).toMatchObject({ state: 'unknown_kid', kid: 'enc-v1' });
    expect(resultado.kid_deleted_at).toMatch(DATA_HORA);
  });

  test('chave apagada e recriada com o mesmo kid → decrypt_failed com kid_deleted_at; a cifrada para a nova abre', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const antiga = await selar(l.remetente, l.cifra, id, DADOS);
    await apagar(l, 'enc-v1');
    const nova = await novaChave(l.uuid, l.segredo, 'enc-v1');

    const recusada = await decifra(l, antiga, id);
    const outro = randomUUID();
    const aberta = await decifra(l, await selar(l.remetente, nova, outro, DADOS), outro);

    expect(recusada).toMatchObject({ state: 'invalid', reason: 'decrypt_failed', kid: 'enc-v1' });
    expect(recusada.kid_deleted_at).toMatch(DATA_HORA);
    expect(aberta).toMatchObject({ state: 'valid', kid: 'enc-v1', kid_deleted_at: null });
  });

  test('outra chave apagada não muda o unknown_kid de um kid que a URL nunca teve', async ({ urls }) => {
    const l = await lab(urls);
    await novaChave(l.uuid, l.segredo, 'enc-v2');
    await apagar(l, 'enc-v2');
    const id = randomUUID();

    expect(await decifra(l, await selar(l.remetente, (await parEc('enc-v9')).publica, id, DADOS), id))
      .toMatchObject({ state: 'unknown_kid', kid: 'enc-v9', kid_deleted_at: null });
  });

  test('a URL lembra as 20 exclusões mais novas: a 21ª mais antiga sai do registro', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const jwe = await selar(l.remetente, l.cifra, id, DADOS);
    await apagar(l, 'enc-v1');
    for (let i = 0; i < 20; i++) {
      await novaChave(l.uuid, l.segredo, `rot-${i}`);
      await apagar(l, `rot-${i}`);
    }

    expect(await decifra(l, jwe, id)).toMatchObject({ state: 'unknown_kid', kid: 'enc-v1', kid_deleted_at: null });
  });
});

test.describe('JWS e claims', () => {
  test('JWS alg none ou HS256 → jws_alg_not_allowed', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    const claims = { aud: 'anzol-lab', jti: id, iat: agora(), evt: 'PEDIDO_CRIADO', app: 'servico-exemplo', data: DADOS };
    expect(await decifra(l, await cifrar(l.cifra, semAssinatura(claims)), id)).toMatchObject({ reason: 'jws_alg_not_allowed' });
    const hs256 = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256', kid: 'remetente-sig-1' }).sign(new Uint8Array(32).fill(7));
    expect(await decifra(l, await cifrar(l.cifra, hs256), id)).toMatchObject({ reason: 'jws_alg_not_allowed' });
  });

  test('iat de 13 horas atrás → iat_outside_window; aud de outro destinatário → aud_mismatch', async ({ urls }) => {
    const l = await lab(urls);
    const id = randomUUID();
    expect(await decifra(l, await selar(l.remetente, l.cifra, id, DADOS, { iat: agora() - 13 * 3600 }), id))
      .toMatchObject({ reason: 'iat_outside_window' });
    expect(await decifra(l, await selar(l.remetente, l.cifra, id, DADOS, { aud: 'outro' }), id)).toMatchObject({ reason: 'aud_mismatch' });
  });
});

test('o JWKS da URL serve para cifrar: o remetente busca a pública e a mensagem abre', async ({ urls }) => {
  const l = await lab(urls);
  const jwks = (await (await fetch(new URL(`/token/${l.uuid}/jwks.json`, BASE_URL))).json()) as { keys: Record<string, unknown>[] };
  const id = randomUUID();
  expect(await decifra(l, await selar(l.remetente, jwks.keys[0], id, DADOS), id)).toMatchObject({ state: 'valid' });
});
