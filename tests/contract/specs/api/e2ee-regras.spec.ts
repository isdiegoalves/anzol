import { randomUUID } from 'node:crypto';
import { cifrar, envelope, parEc, politica, selar } from '../../support/e2ee.js';
import { BASE_URL } from '../../support/contrato.js';
import { comSegredo, expect, http, test } from '../../support/privacidade.js';

// Regras com `match.decryption` (plano "e2ee-lab", R3): `valid`, `invalid`, `unknown_kid` ou `absent`, comparado ao
// `decryption.state` gravado. O Anzol não muda o status sozinho: o laboratório do canal de notificações responde 500 ao
// `kid` desconhecido (o job retenta e depois manda à DLQ), 400 à cifra inválida (não retenta) e 200 ao resto; nunca
// 503, que abriria o circuit breaker do host. Sem `e2ee` na URL, a condição falha com "got not configured".

const REGRAS = [
  { name: 'kid desconhecido', match: { decryption: 'unknown_kid' }, response: { status: 500 } },
  { name: 'cifra inválida', match: { decryption: 'invalid' }, response: { status: 400 } },
];

test('regras do laboratório: valid → 200, unknown_kid → 500, downgrade e forja → 400; nunca 503', async ({ urls }) => {
  const remetente = await parEc('remetente-sig-1');
  const { uuid, segredo } = await urls.proteger({ e2ee: politica([remetente.publica]) });
  const chave = (await http('POST', `/token/${uuid}/keys`, { headers: comSegredo(segredo), corpo: { kid: 'enc-v1' } }))
    .json<{ jwk: Record<string, unknown> }>().jwk;
  expect((await http('PUT', `/token/${uuid}/rules`, { headers: comSegredo(segredo), corpo: REGRAS })).status).toBe(200);
  const entregar = async (payload: unknown, id = randomUUID()) =>
    (await fetch(new URL(`/${uuid}`, BASE_URL), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope(id, payload)),
    })).status;

  const id = randomUUID();
  const status = [
    await entregar(await selar(remetente, chave, id, { ok: true }), id),
    await entregar(await selar(remetente, (await parEc('enc-v9')).publica, id, { ok: true }), id),
    await entregar({ ok: true }),
    await entregar(await cifrar(chave, JSON.stringify({ ok: true }))),
  ];

  expect(status).toEqual([200, 500, 400, 400]);
  expect(status).not.toContain(503);
});

test('near_miss: frase com o estado e o motivo, chave match.decryption', async ({ urls }) => {
  const remetente = await parEc('remetente-sig-1');
  const { uuid, segredo } = await urls.proteger({ e2ee: politica([remetente.publica]) });
  await http('PUT', `/token/${uuid}/rules`, {
    headers: comSegredo(segredo), corpo: [{ name: 'só válidas', match: { decryption: 'valid' }, response: { status: 202 } }],
  });
  const res = await fetch(new URL(`/${uuid}`, BASE_URL), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope(randomUUID(), { ok: true })),
  });
  const rid = res.headers.get('x-request-id')!;
  const msg = (await http('GET', `/token/${uuid}/request/${rid}`, { headers: comSegredo(segredo) })).json<any>();
  expect(msg.near_miss.failed).toEqual(['decryption: expected valid, got invalid (downgrade)']);
  expect(msg.near_miss.conditions).toEqual(['match.decryption']);
});

test('URL sem e2ee: match.decryption não casa ("got not configured"); valor desconhecido → 422', async ({ urls }) => {
  const token = await urls.abrir();
  expect((await http('PUT', `/token/${token.uuid}/rules`, { corpo: REGRAS })).status).toBe(200);
  const res = await fetch(new URL(`/${token.uuid}`, BASE_URL), { method: 'POST', body: '{}' });
  expect(res.status).toBe(200);
  const msg = (await http('GET', `/token/${token.uuid}/request/${res.headers.get('x-request-id')}`)).json<any>();
  expect(msg.near_miss.failed[0]).toBe('decryption: expected unknown_kid, got not configured');

  const invalido = await http('PUT', `/token/${token.uuid}/rules`, { corpo: [{ match: { decryption: 'ok' } }] });
  expect(invalido.status).toBe(422);
  expect(invalido.json<object>()).toHaveProperty(['0.match.decryption']);
});
