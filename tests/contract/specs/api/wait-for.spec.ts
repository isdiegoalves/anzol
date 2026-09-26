import { buscarMensagem, enviarEGuardar, espera, expect, JSON_ACCEPT, test, type Mensagem } from '../../support/contrato.js';
import { expectFalhas, type MatchRegra } from '../../support/regras.js';
import { esperar } from '../../support/espera.js';

// `POST /token/{id}/requests/wait` (feature `wait-for`, CA-1 a CA-4 e URL apagada): long-poll que
// responde assim que `count` mensagens com `seq` > `after` casam o `match` (as de menor `seq`, em
// ordem crescente), ou quando `timeout` ms acabam, com o `near_miss` da mensagem avaliada mais
// próxima de casar. As frases de `failed` são as do near miss das regras: o contrato casa o
// conteúdo (alvo, esperado e recebido), como em `regras-mensagem.spec.ts`.

const JSON_CT = { 'Content-Type': 'application/json' };

/** A regra "pagamento pix" de `regras-mensagem.spec.ts`, como `match` da espera. */
const PAGAMENTO: MatchRegra = {
  method: ['POST'],
  path: { equals: '/pagamentos' },
  headers: { 'X-Signature': { present: true } },
  body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
};

function corpoJson(valor: unknown): Buffer {
  return Buffer.from(JSON.stringify(valor));
}

const uuids = (msgs: Mensagem[]): string[] => msgs.map((m) => m.uuid);

test.describe('wait-for: histórico (CA-1)', () => {
  test('mensagem já gravada que casa → matched=true na hora, com a mensagem completa', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await enviarEGuardar(request, token.uuid, '/outra', { method: 'GET' });
    const { msg } = await enviarEGuardar(request, token.uuid, '/pagamentos', {
      method: 'POST', headers: { ...JSON_CT, 'X-Signature': 'abc' }, data: corpoJson({ status: 'pago' }),
    });

    const { resultado, ms } = await esperar(request, token.uuid, { match: PAGAMENTO, timeout: 20_000 });

    expect(ms, 'o histórico basta: não espera o prazo').toBeLessThan(3_000);
    expect(resultado.matched).toBe(true);
    expect(resultado.count).toBe(1);
    expect(resultado.near_miss).toBeNull();
    // Mensagem completa, como o GET /token/{id}/request/{id} a devolve.
    expect(resultado.requests).toEqual([msg]);
    expect(resultado.requests[0]).toEqual(await buscarMensagem(request, token.uuid, msg.uuid));
  });

  test('sem match (e com match {}) casa qualquer requisição: a de menor seq', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg: primeira } = await enviarEGuardar(request, token.uuid, '/a', { method: 'DELETE' });
    await enviarEGuardar(request, token.uuid, '/b', { method: 'POST', data: Buffer.from('x') });

    const semMatch = await esperar(request, token.uuid, { timeout: 0 });
    expect(semMatch.resultado).toMatchObject({ matched: true, count: 1, near_miss: null });
    expect(uuids(semMatch.resultado.requests)).toEqual([primeira.uuid]);

    const vazio = await esperar(request, token.uuid, { match: {}, timeout: 0 });
    expect(uuids(vazio.resultado.requests)).toEqual([primeira.uuid]);
  });

  test('mais mensagens que o count no histórico → as count de menor seq, em ordem crescente', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const msgs: Mensagem[] = [];
    for (let i = 1; i <= 5; i++) {
      msgs.push((await enviarEGuardar(request, token.uuid, `/item/${i}`, { method: 'POST' })).msg);
      await enviarEGuardar(request, token.uuid, `/ruido/${i}`, { method: 'POST' });
    }
    const { resultado } = await esperar(request, token.uuid, { match: { path: { prefix: '/item' } }, count: 3, timeout: 0 });
    expect(resultado).toMatchObject({ matched: true, count: 3, near_miss: null });
    expect(uuids(resultado.requests)).toEqual(uuids(msgs.slice(0, 3)));
  });
});

