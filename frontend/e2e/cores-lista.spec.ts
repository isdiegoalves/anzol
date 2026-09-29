import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirItem, item } from './support/inbox';
import { gravarRegras } from './support/regras';
import { seedStorage } from './support/storage';

const SEGREDO = 'segredo-das-cores';
const SEM_FUNDO = 'rgba(0, 0, 0, 0)';

function fundo(alvo: Locator): Promise<string> {
  return alvo.evaluate((el) => getComputedStyle(el).backgroundColor);
}

function assinado(corpo: string, segredo = SEGREDO): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Hub-Signature-256': `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`,
  };
}

const selo = (page: Page, uuid: string, tipo: 'signature' | 'schema' | 'rule') =>
  item(page, uuid).locator(`app-check-chip[data-kind="${tipo}"]`);

test.describe('Dado a lista da Entrada com métodos, verificações e respostas diferentes', () => {
  test('deve pintar em tom claro o método, a assinatura, o schema e o status, só na lista', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      default_status: '429',
      signature: { provider: 'github', secret: SEGREDO },
      schema: { type: 'object', required: ['id'] },
    });
    await gravarRegras(page.request, tokenId, [
      {
        name: 'Pago',
        priority: 1,
        match: { path: { equals: '/pago' } },
        response: { status: 201 },
      },
      { name: 'Cai', priority: 2, match: { path: { equals: '/cai' } }, response: { status: 503 } },
    ]);
    const valida = await tokens.send(tokenId, {
      path: '/pago',
      headers: assinado('{"id":1}'),
      data: '{"id":1}',
    });
    const invalida = await tokens.send(tokenId, {
      method: 'DELETE',
      path: '/outro',
      headers: assinado('{"x":1}', 'outro-segredo'),
      data: '{"x":1}',
    });
    const ausente = await tokens.send(tokenId, {
      method: 'PATCH',
      path: '/cai',
      headers: { 'Content-Type': 'application/json' },
      data: '{"id":2}',
    });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await expect(selo(page, ausente, 'rule')).toBeVisible();

    const metodos = await Promise.all(
      [valida, invalida, ausente].map((uuid) =>
        fundo(item(page, uuid).locator('app-method-badge')),
      ),
    );
    expect(metodos, 'POST, DELETE e PATCH com fundo').not.toContain(SEM_FUNDO);
    expect(new Set(metodos).size, 'cada método na sua cor').toBe(3);

    const verde = await fundo(selo(page, valida, 'rule'));
    const ambar = await fundo(selo(page, invalida, 'rule'));
    const vermelho = await fundo(selo(page, ausente, 'rule'));
    expect(
      new Set([verde, ambar, vermelho, SEM_FUNDO]).size,
      '2xx, 4xx e 5xx em cores próprias',
    ).toBe(4);

    expect(await fundo(selo(page, valida, 'signature')), 'assinatura válida').toBe(verde);
    expect(await fundo(selo(page, valida, 'schema')), 'schema válido').toBe(verde);
    expect(await fundo(selo(page, invalida, 'signature')), 'assinatura inválida').toBe(vermelho);
    expect(await fundo(selo(page, invalida, 'schema')), 'schema inválido').toBe(vermelho);
    const cinza = await fundo(selo(page, ausente, 'signature'));
    expect([verde, vermelho, SEM_FUNDO], 'assinatura ausente em cinza').not.toContain(cinza);

    await abrirItem(page, valida).click();
    const detalhe = page.getByRole('region', { name: 'Request detail' });
    await expect(detalhe.locator('.head app-method-badge')).toHaveText('POST');
    expect(await fundo(detalhe.locator('.head app-method-badge')), 'o detalhe fica como está').toBe(
      SEM_FUNDO,
    );
  });
});
