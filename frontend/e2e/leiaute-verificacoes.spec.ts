import { Locator } from '@playwright/test';
import { abrirChecks } from './support/checks';
import { expect, test } from './support/fixtures';

const TELAS_LARGAS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

/**
 * As opções do segmentado que não aparecem inteiras: saem da caixa do grupo (que corta o que passa dela) ou da
 * janela, ou o meio delas não recebe o clique.
 */
async function cortadas(grupo: Locator): Promise<string[]> {
  await grupo.scrollIntoViewIfNeeded();
  return grupo.evaluate((el) => {
    const caixa = el.getBoundingClientRect();
    return [...el.querySelectorAll('[role="radio"]')].flatMap((opcao) => {
      const b = opcao.getBoundingClientRect();
      const meio = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const inteira =
        b.left >= caixa.left - 1 &&
        b.right <= caixa.right + 1 &&
        b.left >= 0 &&
        b.right <= innerWidth &&
        !!meio &&
        opcao.contains(meio);
      return inteira ? [] : [(opcao.textContent ?? '').trim()];
    });
  });
}

test.describe('Dado a configuração do Generic em Verificações', () => {
  test('deve mostrar inteiras e clicáveis as opções de algoritmo e de codificação em toda largura', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: {
        provider: 'generic',
        secret: 'segredo-de-teste',
        header: 'X-Signature',
        algorithm: 'sha256',
        encoding: 'hex',
        prefix: 'sha256=',
      },
    });
    const celular = (page.viewportSize()?.width ?? 1400) < 600;
    const telas = celular ? [page.viewportSize()!] : TELAS_LARGAS;

    for (const tela of telas) {
      await page.setViewportSize(tela);
      const cartao = await abrirChecks(page, tokenId, 'Signature verification');
      const algoritmo = cartao.getByRole('radiogroup', { name: 'Algorithm' });
      const codificacao = cartao.getByRole('radiogroup', { name: 'Encoding' });
      await expect(algoritmo.getByRole('radio')).toHaveText(['SHA-1', 'SHA-256', 'SHA-512']);
      await expect(codificacao.getByRole('radio')).toHaveText(['Hex', 'Base64']);
      expect(await cortadas(algoritmo), `algoritmo a ${tela.width} px`).toEqual([]);
      expect(await cortadas(codificacao), `codificação a ${tela.width} px`).toEqual([]);
    }

    const cartao = await abrirChecks(page, tokenId, 'Signature verification');
    await cartao.getByRole('radio', { name: 'SHA-512' }).click();
    await expect(cartao.getByRole('radio', { name: 'SHA-512' })).toBeChecked();
    await cartao.getByRole('radio', { name: 'Base64' }).click();
    await expect(cartao.getByRole('radio', { name: 'Base64' })).toBeChecked();
  });
});
