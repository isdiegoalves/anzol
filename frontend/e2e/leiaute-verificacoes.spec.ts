import { Locator } from '@playwright/test';
import { abrirCartao, abrirChecks, secao } from './support/checks';
import { politica, signatario } from './support/e2ee';
import { expect, test } from './support/fixtures';
import { seedStorage } from './support/storage';

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

test.describe('Dado Verificações a 375 px com a decifra ligada', () => {
  test('não deve rolar na horizontal com o cartão da decifra e o da Privacidade abertos', async ({
    page,
    tokens,
  }) => {
    const segredo = 'segredo-do-leiaute';
    const tokenId = await tokens.create({ read_secret: segredo });
    const comSegredo = { 'X-Anzol-Secret': segredo };
    expect(
      (
        await page.request.post(`/token/${tokenId}/keys`, { headers: comSegredo, data: {} })
      ).status(),
    ).toBe(201);
    const ligada = await page.request.put(`/token/${tokenId}`, {
      headers: comSegredo,
      data: { e2ee: politica([signatario('sig-leiaute').publica]) },
    });
    expect(ligada.status()).toBe(200);
    await seedStorage(page, { hideTutorial: 'true' });
    expect(
      (await page.request.post(`/token/${tokenId}/unlock`, { data: { secret: segredo } })).ok(),
    ).toBe(true);

    await page.setViewportSize({ width: 375, height: 812 });
    const decifra = await abrirChecks(page, tokenId, 'E2EE decryption');
    await expect(decifra.getByRole('textbox', { name: 'Encrypted attribute' })).toBeVisible();
    await abrirCartao(page, 'Privacy');
    await expect(secao(page, 'Privacy').getByRole('switch')).toBeVisible();

    const larguras = await page.evaluate(() => {
      const cartoes = document.querySelector('main .cards');
      // Faixa que rola sozinha, como o índice no topo, não empurra a página.
      const naFaixa = (el: Element) => {
        for (let pai = el.parentElement; pai && pai !== cartoes; pai = pai.parentElement) {
          if (/auto|scroll|hidden/.test(getComputedStyle(pai).overflowX)) {
            return true;
          }
        }
        return false;
      };
      const examinados = [...(cartoes?.querySelectorAll('*') ?? [])]
        .filter((el) => !el.closest('.cdk-visually-hidden, [aria-hidden="true"]'))
        .filter((el) => !naFaixa(el));
      return {
        pagina: document.scrollingElement?.scrollWidth ?? 0,
        cartoes: (cartoes?.scrollWidth ?? 0) - (cartoes?.clientWidth ?? 0),
        janela: innerWidth,
        examinados: examinados.length,
        transbordam: examinados
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`),
      };
    });
    expect(larguras.pagina).toBeLessThanOrEqual(larguras.janela);
    expect(larguras.cartoes).toBeLessThanOrEqual(0);
    expect(larguras.examinados).toBeGreaterThan(100);
    expect(larguras.transbordam).toEqual([]);
  });
});
