import type { APIRequestContext } from '@playwright/test';
import { JSON_ACCEPT, enviarEGuardar, expect, type Token } from '../../support/contrato.js';
import { assinaturaGithub, mascarado, putToken } from '../../support/assinatura.js';
import { MODO_MCP } from '../../support/ia.js';
import { jsonDo, test, textoDo, type Mcp } from '../../support/mcp.js';
import { erros422 } from '../../support/regras.js';

// Patamar, fatia D1, revisão de segurança (decisões do orquestrador de 2026-09-28):
// 1. Máscara gravada como segredo: no `PUT /token/{id}` e no `update_url` do MCP, `signature.secret` que começa com
//    a máscara (`••••`) e não é a máscara do segredo atual → 422 em `signature.secret`, e nada muda. Antes, o texto
//    mascarado virava o segredo novo: copiar o bloco que a API mostra de outra URL trocava o segredo por `••••abcd`,
//    que qualquer um que leu a outra URL conhece. A máscara certa do segredo atual continua mantendo o segredo. Na
//    criação (`POST /token` e `create_url`) não há segredo atual: todo texto que começa com a máscara → 422, e a URL
//    não é criada.
// 2. `create_url` do MCP: `null` nos opcionais de primeiro nível vale como ausente.
// 3. `update_url`: `signature: ""` e `schema: ""` → 422; só `null` desliga.
// 4. `update_url` simultâneo na mesma URL: as duas mudanças ficam gravadas.

const SEGREDO = 'segredo-da-url-A-7Hn4';
const SEGREDO_DE_OUTRA = 'segredo-da-url-B-2Xq9';
const MASCARA = '••••';
const JSON_CT = { 'Content-Type': 'application/json' };

async function lerToken(request: APIRequestContext, uuid: string): Promise<Token> {
  const res = await request.get(`/token/${uuid}`, { headers: JSON_ACCEPT });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as Token;
}

/** A assinatura de uma captura assinada com `segredo` confere? */
async function confere(request: APIRequestContext, uuid: string, segredo: string): Promise<boolean | null> {
  const corpo = '{"id":1}';
  const { msg } = await enviarEGuardar(request, uuid, '/conferir', {
    method: 'POST', headers: { ...JSON_CT, 'X-Hub-Signature-256': assinaturaGithub(segredo, corpo) }, data: Buffer.from(corpo),
  });
  return msg.signature?.valid ?? null;
}

/** Textos mascarados que não são a máscara de `SEGREDO` (`••••7Hn4`). */
function mascarasErradas(): Array<[string, string]> {
  return [
    ['a máscara de outra URL', mascarado(SEGREDO_DE_OUTRA)],
    ['a máscara sozinha', MASCARA],
    ['a máscara com outros 4 caracteres', `${MASCARA}0000`],
    ['a máscara certa com algo a mais', `${mascarado(SEGREDO)}x`],
    ['a máscara seguida de um segredo inteiro', `${MASCARA}${SEGREDO_DE_OUTRA}`],
  ];
}

