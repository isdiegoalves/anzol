import { randomUUID } from 'node:crypto';
import { envelope, parEc, politica, selar } from '../../support/e2ee.js';
import { capturar, comSegredo, expect, http, test } from '../../support/privacidade.js';

// O atributo decifrado (plano "e2ee-lab", R4) só sai para quem tem o segredo de leitura da URL: no GET da mensagem,
// na listagem e no wait. O link só-leitura (que vale sem o segredo) leva `decryption` e nunca `decrypted`; o mesmo
// vale para o evento `request.created` (specs/event/e2ee.spec.ts) e para as ferramentas do MCP.

const SEGREDO_ABERTO = 'texto-que-so-o-destinatario-ve';

async function decifrada(urls: Parameters<Parameters<typeof test>[2]>[0]['urls']) {
  const remetente = await parEc('remetente-sig-1');
  const { uuid, segredo } = await urls.proteger({ e2ee: politica([remetente.publica]) });
  const chave = (await http('POST', `/token/${uuid}/keys`, { headers: comSegredo(segredo), corpo: { kid: 'enc-v1' } }))
    .json<{ jwk: Record<string, unknown> }>().jwk;
  const id = randomUUID();
  const corpo = JSON.stringify(envelope(id, await selar(remetente, chave, id, { segredo: SEGREDO_ABERTO })));
  const rid = await capturar(uuid, '', { body: corpo, headers: { 'Content-Type': 'application/json' } });
  return { uuid, segredo, rid };
}

test('GET e listagem com o segredo trazem decrypted; sem o segredo, 401', async ({ urls }) => {
  const { uuid, segredo, rid } = await decifrada(urls);
  const msg = (await http('GET', `/token/${uuid}/request/${rid}`, { headers: comSegredo(segredo) })).json<any>();
  const lista = (await http('GET', `/token/${uuid}/requests`, { headers: comSegredo(segredo) })).json<any>();
  expect(msg.decrypted).toEqual({ segredo: SEGREDO_ABERTO });
  expect(lista.data[0].decrypted).toEqual({ segredo: SEGREDO_ABERTO });
  expect((await http('GET', `/token/${uuid}/request/${rid}`)).status).toBe(401);
});

test('link só-leitura: decryption sim, decrypted não, e o texto aberto em lugar nenhum', async ({ urls }) => {
  const { uuid, segredo, rid } = await decifrada(urls);
  const link = (await http('POST', `/token/${uuid}/request/${rid}/share`, { headers: comSegredo(segredo), corpo: {} }))
    .json<{ id: string }>();
  const res = await http('GET', `/share/${link.id}`);
  expect(res.status).toBe(200);
  expect(res.json<any>().decryption).toMatchObject({ state: 'valid', kid: 'enc-v1' });
  expect(res.json<object>()).not.toHaveProperty('decrypted');
  expect(res.texto).not.toContain(SEGREDO_ABERTO);
});
