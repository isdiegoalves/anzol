import type { APIResponse } from '@playwright/test';
import { expect, test } from '../../support/contrato.js';
import { salvarRegras } from '../../support/regras.js';

// Captura isolada (reauditoria do item 12, decisão N2 do dono, 2026-09-26): a tela, a API e a captura servem pelo
// mesmo endereço; sem isolamento, uma captura que responde HTML com script roda na origem da tela (lê o `localStorage`
// e chama a API com o cookie de desbloqueio). Toda resposta da captura traz
// `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals`, sem `allow-same-origin`,
// na resposta padrão da URL e na de regra; uma regra que define o próprio CSP não o tira (o navegador aplica todos).

const SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals';
const HTML = '<script>fetch("/token/" + JSON.parse(localStorage.token).uuid + "/requests")</script>';

/** Todos os valores de `Content-Security-Policy` da resposta (o cabeçalho pode vir repetido). */
function csps(res: APIResponse): string[] {
  return res.headersArray().filter((h) => h.name.toLowerCase() === 'content-security-policy').map((h) => h.value);
}

function expectSandbox(res: APIResponse): void {
  const valores = csps(res);
  expect(valores, JSON.stringify(valores)).toContain(SANDBOX);
  for (const v of valores) expect(v, 'nenhum CSP libera a origem do app').not.toMatch(/allow-same-origin/i);
}

test.describe('captura isolada por CSP sandbox', () => {
  for (const method of ['GET', 'POST', 'HEAD']) {
    test(`resposta padrão da URL (HTML com script), ${method}: CSP sandbox sem allow-same-origin`, async ({ request, tokens }) => {
      const token = await tokens.criar({ default_content_type: 'text/html', default_content: HTML });
      const res = await request.fetch(`/${token.uuid}/pagina`, { method });
      expect(res.status()).toBe(200);
      expectSandbox(res);
    });
  }

  test('resposta de regra (HTML com script): CSP sandbox sem allow-same-origin', async ({ request, tokens }) => {
    const token = await tokens.criar();
    await salvarRegras(request, token.uuid, [{ name: 'html', response: { status: 201, headers: { 'Content-Type': 'text/html' }, body: HTML } }]);
    const res = await request.get(`/${token.uuid}/pagina`);
    expect(res.status()).toBe(201);
    expect(await res.text()).toBe(HTML);
    expectSandbox(res);
  });

  test('regra com o próprio Content-Security-Policy: o dela sai e o sandbox sai também', async ({ request, tokens }) => {
    const token = await tokens.criar();
    const proprio = "default-src 'self' 'unsafe-inline'";
    await salvarRegras(request, token.uuid, [
      { name: 'csp', response: { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': proprio }, body: HTML } },
    ]);
    const res = await request.get(`/${token.uuid}`);
    expect(res.status()).toBe(200);
    expect(csps(res)).toContain(proprio);
    expectSandbox(res);
  });
});
