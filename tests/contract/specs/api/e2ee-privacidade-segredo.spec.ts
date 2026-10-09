import { randomUUID } from 'node:crypto';
import type { Token } from '../../support/contrato.js';
import { envelope, parEc, politica, selar } from '../../support/e2ee.js';
import { capturar, comSegredo, expect, expect401Protegida, http, novoSegredo, test } from '../../support/privacidade.js';

// O atributo decifrado fica gravado na mensagem: sem o segredo de leitura, sairia para quem só tem a URL. Enquanto
// houver mensagem com `decrypted`, o `PUT /token/{id}` que deixaria a URL sem segredo responde 422 em `read_secret` e
// não muda nada, num `PUT` só ou depois de desligar a decifra num anterior. Apagadas as mensagens, o segredo sai.

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

async function removerSegredo(uuid: string, segredo: string) {
  return http('PUT', `/token/${uuid}`, { headers: comSegredo(segredo), corpo: { read_secret: null } });
}

function expectRecusa(res: Awaited<ReturnType<typeof http>>): void {
  expect(res.status, res.texto).toBe(422);
  expect(Object.keys(res.json<object>())).toEqual(['read_secret']);
}

/** Sem o segredo, nenhuma leitura abre; com ele, a mensagem continua com o valor decifrado. */
async function expectAindaProtegida(uuid: string, segredo: string, rid: string): Promise<void> {
  expect401Protegida(await http('GET', `/token/${uuid}/request/${rid}`), 'GET da mensagem sem segredo');
  expect401Protegida(await http('GET', `/token/${uuid}/requests`), 'listagem sem segredo');
  expect401Protegida(await http('POST', `/token/${uuid}/requests/search`, { corpo: {} }), 'busca sem segredo');
  expect401Protegida(await http('POST', `/token/${uuid}/requests/wait`, { corpo: { timeout: 0 } }), 'wait sem segredo');
  const token = (await http('GET', `/token/${uuid}`, { headers: comSegredo(segredo) })).json<Token>();
  expect(token.protected).toBe(true);
  const msg = (await http('GET', `/token/${uuid}/request/${rid}`, { headers: comSegredo(segredo) })).json<any>();
  expect(msg.decrypted).toEqual({ segredo: SEGREDO_ABERTO });
}

test('um PUT com read_secret null e sem e2ee → 422 em read_secret, e a decifra segue ligada', async ({ urls }) => {
  const { uuid, segredo, rid } = await decifrada(urls);

  expectRecusa(await removerSegredo(uuid, segredo));

  await expectAindaProtegida(uuid, segredo, rid);
  expect((await http('GET', `/token/${uuid}`, { headers: comSegredo(segredo) })).json<Token>().e2ee).not.toBeNull();
});

test('dois PUTs: desligar a decifra e depois remover o segredo → o segundo 422', async ({ urls }) => {
  const { uuid, segredo, rid } = await decifrada(urls);

  const desligada = await http('PUT', `/token/${uuid}`, { headers: comSegredo(segredo), corpo: { e2ee: null } });
  expect(desligada.status, desligada.texto).toBe(200);
  expect(desligada.json<Token>()).toMatchObject({ e2ee: null, protected: true });

  expectRecusa(await removerSegredo(uuid, segredo));

  await expectAindaProtegida(uuid, segredo, rid);
});

test('depois da recusa, quem só tem o UUID não põe um segredo próprio: 401', async ({ urls }) => {
  const { uuid, segredo, rid } = await decifrada(urls);
  expectRecusa(await removerSegredo(uuid, segredo));

  const proprio = await http('PUT', `/token/${uuid}`, { corpo: { read_secret: novoSegredo() } });

  expect401Protegida(proprio, 'PUT com segredo próprio, sem acesso');
  await expectAindaProtegida(uuid, segredo, rid);
});

test('apagadas as mensagens decifradas, o segredo sai: 200', async ({ urls }) => {
  const { uuid, segredo } = await decifrada(urls);
  expect((await http('DELETE', `/token/${uuid}/request`, { headers: comSegredo(segredo) })).status).toBe(200);

  const res = await removerSegredo(uuid, segredo);

  expect(res.status, res.texto).toBe(200);
  expect(res.json<Token>()).toMatchObject({ protected: false, e2ee: null });
});

test('mensagem com decryption e sem decrypted (recusada) não impede remover o segredo', async ({ urls }) => {
  const remetente = await parEc('remetente-sig-1');
  const { uuid, segredo } = await urls.proteger({ e2ee: politica([remetente.publica]) });
  await capturar(uuid, '', { body: JSON.stringify(envelope(randomUUID(), { em: 'claro' })), headers: { 'Content-Type': 'application/json' } });
  const lista = (await http('GET', `/token/${uuid}/requests`, { headers: comSegredo(segredo) })).json<any>();
  expect(lista.data[0].decryption.state).toBe('invalid');

  const res = await removerSegredo(uuid, segredo);

  expect(res.status, res.texto).toBe(200);
  expect(res.json<Token>().protected).toBe(false);
});
