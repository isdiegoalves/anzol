import { expect, test } from './support/fixtures';
import { FUNDO_CLARO, FUNDO_ESCURO, configuracoes, luminanciaDoFundo, tema } from './support/shell';

// Item 14, E1 e E3 (CA-10): tema Harbor claro e escuro, seguindo o sistema por padrão e trocável em Settings, com a
// escolha guardada. O teste mede o fundo que o usuário vê, não a classe ou a variável que o produz.

test.describe('Dado o tema da tela', () => {
  test('deve seguir o sistema: fundo escuro com prefers-color-scheme dark e claro com light', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const url = page.getByRole('textbox', { name: 'Webhook URL' });

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/#/${tokenId}`);
    await expect(url).toBeVisible();
    await expect
      .poll(() => luminanciaDoFundo(page), { message: 'fundo no escuro' })
      .toBeLessThan(FUNDO_ESCURO);

    await page.emulateMedia({ colorScheme: 'light' });
    await expect
      .poll(() => luminanciaDoFundo(page), { message: 'fundo no claro' })
      .toBeGreaterThan(FUNDO_CLARO);
  });

  test('deve trocar para o escuro em Settings, manter depois de recarregar e voltar ao sistema', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`/#/${tokenId}`);
    await expect(configuracoes(page)).toBeVisible();

    await configuracoes(page).click();
    await expect(tema(page).getByRole('radio', { name: 'System' })).toBeChecked();
    await tema(page).getByRole('radio', { name: 'Dark' }).check();
    await expect
      .poll(() => luminanciaDoFundo(page), { message: 'Dark em Settings' })
      .toBeLessThan(FUNDO_ESCURO);

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toBeVisible();
    await expect
      .poll(() => luminanciaDoFundo(page), { message: 'Dark depois de recarregar' })
      .toBeLessThan(FUNDO_ESCURO);

    await configuracoes(page).click();
    await expect(tema(page).getByRole('radio', { name: 'Dark' })).toBeChecked();
    await tema(page).getByRole('radio', { name: 'System' }).check();
    await expect
      .poll(() => luminanciaDoFundo(page), { message: 'System com o sistema claro' })
      .toBeGreaterThan(FUNDO_CLARO);
  });
});
