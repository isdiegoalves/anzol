import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import {
  CAMINHO,
  DESTINOS,
  Destino,
  ajuda,
  destino,
  estadoAoVivo,
  novaUrl,
  rolaNaHorizontal,
  secoes,
} from './support/shell';
import { seedStorage } from './support/storage';

// Item 14, E3: o shell da interface nova. Rail com cinco destinos (barra inferior abaixo de 600 px, rail compacto de
// 96 px em qualquer largura acima), cabeçalho fixo da URL (campo, Copy, chip Live, Lock), FAB "New URL", Help com o
// About, os atalhos globais, e a integração com o desbloqueio e com a página do link só-leitura. Nomes da §1 do
// plano ("Nomes acessíveis"); os assumidos estão marcados em `support/shell.ts`.

const SEGREDO = 'segredo-do-shell';

/** A tela de desbloqueio: digita o segredo e clica "Unlock" (nomes de hoje, que o shell mantém). */
async function unlock(page: Page, secret: string): Promise<void> {
  await page.getByLabel('Secret', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

/** A URL da página mudou dentro de `ms`? Observa `location.href` no navegador (o roteador em hash usa pushState). */
function urlMuda(page: Page, ms = 1_000): Promise<boolean> {
  return page.evaluate(
    (prazo) =>
      new Promise<boolean>((resolve) => {
        const inicio = location.href;
        const fim = Date.now() + prazo;
        const olhar = () => {
          if (location.href !== inicio) {
            resolve(true);
          } else if (Date.now() > fim) {
            resolve(false);
          } else {
            requestAnimationFrame(olhar);
          }
        };
        olhar();
      }),
    ms,
  );
}

test.describe('Dado o rail com os cinco destinos da URL', () => {
  test('deve listar Inbox, Rules, Checks, Outbound e Insights, nessa ordem, e marcar o aberto Quando cada um é clicado', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}`);

    const links = secoes(page).getByRole('link');
    await expect(links).toHaveCount(DESTINOS.length);
    for (const [i, nome] of DESTINOS.entries()) {
      await expect(links.nth(i)).toHaveAccessibleName(nome);
    }
    await expect(destino(page, 'Inbox')).toHaveAttribute('aria-current', 'page');

    for (const nome of [...DESTINOS.slice(1), 'Inbox'] as Destino[]) {
      await destino(page, nome).click();
      await expect(page).toHaveURL(new RegExp(`#/${tokenId}${CAMINHO[nome]}$`));
      await expect(destino(page, nome)).toHaveAttribute('aria-current', 'page');
      await expect(secoes(page).locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test('deve abrir cada rota nova pelo link direto, sem redirecionar, com a URL no cabeçalho', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const a = await tokens.send(tokenId, { data: 'a' });
    const b = await tokens.send(tokenId, { data: 'b' });
    const regras = await request.put(`/token/${tokenId}/rules`, {
      data: [{ name: 'do shell', match: { path: { equals: '/x' } } }],
    });
    expect(regras.status()).toBe(200);
    const [{ id: ruleId }] = (await regras.json()) as { id: string }[];

    const rotas: [string, Destino | null][] = [
      ['/checks?section=signature', 'Checks'],
      [`/checks?schema-from=${a}`, 'Checks'],
      ['/insights', 'Insights'],
      [`/rules/${ruleId}`, 'Rules'],
      [`/rules/new?from=${a}`, 'Rules'],
      [`/outbound?replay=${a}`, 'Outbound'],
      [`/outbound?send-from=${a}`, 'Outbound'],
      ['/outbound?send=signed', 'Outbound'],
      // O Compare não é destino do rail: basta a rota existir.
      [`/compare/${a}/${b}`, null],
    ];
    for (const [rota, aberto] of rotas) {
      // Sem token salvo: uma rota inexistente cairia em `/`, que cria outra URL (e o cabeçalho mostraria outra).
      await seedStorage(page, {});
      await page.goto(`/#/${tokenId}${rota}`);
      const origin = new URL(page.url()).origin;

      await expect(page.getByRole('textbox', { name: 'Webhook URL' }), rota).toHaveValue(
        `${origin}/${tokenId}`,
      );
      if (aberto) {
        await expect(destino(page, aberto), rota).toHaveAttribute('aria-current', 'page');
      } else {
        await expect(secoes(page), rota).toBeVisible();
      }
      expect(page.url(), rota).toBe(`${origin}/#/${tokenId}${rota}`);
    }
  });

  test('deve usar o rail a partir de 600 px e a barra inferior abaixo, com o rail sempre compacto', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}`);
    const caixa = async () => {
      await expect(secoes(page)).toBeVisible();
      const box = await secoes(page).boundingBox();
      expect(box, 'navigation "URL sections" visível').not.toBeNull();
      return box!;
    };

    await page.setViewportSize({ width: 599, height: 800 });
    const barra = await caixa();
    expect(barra.y + barra.height, 'barra encostada embaixo').toBeGreaterThanOrEqual(800 - 1);
    expect(barra.width, 'barra na largura da tela').toBeGreaterThanOrEqual(599 - 1);

    await page.setViewportSize({ width: 600, height: 800 });
    const rail = await caixa();
    expect(rail.x, 'rail encostado à esquerda').toBeLessThanOrEqual(1);
    expect(rail.height, 'rail na vertical').toBeGreaterThan(rail.width);
  });

  // Decisão do dono (2026-09-27): o rail fica como no protótipo C em qualquer largura a partir de 600 px — compacto,
  // 96 px, ícone com o rótulo pequeno embaixo; sai o rail expandido (≥ 1600 px) da §1.
  for (const largura of [600, 1400, 1600, 1920]) {
    test(`deve manter o rail compacto de 96 px, com o rótulo embaixo do ícone, a ${largura} px`, async ({
      page,
      tokens,
    }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await page.goto(`/#/${await tokens.create()}`);
      await expect(secoes(page)).toBeVisible();

      const rail = (await secoes(page).boundingBox())!;
      expect(rail.x, 'rail encostado à esquerda').toBeLessThanOrEqual(1);
      expect.soft(Math.round(rail.width), 'rail de 96 px').toBe(96);
      for (const nome of DESTINOS) {
        const link = destino(page, nome);
        const icone = (await link.locator('svg').first().boundingBox())!;
        const rotulo = (await link.getByText(nome, { exact: true }).boundingBox())!;
        expect
          .soft(rotulo.y, `${nome}: rótulo embaixo do ícone`)
          .toBeGreaterThanOrEqual(icone.y + icone.height - 1);
      }
      // O FAB e a marca ficam só com o ícone; o nome acessível não muda.
      await expect(novaUrl(page)).toBeVisible();
      await expect.soft(novaUrl(page).getByText('New URL', { exact: true })).toBeHidden();
      expect
        .soft((await novaUrl(page).boundingBox())!.width, 'FAB só com o ícone')
        .toBeLessThanOrEqual(96);
      const marca = page.getByRole('link', { name: 'Webhook Tester', exact: true });
      await expect(marca).toBeVisible();
      await expect.soft(marca.getByText('Webhook Tester', { exact: true })).toBeHidden();
    });
  }
});

