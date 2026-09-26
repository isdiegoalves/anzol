import {
  JSON_ACCEPT, disparar, expect, expectContentType, expectErroJson, listar, test, todosOsUuids, type Token,
} from '../../support/contrato.js';

// Limpeza automática (plano de features, itens 03 e 05). Substitui o antigo "limite de 500 → 410"
// por decisão do dono: a URL nunca para de receber; mantém as N mais recentes (janela FIFO), com
// N = auto_cleanup ?? WEBHOOK_MAX_REQUESTS do servidor.

const MENSAGEM = 'The selected auto cleanup is invalid.';

/** WEBHOOK_MAX_REQUESTS do app sob teste (padrão do servidor: 10000). Ver README. */
const TETO_PADRAO = Number(process.env.TETO_PADRAO ?? 10_000);

/** Envia uma a uma (ordem de chegada garantida) e devolve os X-Request-Id. */
async function emSequencia(request: Parameters<typeof disparar>[0], tokenId: string, quantidade: number): Promise<string[]> {
  return disparar(request, tokenId, quantidade, { paralelas: 1 });
}

async function expectAusente(request: Parameters<typeof disparar>[0], tokenId: string, id: string): Promise<void> {
  await expectErroJson(await request.get(`/token/${tokenId}/request/${id}`, { headers: JSON_ACCEPT }), 404, 'Request not found');
}

