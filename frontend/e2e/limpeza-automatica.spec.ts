import { Page } from '@playwright/test';
import { abrirChecks, abrirCreate, escolherLimpeza, salvar } from './support/checks';
import { expect, test, tokenInUrl } from './support/fixtures';

// Limpeza automática: campo nos diálogos da URL, contador com o limite e lista ao vivo
// coerente com o corte FIFO do servidor. Precisa do backend com `auto_cleanup` e `removed`.
// Item 14, E5: o `mat-select` vira `radiogroup "Auto cleanup"` (C §2.6), no "Customize response" do Create e no
// cartão `region "Response"` de Checks (o "Edit URL" deixa de existir). SUPOSIÇÕES em `support/checks.ts`.

/** Volta à Inbox pelo rail (Checks é outra página). */
async function openInbox(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'URL sections' })
    .getByRole('link', { name: 'Inbox', exact: true })
    .click();
}

/** Abre a URL e espera o `EventSource` receber os cabeçalhos (assinatura pronta no servidor). */
async function openListening(page: Page, path: string, tokenId: string): Promise<void> {
  const stream = page.waitForResponse((response) =>
    response.url().endsWith(`/token/${tokenId}/stream`),
  );
  await page.goto(path);
  expect((await stream).status()).toBe(200);
}

test.describe('Dado o campo "Auto cleanup" do Create e de Checks', () => {
  test('deve criar a URL com o limite escolhido e mostrá-lo no contador Quando Create é clicado', async ({
    page,
    tokens,
  }) => {
    const original = await tokens.create();
    await page.goto(`/#/${original}`);

    const dialog = await abrirCreate(page);
    await expect(
      dialog
        .getByRole('radiogroup', { name: 'Auto cleanup' })
        .getByRole('radio', { name: 'Disabled', exact: true }),
    ).toBeChecked();
    await escolherLimpeza(dialog, '1000');
    await expect(dialog.getByText('Keeps the 1000 most recent requests')).toBeVisible();
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('New URL created')).toBeVisible();
    // A mensagem aparece antes de a rota trocar: espera sair da URL de origem antes de ler o token.
    await expect(page).not.toHaveURL(new RegExp(original));
    const novo = tokenInUrl(page);
    tokens.track(novo);
    expect(await tokens.read(novo)).toMatchObject({ auto_cleanup: 1000 });
    await expect(page.getByRole('heading', { name: 'Requests (0 / 1000)' })).toBeVisible();
  });

  test('deve desligar a limpeza Quando Disabled é escolhido em Checks (o PUT leva auto_cleanup nulo)', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ auto_cleanup: 500 });
    await page.goto(`/#/${tokenId}`);
    await expect(page.getByRole('heading', { name: 'Requests (0 / 500)' })).toBeVisible();

    const dialog = await abrirChecks(page, tokenId, 'Response');
    await expect(
      dialog
        .getByRole('radiogroup', { name: 'Auto cleanup' })
        .getByRole('radio', { name: '500', exact: true }),
    ).toBeChecked();
    await escolherLimpeza(dialog, 'Disabled');
    const put = await salvar(page, dialog, 'Save response', tokenId);

    expect(put).toMatchObject({ auto_cleanup: null, retry_after: null });
    expect(await tokens.read(tokenId)).toMatchObject({ auto_cleanup: null });
    await openInbox(page);
    await expect(page.getByRole('heading', { name: 'Requests (0)' })).toBeVisible();
  });
});

test.describe('Dado uma URL cheia com a mensagem mais antiga aberta', () => {
  test.setTimeout(120_000);

  test('deve tirar a cortada, abrir a seguinte e manter o contador Quando chega mais uma ao vivo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ auto_cleanup: 500 });
    await tokens.sendMany(tokenId, 500);
    const [antiga, seguinte] = await tokens.listed(tokenId);
    await openListening(page, `/#/${tokenId}/${antiga.uuid}/1`, tokenId);
    const details = page.getByRole('table', { name: 'Request Details' });
    await expect(details).toContainText(antiga.uuid);
    await expect(page.getByRole('heading', { name: 'Requests (500 / 500)' })).toBeVisible();

    await tokens.send(tokenId);

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${seguinte.uuid}/1$`));
    await expect(details).toContainText(seguinte.uuid);
    await expect(page.getByRole('button', { name: `Delete request ${antiga.uuid}` })).toHaveCount(
      0,
    );
    await expect(page.getByRole('heading', { name: 'Requests (500 / 500)' })).toBeVisible();

    await page.reload();
    await expect(details).toContainText(seguinte.uuid);
    await expect(page.getByRole('button', { name: `Delete request ${antiga.uuid}` })).toHaveCount(
      0,
    );
    await expect(page.getByRole('heading', { name: 'Requests (500 / 500)' })).toBeVisible();
  });

  // Item 14, E5 — cenário trocado: o limite muda em Checks (outra página, não um diálogo sobre a Inbox); ao voltar
  // à Inbox a lista vem cortada e o detalhe mostra a mais próxima que ficou.
  test('deve recarregar a lista e abrir a mais próxima Quando o limite é reduzido em Checks', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 505);
    const ordem = await tokens.listed(tokenId);
    const [antiga, primeiraQueFica] = [ordem[0], ordem[5]];
    await page.goto(`/#/${tokenId}/${antiga.uuid}/1`);
    const details = page.getByRole('table', { name: 'Request Details' });
    await expect(details).toContainText(antiga.uuid);
    await expect(page.getByRole('heading', { name: 'Requests (505)' })).toBeVisible();

    const resposta = await abrirChecks(page, tokenId, 'Response');
    await escolherLimpeza(resposta, '500');
    await salvar(page, resposta, 'Save response', tokenId);
    await openInbox(page);

    await expect(page.getByRole('heading', { name: 'Requests (500 / 500)' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}(/${primeiraQueFica.uuid}/1)?$`));
    await expect(details).toContainText(primeiraQueFica.uuid);
    for (const cortada of ordem.slice(0, 5)) {
      await expect(
        page.getByRole('button', { name: `Delete request ${cortada.uuid}` }),
      ).toHaveCount(0);
    }
  });
});
