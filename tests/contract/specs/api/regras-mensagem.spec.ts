import { enviarEGuardar, expect, listar, test } from '../../support/contrato.js';
import { expectFalhas, salvarRegras, type Regra } from '../../support/regras.js';

// Registro na mensagem gravada (CA-4): toda mensagem traz `rule` e `near_miss`. `rule` = `{id,
// name}` da regra que respondeu; `near_miss` = `{id, name, failed}` da regra ATIVA mais próxima
// (menos condições falhando, empate pela prioridade), preenchido só quando há regras ativas e
// nenhuma casou. `failed` tem uma frase curta em inglês por condição que falhou; o contrato casa o
// conteúdo (o que se esperava e o que veio), não o texto exato.

const PAGAMENTO: Regra = {
  name: 'Pagamento pix',
  priority: 2,
  match: {
    method: ['POST'],
    path: { equals: '/pagamentos' },
    headers: { 'X-Signature': { present: true } },
    body: [{ jsonPath: { path: '$.status', equals: 'pago' } }],
  },
  response: { status: 201, body: 'ok' },
};

test.describe('mensagem: rule e near_miss', () => {
  test('URL sem regras: rule e near_miss null', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const { msg } = await enviarEGuardar(request, token.uuid, '/a', { method: 'POST', data: Buffer.from('x') });
    expect(msg).toHaveProperty('rule', null);
    expect(msg).toHaveProperty('near_miss', null);
  });

  test('regra casou: rule = {id, name} e near_miss null, no GET da mensagem e na listagem', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [salva] = await salvarRegras(request, token.uuid, [PAGAMENTO]);
    const { res, msg } = await enviarEGuardar(request, token.uuid, '/pagamentos', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': 'abc' }, data: Buffer.from('{"status":"pago"}'),
    });
    expect(res.status()).toBe(201);
    expect(msg.rule).toEqual({ id: salva.id, name: 'Pagamento pix' });
    expect(msg).toHaveProperty('near_miss', null);

    const { data } = await listar(request, token.uuid);
    expect(data).toHaveLength(1);
    expect(data[0].rule).toEqual({ id: salva.id, name: 'Pagamento pix' });
    expect(data[0]).toHaveProperty('near_miss', null);
  });

  test('nenhuma casou: near_miss traz a regra e uma frase por condição que falhou (método, cabeçalho, JSONPath)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [salva] = await salvarRegras(request, token.uuid, [PAGAMENTO]);
    // Caminho casa; método, cabeçalho e corpo não.
    const { res, msg } = await enviarEGuardar(request, token.uuid, '/pagamentos', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, data: Buffer.from('{"status":"pendente"}'),
    });
    expect(res.status()).toBe(200);
    expect(msg).toHaveProperty('rule', null);
    expect(msg.near_miss).not.toBeNull();
    // Item 14, B1: `conditions` ao lado de `failed` (as chaves são conferidas em regras-condicoes.spec.ts).
    expect(Object.keys(msg.near_miss!).sort()).toEqual(['conditions', 'failed', 'id', 'name']);
    expect(msg.near_miss!.id).toBe(salva.id);
    expect(msg.near_miss!.name).toBe('Pagamento pix');
    expect(msg.near_miss!.failed, JSON.stringify(msg.near_miss!.failed)).toHaveLength(3);
    expectFalhas(msg.near_miss!.failed, [
      /^method\b.*POST.*PUT/,
      /^header x-signature\b.*absent/i,
      /^body \$\.status\b.*"?pago"?.*"?pendente"?/,
    ]);
  });

  test('frases de caminho e de query dizem o que se esperava e o que veio', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [{
      name: 'caminho e query',
      match: { path: { equals: '/pagamentos' }, query: { tipo: { equals: 'pix' } } },
    }]);
    const { msg } = await enviarEGuardar(request, token.uuid, '/outra?tipo=boleto');
    expect(msg.near_miss!.failed, JSON.stringify(msg.near_miss)).toHaveLength(2);
    expectFalhas(msg.near_miss!.failed, [
      /^path\b.*\/pagamentos.*\/outra/,
      /^query tipo\b.*pix.*boleto/,
    ]);
  });

  test('near_miss é a regra com menos condições falhando, mesmo com prioridade pior', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [, perto] = await salvarRegras(request, token.uuid, [
      { name: 'longe', priority: 1, match: { method: ['DELETE'], path: { equals: '/x' } } },
      { name: 'perto', priority: 9, match: { method: ['POST'], path: { equals: '/pagamentos' } } },
    ]);
    const { msg } = await enviarEGuardar(request, token.uuid, '/pagamentos', { method: 'GET' });
    expect(msg).toHaveProperty('rule', null);
    expect(msg.near_miss).toMatchObject({ id: perto.id, name: 'perto' });
    expect(msg.near_miss!.failed).toHaveLength(1);
    expectFalhas(msg.near_miss!.failed, [/^method\b.*POST.*GET/]);
  });

  test('empate no número de falhas: near_miss é a de menor priority', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [, melhor] = await salvarRegras(request, token.uuid, [
      { name: 'p5', match: { path: { equals: '/a' } } },
      { name: 'p2', priority: 2, match: { path: { equals: '/b' } } },
    ]);
    const { msg } = await enviarEGuardar(request, token.uuid, '/c');
    expect(msg.near_miss).toMatchObject({ id: melhor.id, name: 'p2' });
  });

  test('regra desativada não é near_miss; só desativadas → near_miss null', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [, ativa] = await salvarRegras(request, token.uuid, [
      { name: 'desativada-quase', enabled: false, match: { path: { equals: '/pagamentos' } } },
      { name: 'ativa-longe', match: { method: ['DELETE'], path: { equals: '/x' } } },
    ]);
    const { msg } = await enviarEGuardar(request, token.uuid, '/pagamentos/1', { method: 'GET' });
    expect(msg.near_miss).toMatchObject({ id: ativa.id, name: 'ativa-longe' });
    expect(msg.near_miss!.failed).toHaveLength(2);

    await salvarRegras(request, token.uuid, [{ name: 'só desativada', enabled: false, match: { path: { equals: '/z' } } }]);
    const { msg: semAtiva } = await enviarEGuardar(request, token.uuid, '/a');
    expect(semAtiva).toHaveProperty('rule', null);
    expect(semAtiva).toHaveProperty('near_miss', null);
  });

  test('a regra que respondeu é a registrada, não outra que também casaria', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const [, vencedora] = await salvarRegras(request, token.uuid, [
      { name: 'p5', match: { path: { prefix: '/' } } },
      { name: 'p1', priority: 1, match: { path: { prefix: '/' } } },
    ]);
    const { msg } = await enviarEGuardar(request, token.uuid, '/qualquer');
    expect(msg.rule).toEqual({ id: vencedora.id, name: 'p1' });
    expect(msg).toHaveProperty('near_miss', null);
  });
});
