import { expect, test } from './support/fixtures';
import { Page } from '@playwright/test';
import { acoes } from './support/inbox';

// Checklist 10: "Copy payload" fica na barra de ações; o "Copy As" está no menu "More" do detalhe, com os formatos
// "curl" e "HAR" no submenu, no desktop e no celular.

async function abrirCopyAs(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copy As' }).click();
}

test.describe('Dado uma mensagem JSON aberta (checklist 10)', () => {
  let tokenId: string;

  test.beforeEach(async ({ page, tokens }) => {
    tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, {
      method: 'POST',
      path: '/extra/path?x=1&y=',
      headers: { 'content-type': 'application/json', 'x-custom': 'abc' },
      data: '{"a":12345678901234567890,"b":[1,2]}',
    });
    await page.goto(`/#/${tokenId}/${requestId}/1`);
  });

  test('deve copiar o curl e o HAR Quando "Copy As" é usado', async ({ page }) => {
    await abrirCopyAs(page);
    await page.getByRole('menuitem', { name: 'curl', exact: true }).click();
    await expect(page.getByText('Copied request as curl')).toBeVisible();
    const curl = await page.evaluate(() => navigator.clipboard.readText());
    expect(curl).toMatch(/^curl -X 'POST' 'http:\/\/[^']+\/extra\/path\?[^']*' /);
    expect(curl).toContain(" -H 'x-custom: abc'");
    expect(curl).toContain(` -d $'{"a":12345678901234567890,"b":[1,2]}'`);

    await abrirCopyAs(page);
    await page.getByRole('menuitem', { name: 'HAR', exact: true }).click();
    const har = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(har.log.version).toBe('1.2');
    expect(har.log.entries[0].request.method).toBe('POST');
    expect(har.log.entries[0].request.postData).toEqual({
      mimeType: 'application/json',
      text: '{"a":12345678901234567890,"b":[1,2]}',
    });
  });

  test('deve copiar o corpo exatamente como chegou Quando "Copy payload" é clicado', async ({
    page,
  }) => {
    await acoes(page).getByRole('button', { name: 'Copy payload' }).click();
    await expect(page.getByText('Copied payload')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      '{"a":12345678901234567890,"b":[1,2]}',
    );
  });
});
