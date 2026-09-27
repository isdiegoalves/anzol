import type { APIRequestContext, APIResponse } from '@playwright/test';
import { JSON_ACCEPT, enviarEGuardar, expect, test } from '../../support/contrato.js';
import { hmac, type Algoritmo, type Codificacao } from '../../support/assinatura.js';
import {
  erros422, lerRegras, putRegras, salvarRegras, testarRegra, testarRegraComRender,
  type RespostaRegra, type ResultadoTesteComRender,
} from '../../support/regras.js';

// UX de Regras, C5 (WM-45, nota do dono "reaproveitando a URL"; `.docs-arquivo/regras-ux/api-contrato.md`): helper
// `{{hmac <valor> [algorithm="sha256"] [encoding="hex"]}}` no template da resposta. Assina `<valor>` com o segredo de
// verificação de assinatura configurado na própria URL (`signature.secret`, o mesmo que verifica o HMAC de entrada).
// Algoritmos sha1, sha256, sha512; encodings hex, base64. URL sem segredo: o trecho sai vazio. Algoritmo ou encoding
// inválido: 422 ao salvar e ao testar, com linha e coluna. O segredo nunca aparece na resposta, em erro nem no render.
//
// O HMAC esperado é calculado aqui com `node:crypto`, a partir do segredo configurado pelo `PUT /token/{id}`.
// SUPOSIÇÃO: o valor é assinado como texto UTF-8 (o `request.body` do template é o corpo como texto).

const SEGREDO = 'segredo-do-hmac-da-url-7Qx2';

/** Configura (ou troca) o segredo da URL pelo `PUT /token/{id}`. */
async function configurarSegredo(request: APIRequestContext, tokenId: string, segredo: string | null): Promise<void> {
  const signature = segredo === null ? null : { provider: 'github', secret: segredo };
  const res = await request.put(`/token/${tokenId}`, { data: { signature }, headers: JSON_ACCEPT });
  expect(res.status(), `PUT /token/{id}: ${(await res.text()).slice(0, 300)}`).toBe(200);
}

async function urlComSegredo(tokens: { criar(): Promise<{ uuid: string }> }, request: APIRequestContext, segredo = SEGREDO): Promise<string> {
  const t = (await tokens.criar()).uuid;
  await configurarSegredo(request, t, segredo);
  return t;
}