test.describe('auto_cleanup no token', () => {
  const aceitos: Array<[string, unknown, number | null]> = [
    ['500', 500, 500],
    ['1000', 1000, 1000],
    ['5000', 5000, 5000],
    ['10000', 10000, 10000],
    ['número em string (como o front manda)', '1000', 1000],
    ['null explícito', null, null],
    ['string vazia vale como ausente', '', null],
  ];
  for (const [nome, enviado, esperado] of aceitos) {
    test(`POST /token aceita ${nome}`, async ({ request, tokens }) => {
      const token = await tokens.criar({ auto_cleanup: enviado });
      expect(token.auto_cleanup).toBe(esperado);
      const lido = (await (await request.get(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).json()) as Token;
      expect(lido.auto_cleanup).toBe(esperado);
    });
  }

  test('ausente na criação: null; formulário também vale', async ({ request, tokens }) => {
    expect((await tokens.criar()).auto_cleanup).toBeNull();
    const res = await request.post('/token', { form: { auto_cleanup: '5000' }, headers: JSON_ACCEPT });
    expect(res.status()).toBe(201);
    const token = (await res.json()) as Token;
    tokens.registrar(token.uuid);
    expect(token.auto_cleanup).toBe(5000);
  });

  const recusados: Array<[string, unknown]> = [
    ['700', 700],
    ['"700"', '700'],
    ['0', 0],
    ['-500', -500],
    ['texto', 'abc'],
    ['booleano', true],
    ['lista', [500]],
  ];
  for (const [nome, valor] of recusados) {
    test(`POST /token recusa ${nome} → 422`, async ({ request, tokens }) => {
      const res = await request.post('/token', { data: { auto_cleanup: valor }, headers: JSON_ACCEPT });
      if (res.status() === 201) tokens.registrar((await res.json()).uuid);
      expect(res.status()).toBe(422);
      expectContentType(res, 'application/json');
      expect(await res.json()).toEqual({ auto_cleanup: [MENSAGEM] });
    });
  }

  test('PUT troca o valor, PUT sem o campo volta a null e PUT inválido → 422 sem alterar', async ({ request, tokens }) => {
    const token = await tokens.criar({ auto_cleanup: 500 });
    const lerAtual = async () => ((await (await request.get(`/token/${token.uuid}`, { headers: JSON_ACCEPT })).json()) as Token).auto_cleanup;

    const trocado = await request.put(`/token/${token.uuid}`, { data: { auto_cleanup: 10000 }, headers: JSON_ACCEPT });
    expect(trocado.status()).toBe(200);
    expect(((await trocado.json()) as Token).auto_cleanup).toBe(10000);

    const invalido = await request.put(`/token/${token.uuid}`, { data: { auto_cleanup: 700 }, headers: JSON_ACCEPT });
    expect(invalido.status()).toBe(422);
    expect(await invalido.json()).toEqual({ auto_cleanup: [MENSAGEM] });
    expect(await lerAtual()).toBe(10000);

    const semCampo = await request.put(`/token/${token.uuid}`, { data: { default_content: 'x' }, headers: JSON_ACCEPT });
    expect(semCampo.status()).toBe(200);
    expect(((await semCampo.json()) as Token).auto_cleanup).toBeNull();
    expect(await lerAtual()).toBeNull();
  });
});

test.describe('corte FIFO ao gravar', () => {
  test('sem auto_cleanup a 501ª mensagem é gravada (não há mais 410 por volume)', async ({ request, tokens }) => {
    test.skip(TETO_PADRAO <= 500, `TETO_PADRAO=${TETO_PADRAO}: o teto do servidor corta antes de 501`);
    test.setTimeout(300_000);
    const token = await tokens.criar();
    await disparar(request, token.uuid, 500);
    const res = await request.post(`/${token.uuid}`, { headers: JSON_ACCEPT });
    expect(res.status(), await res.text()).toBe(200);
    expect((await listar(request, token.uuid, 'per_page=1')).total).toBe(501);
  });

  test('auto_cleanup 500 e 510 mensagens: total 500, as 10 primeiras saem, a última fica', async ({ request, tokens }) => {
    test.setTimeout(300_000);
    const token = await tokens.criar({ auto_cleanup: 500 });
    const primeiras = await emSequencia(request, token.uuid, 10);
    await disparar(request, token.uuid, 499);
    const [ultima] = await emSequencia(request, token.uuid, 1);

    const { total, data } = await listar(request, token.uuid, 'sorting=newest&per_page=1');
    expect(total).toBe(500);
    expect(data.map((m) => m.uuid)).toEqual([ultima]);
    for (const id of primeiras) await expectAusente(request, token.uuid, id);

    const listados = await todosOsUuids(request, token.uuid);
    expect(listados).toHaveLength(500);
    expect(new Set(listados).size).toBe(500);
    expect(listados.filter((id) => primeiras.includes(id))).toEqual([]);
    expect(listados.at(-1)).toBe(ultima);
  });

  test('reduzir o limite pelo PUT corta na hora (1000 → 500 com 600 gravadas)', async ({ request, tokens }) => {
    test.setTimeout(300_000);
    const token = await tokens.criar({ auto_cleanup: 1000 });
    const antigas = await emSequencia(request, token.uuid, 100);
    await disparar(request, token.uuid, 500);
    expect((await listar(request, token.uuid, 'per_page=1')).total).toBe(600);

    const res = await request.put(`/token/${token.uuid}`, { data: { auto_cleanup: 500 }, headers: JSON_ACCEPT });
    expect(res.status()).toBe(200);
    expect(((await res.json()) as Token).auto_cleanup).toBe(500);

    // Sem nenhuma mensagem nova: o corte vem do PUT.
    expect((await listar(request, token.uuid, 'per_page=1')).total).toBe(500);
    for (const id of [antigas[0]!, antigas[50]!, antigas[99]!]) await expectAusente(request, token.uuid, id);
    const listados = await todosOsUuids(request, token.uuid);
    expect(listados).toHaveLength(500);
    expect(listados.filter((id) => antigas.includes(id))).toEqual([]);
  });

  test('concorrência: 600 requisições, 20 em paralelo, numa URL com 500 → exatamente 500', async ({ request, tokens }) => {
    test.setTimeout(300_000);
    const token = await tokens.criar({ auto_cleanup: 500 });
    const enviados = await disparar(request, token.uuid, 600, { paralelas: 20 });
    expect(new Set(enviados).size).toBe(600);

    expect((await listar(request, token.uuid, 'per_page=1')).total).toBe(500);
    const listados = await todosOsUuids(request, token.uuid);
    expect(listados).toHaveLength(500);
    expect(new Set(listados).size).toBe(500);
    for (const id of listados) expect(enviados).toContain(id);
  });

  test(`sem auto_cleanup vale o teto do servidor (TETO_PADRAO=${TETO_PADRAO}): FIFO, nunca 410`, async ({ request, tokens }) => {
    test.setTimeout(900_000);
    const token = await tokens.criar();
    const primeiras = await emSequencia(request, token.uuid, 10);
    await disparar(request, token.uuid, TETO_PADRAO - 1, { paralelas: 20 });
    const [ultima] = await emSequencia(request, token.uuid, 1);

    const { total, data } = await listar(request, token.uuid, 'sorting=newest&per_page=1');
    expect(total).toBe(TETO_PADRAO);
    expect(data.map((m) => m.uuid)).toEqual([ultima]);
    for (const id of primeiras) await expectAusente(request, token.uuid, id);
  });
});
