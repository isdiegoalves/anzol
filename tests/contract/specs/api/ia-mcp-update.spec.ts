import type { APIRequestContext } from '@playwright/test';
import { JSON_ACCEPT, enviarEGuardar, expect, type Token } from '../../support/contrato.js';
import { assinaturaGithub, mascarado } from '../../support/assinatura.js';
import { MODO_MCP } from '../../support/ia.js';
import { test, textoDo } from '../../support/mcp.js';

// Patamar, fatia D1, DX-28 (`.docs-arquivo/patamar/api-defeitos.md`, item 3): a ferramenta MCP `update_url` deixa de
// apagar o que não foi enviado. Campo ausente fica como está; `null` explícito desliga ou volta ao padrão; o bloco
// `signature` enviado substitui o bloco (segredo omitido é mantido, como no `PUT`). Antes, a ferramenta repassava os
// argumentos ao `PUT /token/{id}`, que substitui a configuração inteira: `update_url {default_status: 418}` desligava
// a assinatura e o schema em silêncio. O `PUT` da REST não muda (token.spec.ts e assinatura-config.spec.ts o fixam).

const SEGREDO = 'segredo-update-url-6Lw1';
const SCHEMA = { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } };
const CONFIG = {
  default_status: 201,
  default_content: 'corpo padrão',
  default_content_type: 'text/html',
  timeout: 1,
  retry_after: 7,
  auto_cleanup: 1000,
  signature: { provider: 'github', secret: SEGREDO },
  schema: SCHEMA,
};
const JSON_CT = { 'Content-Type': 'application/json' };

async function lerToken(request: APIRequestContext, uuid: string): Promise<Token> {
  const res = await request.get(`/token/${uuid}`, { headers: JSON_ACCEPT });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Token;
}

/** A URL sem `updated_at`, que muda a cada gravação. */
function semData(token: Token): Omit<Token, 'updated_at'> {
  const { updated_at: _u, ...resto } = token;
  return resto;
}

/** Uma captura assinada com `segredo`: diz se a URL ainda confere a assinatura com ele e valida o schema. */
async function capturar(request: APIRequestContext, uuid: string, segredo = SEGREDO) {
  const corpo = '{"id":1}';
  return enviarEGuardar(request, uuid, '/conferir', {
    method: 'POST', headers: { ...JSON_CT, 'X-Hub-Signature-256': assinaturaGithub(segredo, corpo) }, data: Buffer.from(corpo),
  });
}

test.describe('MCP update_url preserva o que não foi enviado (DX-28)', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('um campo só: os outros ficam, inclusive assinatura, schema, timeout e resposta padrão', async ({ mcp, request, tokens }) => {
    const token = await tokens.criar(CONFIG);
    const antes = await lerToken(request, token.uuid);

    const devolvido = await mcp.chamarOk<Token>('update_url', { default_status: 418 }, token.uuid);
    const depois = await lerToken(request, token.uuid);
    expect(semData(depois)).toEqual({ ...semData(antes), default_status: 418 });
    // O resultado é a URL depois da mudança, com o segredo mascarado.
    expect(devolvido).toMatchObject({ uuid: token.uuid, default_status: 418, timeout: 1, schema: SCHEMA });
    expect(devolvido.signature).toMatchObject({ provider: 'github', secret: mascarado(SEGREDO) });
    expect(JSON.stringify(devolvido)).not.toContain(SEGREDO);

    // A URL continua conferindo a assinatura com o mesmo segredo e validando o schema.
    const { res, msg } = await capturar(request, token.uuid);
    expect(res.status()).toBe(418);
    expect(await res.text()).toBe('corpo padrão');
    expect(res.headers()['retry-after']).toBe('7');
    expect(msg.signature).toEqual({ provider: 'github', valid: true, reason: null });
    expect(msg.schema).toEqual({ valid: true, errors: [] });
  });

  for (const [campo, valor] of [
    ['default_content', 'outro corpo'],
    ['default_content_type', 'application/json'],
    ['timeout', 2],
    ['retry_after', 30],
    ['auto_cleanup', 5000],
  ] as Array<[keyof Token, unknown]>) {
    test(`só ${campo}: muda ele e mais nada`, async ({ mcp, request, tokens }) => {
      const token = await tokens.criar(CONFIG);
      const antes = await lerToken(request, token.uuid);
      await mcp.chamarOk('update_url', { [campo]: valor }, token.uuid);
      expect(semData(await lerToken(request, token.uuid))).toEqual({ ...semData(antes), [campo]: valor });
    });
  }

  test('sem campo nenhum: nada muda', async ({ mcp, request, tokens }) => {
    const token = await tokens.criar(CONFIG);
    const antes = await lerToken(request, token.uuid);
    await mcp.chamarOk('update_url', {}, token.uuid);
    expect(semData(await lerToken(request, token.uuid))).toEqual(semData(antes));
  });

  test('só schema: troca o schema e a assinatura fica; só signature: troca o bloco e o schema fica', async ({ mcp, request, tokens }) => {
    const token = await tokens.criar(CONFIG);
    const antes = await lerToken(request, token.uuid);
    const outro = { type: 'object', required: ['nome'] };
    await mcp.chamarOk('update_url', { schema: outro }, token.uuid);
    expect(semData(await lerToken(request, token.uuid))).toEqual({ ...semData(antes), schema: outro });

    // Bloco `signature` sem `secret`: o segredo fica (como no PUT); o provedor é o enviado.
    await mcp.chamarOk('update_url', { signature: { provider: 'generic', header: 'X-Hub-Signature-256', prefix: 'sha256=' } }, token.uuid);
    const depois = await lerToken(request, token.uuid);
    expect(depois.schema).toEqual(outro);
    expect(depois.signature).toMatchObject({ provider: 'generic', header: 'X-Hub-Signature-256', secret: mascarado(SEGREDO) });
    expect(depois).toMatchObject({ default_status: 201, timeout: 1, retry_after: 7, auto_cleanup: 1000 });
    const corpo = '{"nome":"x"}';
    const { msg } = await enviarEGuardar(request, token.uuid, '', {
      method: 'POST', headers: { ...JSON_CT, 'X-Hub-Signature-256': assinaturaGithub(SEGREDO, corpo) }, data: Buffer.from(corpo),
    });
    expect(msg.signature?.valid).toBe(true);

    // Segredo novo no bloco: troca.
    const novo = 'segredo-novo-update-url-2Rk9';
    await mcp.chamarOk('update_url', { signature: { provider: 'github', secret: novo } }, token.uuid);
    expect((await capturar(request, token.uuid, novo)).msg.signature?.valid).toBe(true);
    expect((await capturar(request, token.uuid, SEGREDO)).msg.signature?.valid).toBe(false);
  });
});