/** Salva uma regra que casa tudo com a resposta dada e dispara um POST de texto com `corpo`. */
async function responder(request: APIRequestContext, tokenId: string, resposta: RespostaRegra, corpo: string): Promise<APIResponse> {
  await salvarRegras(request, tokenId, [{ name: 'hmac', response: { status: 200, ...resposta } }]);
  const res = await request.post(`/${tokenId}/assinar`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' }, data: Buffer.from(corpo, 'utf8') });
  expect(res.status(), (await res.text()).slice(0, 300)).toBe(200);
  return res;
}

const utf8 = (texto: string): Buffer => Buffer.from(texto, 'utf8');

test.describe('C5: helper hmac', () => {
  test('{{hmac request.body}}: HMAC-SHA256 em hex com o segredo da URL; sem template, literal', async ({ request, tokens }) => {
    const t = await urlComSegredo(tokens, request);
    const corpo = 'pedido-123 ação ✓ {"a":1}';
    const literal = await responder(request, t, { body: '{{hmac request.body}}', template: false }, corpo);
    expect(await literal.text()).toBe('{{hmac request.body}}');

    const res = await responder(request, t, { body: '{{hmac request.body}}', template: true }, corpo);
    expect(await res.text()).toBe(hmac('sha256', SEGREDO, utf8(corpo), 'hex'));
  });

  const ALGORITMOS: Algoritmo[] = ['sha1', 'sha256', 'sha512'];
  const CODIFICACOES: Codificacao[] = ['hex', 'base64'];
  test('algorithm sha1, sha256, sha512 × encoding hex, base64', async ({ request, tokens }) => {
    const t = await urlComSegredo(tokens, request);
    const corpo = '{"evento":"pago","valor":10}';
    for (const algoritmo of ALGORITMOS) {
      for (const codificacao of CODIFICACOES) {
        const body = `{{hmac request.body algorithm="${algoritmo}" encoding="${codificacao}"}}`;
        const res = await responder(request, t, { body, template: true }, corpo);
        expect(await res.text(), `${algoritmo}/${codificacao}`).toBe(hmac(algoritmo, SEGREDO, utf8(corpo), codificacao));
      }
    }
    // Só um dos dois: o outro fica no padrão.
    const soEncoding = await responder(request, t, { body: '{{hmac request.body encoding="base64"}}', template: true }, corpo);
    expect(await soEncoding.text()).toBe(hmac('sha256', SEGREDO, utf8(corpo), 'base64'));
    const soAlgoritmo = await responder(request, t, { body: '{{hmac request.body algorithm="sha1"}}', template: true }, corpo);
    expect(await soAlgoritmo.text()).toBe(hmac('sha1', SEGREDO, utf8(corpo), 'hex'));
  });

  test('qualquer expressão do template, também nos cabeçalhos da resposta', async ({ request, tokens }) => {
    const t = await urlComSegredo(tokens, request);
    const corpo = '{"id":42}';
    const res = await responder(request, t, {
      headers: { 'X-Assinatura': 'sha256={{hmac request.body}}' },
      body: '{{hmac "abc"}}|{{hmac request.method}}|{{hmac (jsonPath request.body \'$.id\')}}',
      template: true,
    }, corpo);
    // SUPOSIÇÃO: valor que não é texto (o número 42 do jsonPath) é assinado como o template o escreveria ("42").
    expect((await res.text()).split('|')).toEqual([
      hmac('sha256', SEGREDO, utf8('abc')),
      hmac('sha256', SEGREDO, utf8('POST')),
      hmac('sha256', SEGREDO, utf8('42')),
    ]);
    expect(res.headers()['x-assinatura']).toBe(`sha256=${hmac('sha256', SEGREDO, utf8(corpo))}`);
  });

  test('o segredo é o atual da URL: trocar pelo PUT muda o HMAC; sem segredo o trecho sai vazio', async ({ request, tokens }) => {
    const t = await urlComSegredo(tokens, request);
    const body = 'a[{{hmac request.body}}]b';
    const corpo = 'mesmo corpo';
    expect(await (await responder(request, t, { body, template: true }, corpo)).text()).toBe(`a[${hmac('sha256', SEGREDO, utf8(corpo))}]b`);

    const outro = 'outro-segredo-da-url-9Kd1';
    await configurarSegredo(request, t, outro);
    expect(await (await responder(request, t, { body, template: true }, corpo)).text()).toBe(`a[${hmac('sha256', outro, utf8(corpo))}]b`);

    await configurarSegredo(request, t, null);
    expect(await (await responder(request, t, { body, template: true }, corpo)).text()).toBe('a[]b');

    // URL que nunca teve segredo: o mesmo.
    const nunca = (await tokens.criar()).uuid;
    expect(await (await responder(request, nunca, { body, template: true }, corpo)).text()).toBe('a[]b');
  });

  test('o segredo nunca aparece: resposta, cabeçalhos, regras salvas e render do rules/test', async ({ request, tokens }) => {
    const t = await urlComSegredo(tokens, request);
    const corpo = '{"pedido":7}';
    const res = await responder(request, t, { headers: { 'X-Assinatura': '{{hmac request.body}}' }, body: '{{hmac request.body}}', template: true }, corpo);
    expect(await res.text()).not.toContain(SEGREDO);
    expect(JSON.stringify(res.headers())).not.toContain(SEGREDO);
    expect(JSON.stringify(await lerRegras(request, t))).not.toContain(SEGREDO);

    // C4 + C5: o render assina a mensagem gravada com o segredo da URL e não o mostra.
    const { msg } = await enviarEGuardar(request, t, '/outra', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: Buffer.from(corpo) });
    const render = await testarRegraComRender(request, t, { name: 'hmac', match: { path: { equals: '/outra' } }, response: { body: '{{hmac request.body}}', template: true } }, 1);
    expect(render.status(), (await render.text()).slice(0, 300)).toBe(200);
    const texto = await render.text();
    expect(texto).not.toContain(SEGREDO);
    const { rendered } = JSON.parse(texto) as ResultadoTesteComRender;
    expect(rendered).toEqual([{ uuid: msg.uuid, status: 200, headers: expect.any(Object), body: hmac('sha256', SEGREDO, utf8(corpo)) }]);
  });
});