test.describe('Dado o cabeçalho fixo da URL', () => {
  test('deve mostrar a URL, copiá-la com "Copy" e dizer "Live" Quando o tempo real conecta', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}`);
    const url = page.getByRole('textbox', { name: 'Webhook URL' });

    await expect(url).toHaveValue(`${new URL(page.url()).origin}/${tokenId}`);
    await expect(estadoAoVivo(page)).toContainText('Live');
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await url.inputValue());
  });

  test('deve deixar de dizer "Live" Quando o tempo real não conecta', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await page.route(`**/token/${tokenId}/stream`, (route) =>
      route.fulfill({ status: 503, body: 'indisponível' }),
    );

    await page.goto(`/#/${tokenId}`);

    await expect(estadoAoVivo(page)).toHaveText(/Reconnecting…|Offline/);
    await expect(estadoAoVivo(page)).not.toContainText('Live');
  });

  test('deve abrir o "Create New URL" Quando o FAB "New URL" é clicado, em qualquer destino', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    for (const nome of DESTINOS) {
      await page.goto(`/#/${tokenId}${CAMINHO[nome]}`);
      await expect(novaUrl(page), nome).toBeVisible();
      await novaUrl(page).click();
      const dialog = page.getByRole('dialog', { name: 'Create New URL' });
      await expect(dialog, nome).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog, nome).toBeHidden();
    }
  });
});