test.describe('MCP update_url: null explícito desliga (DX-28)', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('signature: null desliga a verificação e só ela', async ({ mcp, request, tokens }) => {
    const token = await tokens.criar(CONFIG);
    const antes = await lerToken(request, token.uuid);
    await mcp.chamarOk('update_url', { signature: null }, token.uuid);
    expect(semData(await lerToken(request, token.uuid))).toEqual({ ...semData(antes), signature: null });
    const { msg } = await capturar(request, token.uuid);
    expect(msg.signature).toBeNull();
    expect(msg.schema).toEqual({ valid: true, errors: [] });
  });

  test('schema: null desliga a validação e só ela', async ({ mcp, request, tokens }) => {
    const token = await tokens.criar(CONFIG);
    const antes = await lerToken(request, token.uuid);
    await mcp.chamarOk('update_url', { schema: null }, token.uuid);
    expect(semData(await lerToken(request, token.uuid))).toEqual({ ...semData(antes), schema: null });
    const { msg } = await capturar(request, token.uuid);
    expect(msg.schema).toBeNull();
    expect(msg.signature?.valid).toBe(true);
  });

  test('null nos outros campos volta cada um ao padrão, e só ele', async ({ mcp, request, tokens }) => {
    const padroes: Array<[keyof Token, unknown]> = [
      ['default_status', 200], ['default_content', ''], ['default_content_type', 'text/plain'], ['timeout', 0],
      ['retry_after', null], ['auto_cleanup', null],
    ];
    const token = await tokens.criar(CONFIG);
    let esperado = semData(await lerToken(request, token.uuid));
    for (const [campo, padrao] of padroes) {
      await mcp.chamarOk('update_url', { [campo]: null }, token.uuid);
      esperado = { ...esperado, [campo]: padrao };
      expect(semData(await lerToken(request, token.uuid)), `${campo}: null`).toEqual(esperado);
    }
  });

  test('null e valor na mesma chamada: cada campo segue a sua regra', async ({ mcp, request, tokens }) => {
    const token = await tokens.criar(CONFIG);
    const antes = await lerToken(request, token.uuid);
    await mcp.chamarOk('update_url', { schema: null, timeout: 3 }, token.uuid);
    expect(semData(await lerToken(request, token.uuid))).toEqual({ ...semData(antes), schema: null, timeout: 3 });
  });
});

test.describe('MCP update_url: validação e descrição (DX-28)', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('valor inválido: erro de ferramenta com a mensagem da API, e nada muda', async ({ mcp, request, tokens }) => {
    const token = await tokens.criar(CONFIG);
    const antes = await lerToken(request, token.uuid);
    const r = await mcp.chamar('update_url', { timeout: 11, default_status: 418 }, token.uuid);
    expect(r.isError, textoDo(r).slice(0, 300)).toBe(true);
    expect(textoDo(r)).toContain('The timeout may not be greater than 10.');
    expect(await lerToken(request, token.uuid)).toEqual(antes);
  });

  test('a descrição diz as duas regras: ausente fica, null desliga', async ({ mcp }) => {
    const descricao = mcp.ferramentas.get('update_url')?.description ?? '';
    expect(descricao, 'cita null').toMatch(/\bnull\b/i);
    // A frase antiga dizia o contrário do que o agente precisa.
    expect(descricao).not.toMatch(/go back to their defaults/i);
  });
});