test.describe('C5: validação', () => {
  /** Caso, argumento inválido e o mesmo argumento com um valor válido. */
  const INVALIDOS: Array<[string, string, string]> = [
    ['algoritmo md5', 'algorithm="md5"', 'algorithm="sha256"'],
    ['algoritmo desconhecido', 'algorithm="sha384x"', 'algorithm="sha512"'],
    ['encoding base32', 'encoding="base32"', 'encoding="base64"'],
    ['encoding vazio', 'encoding=""', 'encoding="hex"'],
  ];
  for (const [caso, argumento, valido] of INVALIDOS) {
    test(`${caso}: 422 ao salvar e ao testar, com linha e coluna, sem o segredo`, async ({ request, tokens }) => {
      const t = await urlComSegredo(tokens, request);
      // O mesmo template com o valor válido é aceito: o 422 abaixo é pelo valor, não pelo helper.
      await salvarRegras(request, t, [{ name: 'hmac bom', response: { body: `primeira linha\n{{hmac request.body ${valido}}}`, template: true } }]);
      await salvarRegras(request, t, []);

      const body = `primeira linha\n{{hmac request.body ${argumento}}}`;
      const regra = { name: 'hmac ruim', response: { body, template: true } };

      const res = await putRegras(request, t, [regra]);
      const texto = await res.text();
      expect(texto).not.toContain(SEGREDO);
      const corpo = await erros422(res);
      expect(Object.keys(corpo), JSON.stringify(corpo)).toEqual(['0.response.body']);
      // A forma de "linha e coluna" é a do 422 de template de hoje: "(line N, column M)".
      expect(corpo['0.response.body'].some((m) => /^The template is invalid/.test(m) && /line 2\b/.test(m) && /column \d+/.test(m)), JSON.stringify(corpo)).toBe(true);
      expect(await lerRegras(request, t)).toEqual([]);

      const teste = await testarRegra(request, t, regra);
      expect(await teste.text()).not.toContain(SEGREDO);
      const doTeste = await erros422(teste);
      const chave = Object.keys(doTeste).find((k) => /(^|\.)response\.body$/.test(k));
      expect(chave, JSON.stringify(doTeste)).toBeDefined();
      expect(doTeste[chave!].some((m) => /line 2\b/.test(m) && /column \d+/.test(m)), JSON.stringify(doTeste)).toBe(true);
      expect(JSON.stringify(doTeste)).not.toContain(SEGREDO);
    });
  }

  test('algoritmo e encoding válidos são aceitos ao salvar, com e sem segredo na URL', async ({ request, tokens }) => {
    const semSegredo = (await tokens.criar()).uuid;
    const comSegredo = await urlComSegredo(tokens, request);
    const body = '{{hmac request.body algorithm="sha512" encoding="base64"}}{{hmac "x" algorithm="sha1" encoding="hex"}}';
    for (const t of [semSegredo, comSegredo]) {
      const [salva] = await salvarRegras(request, t, [{ name: 'ok', response: { body, template: true } }]);
      expect(salva.response.body).toBe(body);
    }
  });
});