test.describe('máscara gravada como segredo: PUT /token/{id}', () => {
  for (const [caso, secret] of mascarasErradas()) {
    test(`${caso}: 422 em signature.secret, e a URL e o segredo ficam`, async ({ request, tokens }) => {
      const token = await tokens.criar({ default_status: 201, timeout: 1, signature: { provider: 'github', secret: SEGREDO } });
      const antes = await lerToken(request, token.uuid);

      const res = await putToken(request, token.uuid, { default_status: 418, signature: { provider: 'github', secret } });
      const erros = await erros422(res);
      expect(Object.keys(erros), JSON.stringify(erros)).toEqual(['signature.secret']);
      expect(erros['signature.secret'][0]).toMatch(/^[A-Z].*\.$/s);
      expect(JSON.stringify(erros)).not.toContain(SEGREDO);

      expect(await lerToken(request, token.uuid)).toEqual(antes);
      expect(await confere(request, token.uuid, SEGREDO), 'o segredo de antes continua valendo').toBe(true);
      expect(await confere(request, token.uuid, secret), 'o texto mascarado não virou segredo').toBe(false);
    });
  }

  test('o bloco mascarado copiado do GET de outra URL: 422, e nada muda', async ({ request, tokens }) => {
    const a = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const b = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO_DE_OUTRA } });
    const blocoDeB = (await lerToken(request, b.uuid)).signature!;
    expect(blocoDeB.secret).toBe(mascarado(SEGREDO_DE_OUTRA));
    const antes = await lerToken(request, a.uuid);

    const erros = await erros422(await putToken(request, a.uuid, { signature: blocoDeB }));
    expect(erros).toHaveProperty('signature.secret');
    expect(await lerToken(request, a.uuid)).toEqual(antes);
    expect(await confere(request, a.uuid, SEGREDO)).toBe(true);
    expect(await confere(request, a.uuid, blocoDeB.secret)).toBe(false);
  });

  test('URL sem assinatura: texto mascarado não é segredo novo → 422, e a URL segue sem assinatura', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const erros = await erros422(await putToken(request, token.uuid, { signature: { provider: 'github', secret: mascarado(SEGREDO) } }));
    expect(erros).toHaveProperty('signature.secret');
    expect((await lerToken(request, token.uuid)).signature).toBeNull();
  });

  test('continua valendo: a máscara do segredo atual mantém o segredo; segredo novo com • no meio é aceito', async ({ request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const res = await putToken(request, token.uuid, { default_status: 202, signature: { provider: 'github', secret: mascarado(SEGREDO) } });
    expect(res.status(), await res.text()).toBe(200);
    expect(await lerToken(request, token.uuid)).toMatchObject({ default_status: 202, signature: { provider: 'github', secret: mascarado(SEGREDO) } });
    expect(await confere(request, token.uuid, SEGREDO)).toBe(true);

    // Só o COMEÇO com a máscara é recusado: o segredo de verdade pode ter o caractere em outro lugar.
    const comPonto = 'senha•com••••ponto-5Vd8';
    const novo = await putToken(request, token.uuid, { signature: { provider: 'github', secret: comPonto } });
    expect(novo.status(), await novo.text()).toBe(200);
    expect(await confere(request, token.uuid, comPonto)).toBe(true);
  });
});

/** Erro de ferramenta que cita a chave do 422. */
function expectErroNoSegredo(resultado: Awaited<ReturnType<Mcp['chamar']>>, contexto: string): void {
  expect(resultado.isError, `${contexto}: ${textoDo(resultado).slice(0, 300)}`).toBe(true);
  expect(textoDo(resultado), contexto).toContain('signature.secret');
  expect(textoDo(resultado), contexto).not.toContain(SEGREDO);
}

test.describe('máscara gravada como segredo: update_url do MCP', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('texto mascarado que não é a máscara do segredo atual: erro em signature.secret, e nada muda', async ({ mcp, request, tokens }) => {
    const token = await tokens.criar({ default_status: 201, timeout: 1, signature: { provider: 'github', secret: SEGREDO } });
    const antes = await lerToken(request, token.uuid);
    for (const [caso, secret] of mascarasErradas()) {
      expectErroNoSegredo(await mcp.chamar('update_url', { timeout: 2, signature: { provider: 'github', secret } }, token.uuid), caso);
      expect(await lerToken(request, token.uuid), caso).toEqual(antes);
    }
    expect(await confere(request, token.uuid, SEGREDO)).toBe(true);
  });

  test('o bloco mascarado que o get_url mostra de outra URL: erro, e nada muda', async ({ mcp, request, tokens }) => {
    const a = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const b = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO_DE_OUTRA } });
    const blocoDeB = (await mcp.chamarOk<Token>('get_url', {}, b.uuid)).signature!;
    const antes = await lerToken(request, a.uuid);

    expectErroNoSegredo(await mcp.chamar('update_url', { signature: blocoDeB }, a.uuid), 'bloco de outra URL');
    expect(await lerToken(request, a.uuid)).toEqual(antes);
    expect(await confere(request, a.uuid, SEGREDO)).toBe(true);
    expect(await confere(request, a.uuid, blocoDeB.secret)).toBe(false);
  });

  test('continua valendo: o bloco mascarado da própria URL mantém o segredo', async ({ mcp, request, tokens }) => {
    const token = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO } });
    const bloco = (await mcp.chamarOk<Token>('get_url', {}, token.uuid)).signature!;
    await mcp.chamarOk('update_url', { timeout: 2, signature: bloco }, token.uuid);
    expect(await lerToken(request, token.uuid)).toMatchObject({ timeout: 2, signature: { provider: 'github', secret: mascarado(SEGREDO) } });
    expect(await confere(request, token.uuid, SEGREDO)).toBe(true);
  });
});