test.describe('wait-for: mensagem que chega durante a espera (CA-2)', () => {
  test('a chamada volta logo depois que a mensagem chega, bem antes do prazo', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await enviarEGuardar(request, token.uuid, '/antes', { method: 'POST' });
    const pendente = esperar(request, token.uuid, { match: { method: ['PUT'], path: { equals: '/chegou' } }, timeout: 20_000 });

    await espera(1_000);
    await enviarEGuardar(request, token.uuid, '/chegou', { method: 'POST' }); // não casa: método
    const enviadaEm = Date.now();
    const { msg } = await enviarEGuardar(request, token.uuid, '/chegou', {
      method: 'PUT', headers: JSON_CT, data: corpoJson({ ok: true }),
    });

    const { resultado, ms, chegou } = await pendente;
    expect(resultado).toMatchObject({ matched: true, count: 1, near_miss: null });
    expect(resultado.requests).toEqual([msg]);
    expect(ms, 'esperou até a mensagem chegar').toBeGreaterThanOrEqual(900);
    expect(chegou - enviadaEm, 'respondeu logo depois da mensagem').toBeLessThan(3_000);
    expect(ms, 'bem antes do prazo de 20 s').toBeLessThan(10_000);
  });

  test('nenhuma mensagem se perde entre assinar as novas e varrer o histórico (15 corridas)', async ({ request, tokens }) => {
    test.setTimeout(120_000);
    const token = await tokens.criar();
    for (let i = 0; i < 15; i++) {
      const caminho = `/corrida/${i}`;
      // A espera e o webhook saem juntos: a mensagem cai antes, durante ou depois da montagem da espera.
      const [{ resultado }, res] = await Promise.all([
        esperar(request, token.uuid, { match: { path: { equals: caminho } }, timeout: 5_000 }),
        espera(i % 5 * 10).then(() => request.fetch(`/${token.uuid}${caminho}`, { method: 'POST' })),
      ]);
      expect(res.status()).toBe(200);
      expect(resultado.matched, `corrida ${i}: a mensagem ${res.headers()['x-request-id']} se perdeu`).toBe(true);
      expect(uuids(resultado.requests)).toEqual([res.headers()['x-request-id']]);
    }
  });
});

test.describe('wait-for: count e after (CA-3)', () => {
  test('count=3 com mensagens chegando uma a uma → volta só com a 3ª, em ordem de seq; after exclui as antigas', async ({ request, tokens }) => {
    const token = await tokens.criar();
    // Já gravada e casaria: fica de fora pelo after.
    const { msg: antiga } = await enviarEGuardar(request, token.uuid, '/item/0', { method: 'POST' });

    let respondeu = false;
    const pendente = esperar(request, token.uuid, {
      match: { path: { prefix: '/item' } }, after: antiga.seq, count: 3, timeout: 20_000,
    }).then((r) => {
      respondeu = true;
      return r;
    });

    await espera(500);
    const { msg: m1 } = await enviarEGuardar(request, token.uuid, '/item/1', { method: 'POST' });
    await espera(400);
    await enviarEGuardar(request, token.uuid, '/outro', { method: 'POST' });
    const { msg: m2 } = await enviarEGuardar(request, token.uuid, '/item/2', { method: 'POST' });
    await espera(1_000);
    expect(respondeu, 'respondeu antes da 3ª mensagem').toBe(false);

    const antesDaTerceira = Date.now();
    const { msg: m3 } = await enviarEGuardar(request, token.uuid, '/item/3', { method: 'POST' });
    const { resultado, chegou } = await pendente;

    expect(resultado).toMatchObject({ matched: true, count: 3, near_miss: null });
    expect(uuids(resultado.requests)).toEqual([m1.uuid, m2.uuid, m3.uuid]);
    expect(resultado.requests).toEqual([m1, m2, m3]);
    expect(chegou - antesDaTerceira, 'respondeu logo depois da 3ª').toBeLessThan(3_000);
  });

  test('after = seq da mais nova → nada a avaliar: matched=false, requests vazio, near_miss null', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await enviarEGuardar(request, token.uuid, '/a', { method: 'POST' });
    const { msg: nova } = await enviarEGuardar(request, token.uuid, '/b', { method: 'POST' });

    const { resultado } = await esperar(request, token.uuid, { after: nova.seq, timeout: 0 });
    expect(resultado).toEqual({ matched: false, count: 0, requests: [], near_miss: null });
  });

  test('after=0 considera todo o histórico', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '/a', { method: 'POST' });
    const { resultado } = await esperar(request, token.uuid, { after: 0, timeout: 0 });
    expect(uuids(resultado.requests)).toEqual([msg.uuid]);
  });

  test('menos que o count ao fim do prazo → matched=false com as que casaram', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg: m1 } = await enviarEGuardar(request, token.uuid, '/item/1', { method: 'POST' });
    const { msg: m2 } = await enviarEGuardar(request, token.uuid, '/item/2', { method: 'POST' });

    const { resultado } = await esperar(request, token.uuid, { match: { path: { prefix: '/item' } }, count: 3, timeout: 0 });
    expect(resultado.matched).toBe(false);
    expect(resultado.count).toBe(2);
    expect(uuids(resultado.requests)).toEqual([m1.uuid, m2.uuid]);
    // Todas as avaliadas casaram: nenhuma é "quase".
    expect(resultado.near_miss).toBeNull();
  });
});

