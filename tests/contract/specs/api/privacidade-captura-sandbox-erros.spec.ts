import { randomUUID } from 'node:crypto';
import type { APIResponse } from '@playwright/test';
import { JSON_ACCEPT, expect, listar, test } from '../../support/contrato.js';
import { salvarRegras } from '../../support/regras.js';

// Decisões do Anzol, T3 (`.docs-arquivo/decisoes-anzol/api.md`): as respostas de ERRO servidas num caminho de captura
// (`/{uuid}` e `/{uuid}/…`, qualquer método) levam o mesmo `Content-Security-Policy: sandbox …` das demais, sem
// `allow-same-origin` (privacidade-captura-sandbox.spec.ts cobre as de sucesso). Sondado no app antes da correção,
// todas saíam sem CSP: 410 (URL inexistente, página HTML ou envelope JSON), 413 (corpo acima de 1 MiB, página do nginx),
// 400 (linha de cabeçalho acima de 8 KB, página do nginx) e 500 (template da regra que passa dos tetos). O 507 (Redis
// cheio) não se provoca pela API e fica com o teste do backend; o erro das rotas `/token/…` fica livre.

const SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals';

function expectSandbox(res: APIResponse, contexto: string): void {
  const valores = res.headersArray().filter((h) => h.name.toLowerCase() === 'content-security-policy').map((h) => h.value);
  expect(valores, `${contexto}: ${JSON.stringify(valores)}`).toContain(SANDBOX);
  for (const v of valores) expect(v, `${contexto}: nenhum CSP libera a origem do app`).not.toMatch(/allow-same-origin/i);
}

test.describe('T3: CSP sandbox nas respostas de erro da captura', () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
    test(`410 de URL inexistente, ${method}, cliente comum e cliente JSON: com o CSP sandbox`, async ({ request }) => {
      const nunca = randomUUID();
      for (const [cliente, headers] of [['comum', {}], ['JSON', JSON_ACCEPT]] as const) {
        for (const caminho of ['', '/caminho/qualquer?x=1']) {
          const res = await request.fetch(`/${nunca}${caminho}`, { method, headers });
          expect(res.status(), `${method} ${cliente} ${caminho}`).toBe(410);
          expectSandbox(res, `410 ${method} ${cliente} ${caminho}`);
        }
      }
    });
  }

  test('410 de URL apagada: com o CSP sandbox', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    expect((await request.delete(`/token/${t}`, { headers: JSON_ACCEPT })).status()).toBe(204);
    const res = await request.post(`/${t}/depois`, { data: Buffer.from('<script>1</script>'), headers: { 'Content-Type': 'text/html' } });
    expect(res.status()).toBe(410);
    expectSandbox(res, '410 depois de apagar');
  });

  test('413 de corpo acima de 1 MiB: com o CSP sandbox; nada gravado', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    for (const caminho of ['', '/grande']) {
      const res = await request.post(`/${t}${caminho}`, { data: Buffer.alloc(1024 * 1024 + 1, 'a') });
      expect(res.status()).toBe(413);
      expectSandbox(res, `413 ${caminho}`);
    }
    expect((await listar(request, t)).total).toBe(0);
  });

  test('400 de linha de cabeçalho acima de 8 KB: com o CSP sandbox', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    const res = await request.get(`/${t}/x`, { headers: { 'X-Grande': 'a'.repeat(8_200) } });
    expect(res.status()).toBe(400);
    expectSandbox(res, '400 de cabeçalho');
  });

  test('500 do template que passa dos tetos: com o CSP sandbox', async ({ request, tokens }) => {
    const t = (await tokens.criar()).uuid;
    await salvarRegras(request, t, [{ name: 'estoura', response: { status: 201, body: '{{request.body}}{{request.body}}', template: true } }]);
    const res = await request.post(`/${t}/grande`, { data: Buffer.alloc(600 * 1024, 'a'), headers: { 'Content-Type': 'text/plain' } });
    expect(res.status()).toBe(500);
    expectSandbox(res, '500 do template');
  });
});
