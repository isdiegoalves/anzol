import { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test } from './support/caos';
import { editor } from './support/regras';
import { seedStorage } from './support/storage';

type Regra = Record<string, unknown>;

const regra = (name: string): Regra => ({
  name,
  enabled: true,
  priority: 5,
  match: { method: ['POST'] },
  response: { status: 201, headers: {}, body: '' },
});

async function gravar(api: APIRequestContext, tokenId: string, rules: Regra[]): Promise<Regra[]> {
  const response = await api.put(`/token/${tokenId}/rules`, { data: rules });
  expect(response.status()).toBe(200);
  return (await response.json()) as Regra[];
}

async function noServidor(api: APIRequestContext, tokenId: string): Promise<unknown[][]> {
  return ((await (await api.get(`/token/${tokenId}/rules`)).json()) as Regra[]).map((r) => [
    r['name'],
    r['priority'],
  ]);
}

const conflito = (page: Page): Locator =>
  page.getByRole('alert').filter({ hasText: 'The rules changed elsewhere' });

/** B renomeada para B2 no editor; outra aba dá prioridade 1 a B; o primeiro Save recebe o aviso. */
async function comConflito(page: Page, tokenId: string): Promise<Locator> {
  const [a, b] = await gravar(page.request, tokenId, [regra('A'), regra('B')]);
  await seedStorage(page, {});
  await page.goto(`/#/${tokenId}/rules/${String(b['id'])}`);
  const edicao = editor(page, 'Edit rule B');
  await expect(edicao).toBeVisible();
  await page.waitForLoadState('networkidle');
  await edicao.getByRole('textbox', { name: 'Name', exact: true }).fill('B2');
  await gravar(page.request, tokenId, [{ ...b, priority: 1 }, a]);
  await edicao.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(conflito(page)).toBeVisible();
  return edicao;
}

test.describe('Dado o Reload do aviso "changed elsewhere" com o servidor lento', () => {
  for (const [caso, atraso, pausa] of [
    ['o Save logo depois do Reload', 1500, 0],
    ['o Save 400 ms depois do Reload, no ritmo de quem lê', 2000, 400],
  ] as const) {
    test(`não deve gravar a lista velha por cima da prioridade da outra aba Quando ${caso}`, async ({
      page,
      tokens,
      caos,
    }) => {
      const tokenId = await tokens.create();
      const edicao = await comConflito(page, tokenId);
      const desfaz = caos.atrasar(new RegExp(`^/token/${tokenId}/rules$`), atraso, 'GET');
      let leituras = 0;
      page.on('response', (r) => {
        if (r.request().method() === 'GET' && r.url().endsWith(`/token/${tokenId}/rules`)) {
          leituras++;
        }
      });

      await conflito(page).getByRole('button', { name: 'Reload' }).click();
      if (pausa) {
        await page.waitForTimeout(pausa);
      }
      const salvar = edicao.getByRole('button', { name: 'Save', exact: true });
      await salvar.click();
      await expect.poll(() => leituras, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
      // O Save termina: recusado pela conferência (fica no editor) ou gravado (o editor fecha).
      await expect
        .poll(() => salvar.getAttribute('aria-busy', { timeout: 500 }).catch(() => 'fechou'), {
          timeout: 10_000,
        })
        .not.toBe('true');

      expect(await noServidor(page.request, tokenId)).toEqual([
        ['B', 1],
        ['A', 5],
      ]);
      desfaz();
      if (await conflito(page).isVisible()) {
        await conflito(page).getByRole('button', { name: 'Reload' }).click();
      }
      await expect(conflito(page)).toHaveCount(0);
      await edicao.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(edicao).toBeHidden();

      expect(await noServidor(page.request, tokenId)).toEqual([
        ['B2', 1],
        ['A', 5],
      ]);
    });
  }
});