test.describe('wait-for: prazo sem casar e near miss (CA-4)', () => {
  test('prazo acaba → matched=false perto do timeout, near_miss = a com menos condições falhando', async ({ request, tokens }) => {
    const token = await tokens.criar();
    // 4 falhas: método, caminho, cabeçalho, corpo.
    await enviarEGuardar(request, token.uuid, '/x', { method: 'GET' });
    // 1 falha: o corpo.
    const { msg: perto } = await enviarEGuardar(request, token.uuid, '/pagamentos', {
      method: 'POST', headers: { ...JSON_CT, 'X-Signature': 'abc' }, data: corpoJson({ status: 'pendente' }),
    });
    // 2 falhas: método e cabeçalho (mais nova que a de 1 falha: o critério é o número de falhas).
    await enviarEGuardar(request, token.uuid, '/pagamentos', { method: 'PUT', headers: JSON_CT, data: corpoJson({ status: 'pago' }) });

    const { resultado, ms } = await esperar(request, token.uuid, { match: PAGAMENTO, timeout: 2_000 });

    expect(ms, 'esperou o prazo').toBeGreaterThanOrEqual(1_950);
    expect(ms, 'terminou perto do prazo').toBeLessThan(7_000);
    expect(resultado).toMatchObject({ matched: false, count: 0, requests: [] });
    expect(resultado.near_miss).not.toBeNull();
    expect(resultado.near_miss!.uuid).toBe(perto.uuid);
    expect(resultado.near_miss!.seq).toBe(perto.seq);
    expect(resultado.near_miss!.failed, JSON.stringify(resultado.near_miss)).toHaveLength(1);
    expectFalhas(resultado.near_miss!.failed, [/^body \$\.status\b.*"?pago"?.*"?pendente"?/]);
  });

  test('timeout=0 responde na hora; frases dizem o alvo, o esperado e o recebido (método, cabeçalho, JSONPath)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '/pagamentos', {
      method: 'PUT', headers: JSON_CT, data: corpoJson({ status: 'pendente' }),
    });

    const { resultado, ms } = await esperar(request, token.uuid, { match: PAGAMENTO, timeout: 0 });

    expect(ms, 'timeout=0 não espera').toBeLessThan(1_500);
    expect(resultado).toMatchObject({ matched: false, count: 0, requests: [] });
    expect(resultado.near_miss).toMatchObject({ uuid: msg.uuid, seq: msg.seq });
    expect(resultado.near_miss!.failed, JSON.stringify(resultado.near_miss)).toHaveLength(3);
    expectFalhas(resultado.near_miss!.failed, [
      /^method\b.*POST.*PUT/,
      /^header x-signature\b.*absent/i,
      /^body \$\.status\b.*"?pago"?.*"?pendente"?/,
    ]);
  });

  test('frases de caminho e de query, como nas regras', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await enviarEGuardar(request, token.uuid, '/outra?tipo=boleto');
    const { resultado } = await esperar(request, token.uuid, {
      match: { path: { equals: '/pagamentos' }, query: { tipo: { equals: 'pix' } } }, timeout: 0,
    });
    expect(resultado.near_miss!.failed, JSON.stringify(resultado.near_miss)).toHaveLength(2);
    expectFalhas(resultado.near_miss!.failed, [/^path\b.*\/pagamentos.*\/outra/, /^query tipo\b.*pix.*boleto/]);
  });

  test('empate no número de falhas → near_miss é a mais nova', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await enviarEGuardar(request, token.uuid, '/a');
    const { msg: nova } = await enviarEGuardar(request, token.uuid, '/b');
    const { resultado } = await esperar(request, token.uuid, { match: { path: { equals: '/c' } }, timeout: 0 });
    expect(resultado.near_miss).toMatchObject({ uuid: nova.uuid, seq: nova.seq });
    expect(resultado.near_miss!.failed).toHaveLength(1);
  });

  test('mensagem que chega durante a espera e não casa também é avaliada para o near_miss', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const pendente = esperar(request, token.uuid, { match: { method: ['POST'], path: { equals: '/esperado' } }, timeout: 2_500 });
    await espera(800);
    const { msg } = await enviarEGuardar(request, token.uuid, '/esperado', { method: 'PATCH' });

    const { resultado, ms } = await pendente;
    expect(ms).toBeGreaterThanOrEqual(2_450);
    expect(resultado).toMatchObject({ matched: false, count: 0, requests: [] });
    expect(resultado.near_miss).toMatchObject({ uuid: msg.uuid, seq: msg.seq });
    expectFalhas(resultado.near_miss!.failed, [/^method\b.*POST.*PATCH/]);
  });

  test('URL vazia e timeout=0 → responde na hora com near_miss null', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { resultado, ms } = await esperar(request, token.uuid, { match: { method: ['POST'] }, timeout: 0 });
    expect(ms).toBeLessThan(1_500);
    expect(resultado).toEqual({ matched: false, count: 0, requests: [], near_miss: null });
  });
});