/** Na criação não há segredo atual: todo texto que começa com a máscara é recusado. */
const MASCARAS_NA_CRIACAO: Array<[string, string]> = [
  ['a máscara de um segredo (o bloco que a API mostra)', mascarado(SEGREDO_DE_OUTRA)],
  ['a máscara sozinha', MASCARA],
  ['a máscara seguida de um segredo inteiro', `${MASCARA}${SEGREDO_DE_OUTRA}`],
];

test.describe('máscara gravada como segredo: criação da URL', () => {
  for (const [caso, secret] of MASCARAS_NA_CRIACAO) {
    test(`POST /token, ${caso}: 422 em signature.secret, e a URL não é criada`, async ({ request, tokens }) => {
      const res = await request.post('/token', { data: { default_status: 201, signature: { provider: 'github', secret } }, headers: JSON_ACCEPT });
      const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      // Se o servidor criou mesmo assim, a URL é registrada para limpeza antes de o teste falhar.
      if (typeof corpo.uuid === 'string') tokens.registrar(corpo.uuid);
      const erros = await erros422(res);
      expect(Object.keys(erros), JSON.stringify(erros)).toEqual(['signature.secret']);
      expect(erros['signature.secret'][0]).toMatch(/^[A-Z].*\.$/s);
      expect(corpo).not.toHaveProperty('uuid');
    });
  }

  test('POST /token com o bloco mascarado copiado do GET de outra URL: 422, e a URL não é criada', async ({ request, tokens }) => {
    const outra = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO_DE_OUTRA } });
    const bloco = (await lerToken(request, outra.uuid)).signature!;
    const res = await request.post('/token', { data: { signature: bloco }, headers: JSON_ACCEPT });
    const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof corpo.uuid === 'string') tokens.registrar(corpo.uuid);
    expect(await erros422(res)).toHaveProperty('signature.secret');
  });

  test('continua valendo: POST /token com segredo novo que tem • no meio cria a URL e confere com ele', async ({ request, tokens }) => {
    const comPonto = 'senha•com••••ponto-8Jc3';
    const token = await tokens.criar({ signature: { provider: 'github', secret: comPonto } });
    expect(await confere(request, token.uuid, comPonto)).toBe(true);
  });
});

test.describe('máscara gravada como segredo: create_url do MCP', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  for (const [caso, secret] of MASCARAS_NA_CRIACAO) {
    test(`${caso}: erro em signature.secret, e a URL não é criada`, async ({ mcp, tokens }) => {
      const resultado = await mcp.chamar('create_url', { default_status: 201, signature: { provider: 'github', secret } });
      if (!resultado.isError) tokens.registrar(jsonDo<Token>(resultado).uuid);
      expect(resultado.isError, `${caso}: ${textoDo(resultado).slice(0, 300)}`).toBe(true);
      expect(textoDo(resultado)).toContain('signature.secret');
      expect(textoDo(resultado), 'nenhuma URL no resultado').not.toMatch(/"uuid"/);
    });
  }

  test('o bloco mascarado que o get_url mostra de outra URL: erro, e a URL não é criada', async ({ mcp, tokens }) => {
    const outra = await tokens.criar({ signature: { provider: 'github', secret: SEGREDO_DE_OUTRA } });
    const bloco = (await mcp.chamarOk<Token>('get_url', {}, outra.uuid)).signature!;
    const resultado = await mcp.chamar('create_url', { signature: bloco });
    if (!resultado.isError) tokens.registrar(jsonDo<Token>(resultado).uuid);
    expect(resultado.isError, textoDo(resultado).slice(0, 300)).toBe(true);
    expect(textoDo(resultado)).toContain('signature.secret');
  });
});

