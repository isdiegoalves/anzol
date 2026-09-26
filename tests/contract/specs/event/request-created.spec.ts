import { bugDoLegado, buscarMensagem, disparar, expect, test, type Token } from '../../support/contrato.js';
import { ADAPTADOR, assinar, type Assinatura } from '../../support/eventos.js';

// Um canal por teste e um token por canal: nada de estado compartilhado entre testes.
test.describe(`evento request.created (adaptador ${ADAPTADOR})`, () => {
  let assinaturas: Assinatura[] = [];

  async function abrir(token: Token): Promise<Assinatura> {
    const a = await assinar(token.uuid);
    assinaturas.push(a);
    return a;
  }

  test.afterEach(async () => {
    for (const a of assinaturas) await a.fechar();
    assinaturas = [];
  });

  test('JSON: request igual à mensagem gravada (sem a chave request), total 1, truncated false', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const canal = await abrir(token);
    const res = await request.post(`/${token.uuid}/201?q=1`, {
      data: Buffer.from('{"a":1}'), headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(201);
    const evento = await canal.proximo();

    expect(evento.total).toBe(1);
    expect(evento.truncated).toBe(false);
    const gravada = await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!);
    expect(evento.request).toEqual(gravada);
    expect(evento.request).not.toHaveProperty('request');
  });

  test('payload {request, total, truncated, removed}: removed vazio quando nada sai', async ({ request, tokens }) => {
    const semLimpeza = await tokens.criar();
    const comLimpeza = await tokens.criar({ auto_cleanup: 500 });
    for (const token of [semLimpeza, comLimpeza]) {
      const canal = await abrir(token);
      await request.get(`/${token.uuid}`);
      const evento = await canal.proximo();
      expect(Object.keys(evento).sort()).toEqual(['removed', 'request', 'total', 'truncated']);
      expect(evento.removed).toEqual([]);
    }
  });

  test('limpeza automática: removed traz os uuids cortados e total não passa do limite', async ({ request, tokens }) => {
    test.setTimeout(300_000);
    const token = await tokens.criar({ auto_cleanup: 500 });
    const [primeira, segunda] = await disparar(request, token.uuid, 2, { paralelas: 1 });
    await disparar(request, token.uuid, 498);

    const canal = await abrir(token);
    const res = await request.get(`/${token.uuid}`);
    expect(res.status(), 'a 501ª mensagem entra (sem 410 por volume)').toBe(200);
    const nova = res.headers()['x-request-id'];
    const evento = await canal.proximo();
    expect(evento.request.uuid).toBe(nova);
    expect(evento.total).toBe(500);
    expect(evento.removed).toEqual([primeira]);

    await request.get(`/${token.uuid}`);
    const seguinte = await canal.proximo();
    expect(seguinte.total).toBe(500);
    expect(seguinte.removed).toEqual([segunda]);
  });

  test('formulário: request inclui os campos (chave request presente)', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const canal = await abrir(token);
    const res = await request.post(`/${token.uuid}`, { form: { a: 'b' } });
    const evento = await canal.proximo();
    const gravada = await buscarMensagem(request, token.uuid, res.headers()['x-request-id']!);
    expect(evento.request).toEqual(gravada);
    expect(evento.request.request).toEqual({ a: 'b' });
  });

  test('total acompanha a contagem de mensagens do token', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const canal = await abrir(token);
    const primeiro = (await request.get(`/${token.uuid}`)).headers()['x-request-id'];
    const segundo = (await request.get(`/${token.uuid}/404`)).headers()['x-request-id'];
    const eventos = [await canal.proximo(), await canal.proximo()];
    const totalPorId = Object.fromEntries(eventos.map((e) => [e.request.uuid, e.total]));
    expect(totalPorId).toEqual({ [primeiro!]: 1, [segundo!]: 2 });
  });

  test('o evento só vai para o canal do próprio token', async ({ request, tokens }) => {
    const a = await tokens.criar();
    const b = await tokens.criar();
    const canalA = await abrir(a);
    const canalB = await abrir(b);
    await request.get(`/${a.uuid}`);
    expect((await canalA.proximo()).request.token_id).toBe(a.uuid);
    await canalB.nenhum(3_000);
  });

  test.describe('corte acima de 1.000.000 caracteres de JSON (contados como o json_encode do PHP)', () => {
    // O app atual mede mb_strlen(json_encode($request)): "/" vira "\/" e não-ASCII vira "\uXXXX",
    // então 600.000 barras (600 kB no fio) passam de 1.000.000 e 990.000 letras não passam.
    const casos: Array<[string, string, boolean]> = [
      ['990.000 "a" (abaixo do limite)', 'a'.repeat(990_000), false],
      ['600.000 "/" (escapadas: \\/)', '/'.repeat(600_000), true],
      ['200.000 "ç" (escapadas: \\u00e7)', 'ç'.repeat(200_000), true],
    ];
    for (const [nome, corpo, truncado] of casos) {
      test(`${nome} → truncated ${truncado}`, async ({ request, tokens }) => {
        const token = await tokens.criar();
        const canal = await abrir(token);
        const res = await request.post(`/${token.uuid}`, {
          data: Buffer.from(corpo), headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
        expect(res.status()).toBe(200);
        const evento = await canal.proximo();
        expect(evento.truncated).toBe(truncado);
        expect(evento.total).toBe(1);
        // Com ou sem corte, o cliente acha a mensagem por estes dois campos (o front faz GET
        // quando truncated é true).
        expect(evento.request.uuid).toBe(res.headers()['x-request-id']);
        expect(evento.request.token_id).toBe(token.uuid);
        if (!truncado) {
          expect(evento.request).toEqual(await buscarMensagem(request, token.uuid, evento.request.uuid));
        }
      });
    }

    test('truncated true: request vem sem content, headers e user_agent', async ({ request, tokens }) => {
      // RequestCreated faz unset($this->request->content, ...) num atributo mágico da Entity,
      // que não tem __unset: o unset não faz nada e o evento sai com o corpo inteiro, apesar de
      // truncated = true. O corte é a intenção evidente do código; o app atual não o cumpre.
      bugDoLegado('evento marcado como truncated leva o corpo inteiro no app atual (unset em propriedade mágica)');
      const token = await tokens.criar();
      const canal = await abrir(token);
      await request.post(`/${token.uuid}`, { data: Buffer.from('/'.repeat(600_000)), headers: { 'Content-Type': 'text/plain' } });
      const evento = await canal.proximo();
      expect(evento.truncated).toBe(true);
      expect(evento.request).not.toHaveProperty('content');
      expect(evento.request).not.toHaveProperty('headers');
      expect(evento.request).not.toHaveProperty('user_agent');
    });
  });
});
