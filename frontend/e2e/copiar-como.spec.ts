import { expect, test } from './support/fixtures';
import { acoes } from './support/inbox';

// Checklist 10. Item 14, E4: "Copy As" e "Copy payload" ficam no grupo copiar do `toolbar "Request actions"` (§1);
// o "Copy As" carrega sob demanda (`@defer (on interaction)`), com os mesmos `menuitem` "curl" e "HAR".

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
    await acoes(page)
      .getByRole('button', { name: /Copy As/ })
      .click();
    await page.getByRole('menuitem', { name: 'curl' }).click();
    await expect(page.getByText('Copied request as curl')).toBeVisible();
    const curl = await page.evaluate(() => navigator.clipboard.readText());
    expect(curl).toMatch(/^curl -X 'POST' 'http:\/\/[^']+\/extra\/path\?[^']*' /);
    expect(curl).toContain(" -H 'x-custom: abc'");
    expect(curl).toContain(` -d $'{"a":12345678901234567890,"b":[1,2]}'`);

    await acoes(page)
      .getByRole('button', { name: /Copy As/ })
      .click();
    await page.getByRole('menuitem', { name: 'HAR' }).click();
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