test.describe('wait-for: URL apagada durante a espera', () => {
  test('encerra a espera com 200 e matched=false (sem 410 no meio da resposta)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const pendente = esperar(request, token.uuid, { match: { path: { equals: '/nunca' } }, timeout: 20_000 });
    await espera(1_000);
    const apagadaEm = Date.now();
    const del = await request.delete(`/token/${token.uuid}`, { headers: JSON_ACCEPT });
    expect(del.status()).toBe(204);

    const { resultado, chegou } = await pendente;
    expect(resultado).toEqual({ matched: false, count: 0, requests: [], near_miss: null });
    expect(chegou - apagadaEm, 'encerrou logo depois de a URL ser apagada').toBeLessThan(5_000);
  });

  test('com parte do count já casada, devolve o que houver', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '/item/1', { method: 'POST' });
    const pendente = esperar(request, token.uuid, { match: { path: { prefix: '/item' } }, count: 2, timeout: 20_000 });
    await espera(1_000);
    const apagadaEm = Date.now();
    expect((await request.delete(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).status()).toBe(204);

    const { resultado, chegou } = await pendente;
    expect(resultado.matched).toBe(false);
    expect(resultado.count).toBe(1);
    expect(resultado.requests).toEqual([msg]);
    expect(chegou - apagadaEm).toBeLessThan(5_000);
  });
});
