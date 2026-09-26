import { disparar, enviarEGuardar, expect, listar, test } from '../../support/contrato.js';
import { expectFalhas, lerRegras, testarRegra, type Regra, type ResultadoTesteDeRegra } from '../../support/regras.js';

// `POST /token/{id}/rules/test` (CA-8): uma regra no corpo → quais das mensagens gravadas (as 500
// mais recentes) ela casaria (`matches: [{uuid, seq}]`) e quais não, com as condições que
// falharam (`misses: [{uuid, seq, failed}]`). Não salva a regra nem grava mensagem. A ordem das
// listas não faz parte do contrato.

async function testar(request: Parameters<typeof testarRegra>[0], tokenId: string, regra: Regra): Promise<ResultadoTesteDeRegra> {
  const res = await testarRegra(request, tokenId, regra);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as ResultadoTesteDeRegra;
}

const porUuid = <T extends { uuid: string }>(itens: T[]): T[] => [...itens].sort((a, b) => a.uuid.localeCompare(b.uuid));

test.describe('rules/test', () => {
  test('separa as mensagens gravadas que casariam das que não, com o motivo', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const json = { 'Content-Type': 'application/json' };
    const { msg: pago } = await enviarEGuardar(request, token.uuid, '/pagamentos', { method: 'POST', headers: json, data: Buffer.from('{"status":"pago"}') });
    const { msg: pendente } = await enviarEGuardar(request, token.uuid, '/pagamentos', { method: 'POST', headers: json, data: Buffer.from('{"status":"pendente"}') });
    const { msg: outra } = await enviarEGuardar(request, token.uuid, '/outra', { method: 'GET' });

    const resultado = await testar(request, token.uuid, {
      name: 'pago',
      match: { method: ['POST'], path: { equals: '/pagamentos' }, body: [{ jsonPath: { path: '$.status', equals: 'pago' } }] },
    });

    expect(Object.keys(resultado).sort()).toEqual(['matches', 'misses']);
    expect(resultado.matches).toEqual([{ uuid: pago.uuid, seq: pago.seq }]);
    expect(porUuid(resultado.misses).map(({ uuid, seq }) => ({ uuid, seq })))
      .toEqual(porUuid([{ uuid: pendente.uuid, seq: pendente.seq }, { uuid: outra.uuid, seq: outra.seq }]));
    for (const miss of resultado.misses) expect(Object.keys(miss).sort()).toEqual(['failed', 'seq', 'uuid']);

    const missPendente = resultado.misses.find((m) => m.uuid === pendente.uuid)!;
    expect(missPendente.failed).toHaveLength(1);
    expectFalhas(missPendente.failed, [/^body \$\.status\b.*"?pago"?.*"?pendente"?/]);

    const missOutra = resultado.misses.find((m) => m.uuid === outra.uuid)!;
    // Método, caminho e corpo (GET sem corpo não tem $.status).
    expect(missOutra.failed).toHaveLength(3);
    expectFalhas(missOutra.failed, [/^method\b.*POST.*GET/, /^path\b.*\/pagamentos.*\/outra/, /\$\.status/]);
  });

  test('cabeçalho e query das mensagens gravadas também contam', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg: assinada } = await enviarEGuardar(request, token.uuid, '?tipo=pix', { method: 'POST', headers: { 'X-Signature': 's' } });
    const { msg: semAssinatura } = await enviarEGuardar(request, token.uuid, '?tipo=pix', { method: 'POST' });
    const { msg: boleto } = await enviarEGuardar(request, token.uuid, '?tipo=boleto', { method: 'POST', headers: { 'X-Signature': 's' } });

    const resultado = await testar(request, token.uuid, {
      name: 'assinado pix',
      match: { headers: { 'X-Signature': { present: true } }, query: { tipo: { equals: 'pix' } } },
    });
    expect(resultado.matches).toEqual([{ uuid: assinada.uuid, seq: assinada.seq }]);
    expect(resultado.misses.map((m) => m.uuid).sort()).toEqual([semAssinatura.uuid, boleto.uuid].sort());
    expectFalhas(resultado.misses.find((m) => m.uuid === semAssinatura.uuid)!.failed, [/^header x-signature\b.*absent/i]);
    expectFalhas(resultado.misses.find((m) => m.uuid === boleto.uuid)!.failed, [/^query tipo\b.*pix.*boleto/]);
  });

  test('não salva a regra nem grava mensagem; URL sem mensagens → listas vazias', async ({ request, tokens }) => {
    const token = await tokens.criar();
    expect(await testar(request, token.uuid, { name: 'qualquer' })).toEqual({ matches: [], misses: [] });
    expect(await lerRegras(request, token.uuid)).toEqual([]);
    expect((await listar(request, token.uuid)).total).toBe(0);
  });

  test('considera só as 500 mensagens mais recentes', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const ids = await disparar(request, token.uuid, 501, { paralelas: 20 });
    // Lotes paralelos: a mais antiga é a primeira da listagem `oldest`, não necessariamente ids[0].
    const [maisAntiga] = (await listar(request, token.uuid, 'per_page=1&sorting=oldest')).data;
    const resultado = await testar(request, token.uuid, { name: 'GET', match: { method: ['GET'] } });
    expect(resultado.misses).toEqual([]);
    expect(resultado.matches).toHaveLength(500);
    const uuids = new Set(resultado.matches.map((m) => m.uuid));
    expect(uuids.size).toBe(500);
    expect(uuids.has(maisAntiga.uuid)).toBe(false);
    for (const id of ids) if (id !== maisAntiga.uuid) expect(uuids.has(id)).toBe(true);
  });

  test('regra inválida → 422 com a chave da condição (sem exigir o prefixo de índice)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const res = await testarRegra(request, token.uuid, { name: 'ruim', match: { path: { regex: '([a-z' } } });
    expect(res.status()).toBe(422);
    const corpo = (await res.json()) as Record<string, string[]>;
    const chave = Object.keys(corpo).find((k) => /(^|\.)match\.path\.regex$/.test(k));
    expect(chave, JSON.stringify(corpo)).toBeDefined();
    expect(corpo[chave!]).toEqual(['The regex is invalid.']);
  });
});
