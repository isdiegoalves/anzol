import { JSON_ACCEPT, enviarEGuardar, espera, expect, type Mensagem, type Token } from '../../support/contrato.js';
import { mascarado } from '../../support/assinatura.js';
import { MODO_MCP } from '../../support/ia.js';
import { FERRAMENTAS, argumentoDaUrl, jsonDo, test, textoDo } from '../../support/mcp.js';
import { lerRegras, type RegraSalva, type ResultadoTesteDeRegra } from '../../support/regras.js';
import type { ResultadoDaEspera } from '../../support/espera.js';

// Servidor MCP (§1 do plano "ia-local", CA-1): um cliente MCP real (SDK oficial, Streamable HTTP em
// `/mcp`) lista as ferramentas e opera o Anzol sobre a API existente, com a mesma validação e os
// mesmos erros. O resultado de cada ferramenta é lido como o JSON da resposta da API (texto ou
// `structuredContent`); o que as ferramentas fizeram é conferido de novo pela API HTTP.

const JSON_CT = { 'Content-Type': 'application/json' };

test.describe('MCP ligado (CA-1)', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('lista as 14 ferramentas da §1, cada uma com descrição e schema de entrada', async ({ mcp }) => {
    const nomes = [...mcp.ferramentas.keys()];
    for (const nome of FERRAMENTAS) expect(nomes, `ferramenta ${nome}`).toContain(nome);
    for (const nome of FERRAMENTAS) {
      const f = mcp.ferramentas.get(nome)!;
      expect((f.description ?? '').trim().length, `descrição de ${nome}`).toBeGreaterThan(0);
      expect(f.inputSchema.type, `inputSchema de ${nome}`).toBe('object');
      // Todas, menos a que cria, recebem o UUID da URL.
      if (nome !== 'create_url') expect(argumentoDaUrl(f), `${nome}: ${JSON.stringify(f.inputSchema)}`).toBeDefined();
    }
  });

  test('fluxo: create_url → webhook → wait_for_request → set_rules → test_rule → delete_url', async ({ mcp, request, tokens }) => {
    // create_url com as opções da URL (os campos do POST /token).
    const criado = await mcp.chamarOk<Token>('create_url', { default_status: 201, default_content: 'ok-mcp', default_content_type: 'text/plain' });
    expect(criado.uuid).toMatch(/^[0-9a-f-]{36}$/);
    tokens.registrar(criado.uuid);
    const pelaApi = await request.get(`/token/${criado.uuid}`, { headers: JSON_ACCEPT });
    expect(pelaApi.status()).toBe(200);
    expect(await pelaApi.json()).toMatchObject({ uuid: criado.uuid, default_status: 201, default_content: 'ok-mcp', default_content_type: 'text/plain' });

    // wait_for_request esperando (long-poll) enquanto o webhook chega.
    const espera$ = mcp.chamarOk<ResultadoDaEspera>('wait_for_request', { timeout: 20_000 }, criado.uuid);
    await espera(500);
    const webhook = await request.post(`/${criado.uuid}/pedidos`, { headers: JSON_CT, data: Buffer.from('{"status":"pago"}') });
    expect(webhook.status()).toBe(201);
    expect(await webhook.text()).toBe('ok-mcp');
    const rid = webhook.headers()['x-request-id']!;
    const esperado = await espera$;
    expect(esperado.matched, JSON.stringify(esperado).slice(0, 300)).toBe(true);
    expect(esperado.requests.map((m: Mensagem) => m.uuid)).toEqual([rid]);

    // set_rules grava pela mesma API: a regra aparece no GET e responde o próximo webhook.
    const salvas = await mcp.chamarOk<RegraSalva[]>('set_rules', {
      rules: [{ name: 'pago', match: { method: ['POST'], path: { equals: '/pedidos' } }, response: { status: 202, body: 'regra-mcp' } }],
    }, criado.uuid);
    expect(salvas.map((r) => r.name)).toEqual(['pago']);
    expect((await lerRegras(request, criado.uuid)).map((r) => r.name)).toEqual(['pago']);
    const comRegra = await request.post(`/${criado.uuid}/pedidos`, { data: Buffer.from('x') });
    expect(comRegra.status()).toBe(202);
    expect(await comRegra.text()).toBe('regra-mcp');

    // test_rule sobre as mensagens gravadas.
    const teste = await mcp.chamarOk<ResultadoTesteDeRegra>('test_rule', {
      rule: { name: 'pago no corpo', match: { body: [{ jsonPath: { path: '$.status', equals: 'pago' } }] } },
    }, criado.uuid);
    expect(teste.matches.map((m) => m.uuid)).toEqual([rid]);
    expect(teste.misses.map((m) => m.uuid)).toEqual([comRegra.headers()['x-request-id']]);

    // delete_url apaga: a API responde 410 depois.
    await mcp.chamarOk('delete_url', {}, criado.uuid);
    const depois = await request.get(`/token/${criado.uuid}`, { headers: JSON_ACCEPT });
    expect(depois.status()).toBe(410);
  });

  test('erro de validação volta como erro de ferramenta legível, com a mensagem da API, e nada muda', async ({ mcp, request, tokens }) => {
    const token = await tokens.criar();

    // Regra com regex inválida: a API dá 422 "The regex is invalid."; a ferramenta, isError com o texto.
    const regras = await mcp.chamar('set_rules', { rules: [{ name: 'ruim', match: { path: { regex: '([a-z' } } }] }, token.uuid);
    expect(regras.isError, textoDo(regras).slice(0, 300)).toBe(true);
    expect(textoDo(regras)).toContain('The regex is invalid.');
    expect(await lerRegras(request, token.uuid)).toEqual([]);

    // Opção de URL fora do limite: a mesma mensagem do 422 do POST /token; nenhuma URL criada.
    const url = await mcp.chamar('create_url', { timeout: 11 });
    expect(url.isError, textoDo(url).slice(0, 300)).toBe(true);
    expect(textoDo(url)).toContain('The timeout may not be greater than 10.');

    // URL que não existe: o erro da API (410 Token not found).
    const inexistente = await mcp.chamar('get_url', {}, '00000000-0000-4000-8000-000000000000');
    expect(inexistente.isError, textoDo(inexistente).slice(0, 300)).toBe(true);
    expect(textoDo(inexistente)).toContain('Token not found');

    // A mensagem capturada continua intacta depois dos erros.
    const { msg } = await enviarEGuardar(request, token.uuid, '/depois', { method: 'POST' });
    expect(msg.rule).toBeNull();
  });

  test('o segredo de assinatura nunca volta: create_url e get_url mostram só o mascarado', async ({ mcp, tokens }) => {
    const segredo = 'segredo-mcp-nao-pode-vazar-9f3e';
    const resultado = await mcp.chamar('create_url', { signature: { provider: 'github', secret: segredo } });
    expect(resultado.isError ?? false, textoDo(resultado).slice(0, 300)).toBe(false);
    const criado = jsonDo<Token>(resultado);
    tokens.registrar(criado.uuid);
    expect(JSON.stringify(resultado)).not.toContain(segredo);
    expect(criado.signature).toMatchObject({ provider: 'github', secret: mascarado(segredo) });

    const lido = await mcp.chamar('get_url', {}, criado.uuid);
    expect(lido.isError ?? false, textoDo(lido).slice(0, 300)).toBe(false);
    expect(JSON.stringify(lido)).not.toContain(segredo);
    expect(textoDo(lido) + JSON.stringify(lido.structuredContent ?? null)).toContain(mascarado(segredo));
  });
});

test.describe('MCP desligado (CA-1)', () => {
  test.skip(MODO_MCP !== 'desligado', 'só num stack com o MCP desligado (CONTRATO_MCP=desligado)');

  test('/mcp → 404', async ({ request }) => {
    const inicializar = {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'contrato', version: '1' } },
    };
    const post = await request.post('/mcp', { data: inicializar, headers: { Accept: 'application/json, text/event-stream' } });
    expect(post.status()).toBe(404);
    const get = await request.get('/mcp', { headers: { Accept: 'text/event-stream' } });
    expect(get.status()).toBe(404);
  });
});