test.describe('Dado a tela estreita, abaixo de 600 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('deve mostrar a barra inferior com os cinco destinos, alvos de 48 px e sem rolagem horizontal até 320 px', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}`);

    await expect(secoes(page)).toBeVisible();
    const barra = await secoes(page).boundingBox();
    expect(barra, 'navigation "URL sections" visível').not.toBeNull();
    expect(barra!.y + barra!.height).toBeGreaterThanOrEqual(844 - 1);
    const links = secoes(page).getByRole('link');
    await expect(links).toHaveCount(DESTINOS.length);
    for (const [i, nome] of DESTINOS.entries()) {
      await expect(links.nth(i)).toHaveAccessibleName(nome);
      const alvo = await links.nth(i).boundingBox();
      expect(alvo!.width, `${nome}: largura do alvo`).toBeGreaterThanOrEqual(48);
      expect(alvo!.height, `${nome}: altura do alvo`).toBeGreaterThanOrEqual(48);
    }
    await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toBeVisible();
    expect(await rolaNaHorizontal(page), 'rolagem horizontal a 390 px').toBe(false);

    await destino(page, 'Rules').click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules$`));
    await expect(destino(page, 'Rules')).toHaveAttribute('aria-current', 'page');

    await page.setViewportSize({ width: 320, height: 800 });
    await expect(secoes(page)).toBeVisible();
    expect(await rolaNaHorizontal(page), 'rolagem horizontal a 320 px').toBe(false);
  });
});

test.describe('Dado uma URL protegida aberta sem acesso (desbloqueio dentro do shell)', () => {
  test('deve mostrar o desbloqueio sem os destinos da URL, trazê-los ao destrancar e tirá-los de novo com "Lock"', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ read_secret: SEGREDO });
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);

    await expect(page.getByRole('heading', { name: 'This URL is protected' })).toBeVisible();
    await expect(novaUrl(page), 'o shell continua em volta do desbloqueio').toBeVisible();
    await expect(secoes(page)).toHaveCount(0);

    await unlock(page, SEGREDO);

    await expect(destino(page, 'Inbox')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'This URL is protected' })).toBeHidden();

    await page.getByRole('button', { name: 'Lock' }).click();

    await expect(page.getByRole('heading', { name: 'This URL is protected' })).toBeVisible();
    await expect(secoes(page)).toHaveCount(0);
  });
});

test.describe('Dado a página do link só-leitura', () => {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`deve mostrar só a marca, sem destinos, cabeçalho da URL ou botões (${viewport.width} px)`, async ({
      page,
      request,
      tokens,
    }) => {
      const tokenId = await tokens.create();
      const requestId = await tokens.send(tokenId, { data: 'compartilhada' });
      const link = await request.post(`/token/${tokenId}/request/${requestId}/share`, { data: {} });
      expect([200, 201]).toContain(link.status());
      const { id } = (await link.json()) as { id: string };
      await page.setViewportSize(viewport);
      await seedStorage(page, {});

      await page.goto(`/#/share/${id}`);

      await expect(page.getByText(/Shared read-only link · expires/)).toBeVisible();
      await expect(page.locator('pre')).toHaveText('compartilhada');
      await expect(secoes(page)).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveCount(0);
      await expect(novaUrl(page)).toHaveCount(0);
      await expect(page.getByRole('button')).toHaveCount(0);
    });
  }
});

test.describe('Dado o Help do rail', () => {
  test('deve levar a "Github Page", "Donate" e "@fredsted" no About', async ({ page, tokens }) => {
    await page.goto(`/#/${await tokens.create()}`);
    await expect(ajuda(page)).toBeVisible();

    await ajuda(page).click();

    await expect(page.getByRole('link', { name: 'Github Page' })).toHaveAttribute(
      'href',
      'https://github.com/fredsted/webhook.site',
    );
    await expect(page.getByRole('link', { name: 'Donate' })).toHaveAttribute(
      'href',
      'https://github.com/fredsted/webhook.site#donate',
    );
    await expect(page.getByRole('link', { name: '@fredsted' })).toHaveAttribute(
      'href',
      'https://twitter.com/fredsted',
    );
  });
});

test.describe('Dado os atalhos de teclado do shell (C §3.2)', () => {
  test('deve ir aos destinos com G e a letra, e ignorar as teclas com o foco num campo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await page.goto(`/#/${tokenId}`);
    await expect(destino(page, 'Inbox')).toHaveAttribute('aria-current', 'page');

    const atalhos: [string, Destino][] = [
      ['c', 'Checks'],
      ['n', 'Insights'],
      ['r', 'Rules'],
      ['o', 'Outbound'],
      ['i', 'Inbox'],
    ];
    for (const [letra, nome] of atalhos) {
      await page.keyboard.press('g');
      await page.keyboard.press(letra);
      await expect(page).toHaveURL(new RegExp(`#/${tokenId}${CAMINHO[nome]}$`));
      await expect(destino(page, nome)).toHaveAttribute('aria-current', 'page');
    }

    await page.getByRole('textbox', { name: 'Webhook URL' }).focus();
    const mudou = urlMuda(page);
    await page.keyboard.press('g');
    await page.keyboard.press('c');
    expect(await mudou, 'G C com o foco no campo não navega').toBe(false);
    await expect(destino(page, 'Inbox')).toHaveAttribute('aria-current', 'page');
  });
});