test.describe('create_url do MCP: null nos opcionais vale como ausente', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);
  const PADROES = { default_status: 200, default_content: '', default_content_type: 'text/plain', timeout: 0 };

  for (const campo of Object.keys(PADROES) as Array<keyof typeof PADROES>) {
    test(`${campo}: null → a URL nasce com o padrão`, async ({ mcp, request, tokens }) => {
      const resultado = await mcp.chamar('create_url', { [campo]: null });
      expect(resultado.isError ?? false, textoDo(resultado).slice(0, 300)).toBe(false);
      const criado = jsonDo<Token>(resultado);
      tokens.registrar(criado.uuid);
      expect(criado).toMatchObject(PADROES);
      expect(await lerToken(request, criado.uuid)).toMatchObject(PADROES);
    });
  }

  test('os quatro com null, ao lado de um campo com valor: os padrões e o valor', async ({ mcp, request, tokens }) => {
    const resultado = await mcp.chamar('create_url', {
      default_status: null, default_content: null, default_content_type: null, timeout: null, retry_after: 9,
    });
    expect(resultado.isError ?? false, textoDo(resultado).slice(0, 300)).toBe(false);
    const criado = jsonDo<Token>(resultado);
    tokens.registrar(criado.uuid);
    expect(await lerToken(request, criado.uuid)).toMatchObject({ ...PADROES, retry_after: 9 });
    const res = await request.get(`/${criado.uuid}`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('');
  });

  test('continua valendo: valor inválido é erro de ferramenta com a mensagem da API', async ({ mcp }) => {
    const resultado = await mcp.chamar('create_url', { default_status: null, timeout: 11 });
    expect(resultado.isError, textoDo(resultado).slice(0, 300)).toBe(true);
    expect(textoDo(resultado)).toContain('The timeout may not be greater than 10.');
  });
});

test.describe('update_url do MCP: texto vazio não desliga', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);
  const SCHEMA = { type: 'object', required: ['id'] };

  for (const campo of ['signature', 'schema'] as const) {
    test(`${campo}: "" → erro na chave ${campo}, e nada muda; null desliga`, async ({ mcp, request, tokens }) => {
      const token = await tokens.criar({ timeout: 1, signature: { provider: 'github', secret: SEGREDO }, schema: SCHEMA });
      const antes = await lerToken(request, token.uuid);

      const resultado = await mcp.chamar('update_url', { [campo]: '', timeout: 2 }, token.uuid);
      expect(resultado.isError, textoDo(resultado).slice(0, 300)).toBe(true);
      expect(textoDo(resultado)).toMatch(new RegExp(`\\b${campo}\\b`));
      expect(await lerToken(request, token.uuid)).toEqual(antes);
      expect(await confere(request, token.uuid, SEGREDO)).toBe(true);

      await mcp.chamarOk('update_url', { [campo]: null }, token.uuid);
      const depois = await lerToken(request, token.uuid);
      expect(depois[campo]).toBeNull();
      expect(depois[campo === 'signature' ? 'schema' : 'signature'], 'o outro fica').not.toBeNull();
    });
  }
});

test.describe('update_url do MCP: chamadas simultâneas na mesma URL', () => {
  test.skip(MODO_MCP !== 'ligado', `CONTRATO_MCP=${MODO_MCP}`);

  test('uma liga a assinatura e outra muda o timeout, 20 vezes: as duas mudanças ficam gravadas', async ({ mcp, request, tokens }) => {
    test.setTimeout(120_000);
    const perdidas: string[] = [];
    for (let rodada = 1; rodada <= 20; rodada++) {
      const token = await tokens.criar({ default_status: 201 });
      const [assinatura, prazo] = await Promise.all([
        mcp.chamar('update_url', { signature: { provider: 'github', secret: SEGREDO } }, token.uuid),
        mcp.chamar('update_url', { timeout: 3 }, token.uuid),
      ]);
      // As duas respondem sucesso: nenhuma é recusada por causa da outra.
      expect(assinatura.isError ?? false, `rodada ${rodada}: ${textoDo(assinatura).slice(0, 200)}`).toBe(false);
      expect(prazo.isError ?? false, `rodada ${rodada}: ${textoDo(prazo).slice(0, 200)}`).toBe(false);

      const depois = await lerToken(request, token.uuid);
      const faltou = [
        depois.signature?.provider === 'github' && depois.signature.secret === mascarado(SEGREDO) ? null : 'signature',
        depois.timeout === 3 ? null : 'timeout',
        depois.default_status === 201 ? null : 'default_status',
      ].filter((f) => f !== null);
      if (faltou.length > 0) perdidas.push(`rodada ${rodada}: perdeu ${faltou.join(' e ')}`);
    }
    expect(perdidas, 'mudanças perdidas entre chamadas simultâneas').toEqual([]);
  });
});
