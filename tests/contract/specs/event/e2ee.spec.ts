import { randomUUID } from 'node:crypto';
import { envelope, parEc, politica, selar } from '../../support/e2ee.js';
import { assinar } from '../../support/eventos.js';
import { capturar, comSegredo, expect, http, test } from '../../support/privacidade.js';

// Evento `request.created` de uma mensagem decifrada (plano "e2ee-lab", R4): leva `decryption` e nunca `decrypted`;
// o texto aberto só sai no GET da mensagem, com o segredo de leitura.

test('evento da mensagem decifrada: decryption valid, sem decrypted', async ({ urls }) => {
  const remetente = await parEc('remetente-sig-1');
  const { uuid, segredo } = await urls.proteger({ e2ee: politica([remetente.publica]) });
  const chave = (await http('POST', `/token/${uuid}/keys`, { headers: comSegredo(segredo), corpo: { kid: 'enc-v1' } }))
    .json<{ jwk: Record<string, unknown> }>().jwk;
  const canal = await assinar(uuid, comSegredo(segredo));
  try {
    const id = randomUUID();
    const corpo = JSON.stringify(envelope(id, await selar(remetente, chave, id, { segredo: 'aberto-no-evento' })));
    await capturar(uuid, '', { body: corpo, headers: { 'Content-Type': 'application/json' } });

    const evento = await canal.proximo();

    expect(evento.request).toMatchObject({ decryption: { state: 'valid', kid: 'enc-v1', jti: id, aud: ['anzol-lab'] } });
    expect(evento.request).not.toHaveProperty('decrypted');
    expect(JSON.stringify(evento)).not.toContain('aberto-no-evento');
  } finally {
    await canal.fechar();
  }
});
