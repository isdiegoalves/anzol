import { JSON_ACCEPT, enviarEGuardar, expect, listar, test } from '../../support/contrato.js';
import { esperar } from '../../support/espera.js';

// Patamar, fatia D1, DX-14 (`.docs-arquivo/patamar/api-defeitos.md`, item 4): o roteiro sem corrida de um teste de CI
// é ler a posição da fila ANTES do disparo e esperar a partir dela. A API já dá o que falta, e estes testes são a
// guarda disso (verdes hoje): o cursor é o `seq` da mensagem mais nova em `GET /token/{id}/requests?sorting=newest&
// per_page=1` (lista vazia = cursor 0), e `POST …/requests/wait` com `after: <cursor>` só vê o que chegou depois. O
// comando `anzol cursor` do CLI (tests/cli/cursor.test.mjs) imprime esse número.

async function cursor(request: Parameters<typeof listar>[0], tokenId: string): Promise<number> {
  const { data } = await listar(request, tokenId, 'sorting=newest&per_page=1');
  return data[0]?.seq ?? 0;
}

test.describe('cursor para o wait-for (DX-14)', () => {
  test('URL sem mensagens: cursor 0, e a espera a partir dele vê a primeira mensagem', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    expect(await cursor(request, t)).toBe(0);
    const { msg } = await enviarEGuardar(request, t, '/primeira', { method: 'POST' });
    const { resultado } = await esperar(request, t, { after: 0, timeout: 0 });
    expect(resultado.requests.map((m) => m.uuid)).toEqual([msg.uuid]);
  });

  test('cursor lido antes do disparo: a espera começa depois dele e acha só o que chegou depois', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const { msg: antiga } = await enviarEGuardar(request, t, '/pedidos', { method: 'POST' });
    const lido = await cursor(request, t);
    expect(lido).toBe(antiga.seq);

    // O disparo chega ANTES de a espera começar: com o cursor, ela o acha na hora; a antiga, igual a ele, não conta.
    const { msg: nova } = await enviarEGuardar(request, t, '/pedidos', { method: 'POST' });
    const { resultado, ms } = await esperar(request, t, { match: { path: { equals: '/pedidos' } }, after: lido, timeout: 20_000 });
    expect(resultado.matched).toBe(true);
    expect(resultado.requests.map((m) => m.uuid)).toEqual([nova.uuid]);
    expect(ms).toBeLessThan(3_000);
  });

  test('o cursor continua valendo depois de a mensagem mais nova ser apagada', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await enviarEGuardar(request, t, '/a');
    const { msg: apagada } = await enviarEGuardar(request, t, '/b');
    const lido = await cursor(request, t);
    expect((await request.delete(`/token/${t}/request/${apagada.uuid}`, { headers: JSON_ACCEPT })).status()).toBeLessThan(300);
    // Relido, o cursor volta para a anterior; os dois servem, porque o seq não é reaproveitado.
    const relido = await cursor(request, t);
    expect(relido).toBeLessThan(lido);

    const { msg: nova } = await enviarEGuardar(request, t, '/c');
    expect(nova.seq).toBeGreaterThan(lido);
    for (const after of [lido, relido]) {
      const { resultado } = await esperar(request, t, { after, timeout: 0 });
      expect(resultado.requests.map((m) => m.uuid), `after ${after}`).toEqual([nova.uuid]);
    }
  });
});
