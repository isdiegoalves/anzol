import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { expectCorpo } from './support/inbox';
import { readStorage, seedStorage } from './support/storage';

// Checklist 12 e 14. Item 14, E4 (S13/S14): "Format JSON/XML" vira o `switch "Pretty"` e "Auto Navigate" o
// `switch "Follow new"`, lendo e gravando as mesmas chaves (`formatJsonEnable`, `autoNavEnable`).
// Item 14, E10: o tutorial vira o onboarding "Your URL is ready" (`region` com esse nome), que respeita
// `hideTutorial` como hoje: com mensagens, aparece até o "Close"; sem mensagens, aparece sempre, com a URL.
// Fidelidade ao C (item 14.1, INBOX-06): com mensagens, o onboarding não fica em cima do detalhe; o detalhe começa no
// topo do painel (o onboarding some, ou fica abaixo do detalhe e ainda fecha pelo "Close").

/** O onboarding que substitui o tutorial (E10). */
const onboarding = (page: Page) => page.getByRole('region', { name: 'Your URL is ready' });

test.describe('Dado o tutorial (checklist 12)', () => {
  test('não deve pôr o onboarding em cima do detalhe Quando a URL tem mensagens', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}/${requestId}/1`);
    const metadados = page.getByRole('group', { name: 'Request metadata' });
    await expect(metadados).toBeVisible();
    const tutorial = onboarding(page);

    if ((await tutorial.count()) > 0 && (await tutorial.isVisible())) {
      const topoDoDetalhe = (await page
        .getByRole('heading', { name: '/', exact: true })
        .boundingBox())!;
      expect((await tutorial.boundingBox())!.y, 'onboarding abaixo do detalhe').toBeGreaterThan(
        topoDoDetalhe.y,
      );
      await tutorial.getByRole('button', { name: 'Close' }).click();
      await expect(tutorial).toBeHidden();
      await page.reload();
      await expect(metadados).toBeVisible();
      await expect(tutorial).toBeHidden();
      expect((await readStorage(page))['hideTutorial']).toBe('true');
    }
    // O detalhe começa no topo do painel: o cabeçalho da mensagem está à vista sem rolar.
    await expect(page.getByRole('heading', { name: '/', exact: true })).toBeInViewport();
    const cabecalho = (await page.getByRole('heading', { name: '/', exact: true }).boundingBox())!;
    expect(cabecalho.y, 'cabeçalho da mensagem no topo').toBeLessThan(200);
  });

  test('deve mostrar o tutorial mesmo escondido Quando a URL não tem mensagens', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, { hideTutorial: 'true' });

    await page.goto(`/#/${tokenId}`);

    await expect(onboarding(page)).toContainText(`/${tokenId}`);
  });
});

test.describe('Dado as preferências no localStorage (checklist 14)', () => {
  /** Gravado pelo app atual (8084) em 2026-09-25, chaves e formato exatos. */
  const gravadoPeloAppAtual = (tokenId: string) => ({
    token: JSON.stringify({ uuid: tokenId, default_status: 200, cors: false }),
    formatJsonEnable: 'true',
    autoNavEnable: 'true',
    hideTutorial: 'true',
    redirectEnable: 'false',
    redirectUrl: '"http://destino.example"',
    redirectContentType: '"application/json"',
    redirectHeaders: '"x-token,referer"',
    redirectMethod: '"PUT"',
    unread: '[]',
  });

  test('deve abrir com as mesmas preferências Quando o localStorage veio do app atual', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, {
      data: '{"a":1}',
      headers: { 'content-type': 'application/json' },
    });
    await seedStorage(page, gravadoPeloAppAtual(tokenId));

    await page.goto('/');

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/`));
    await expect(page.getByRole('switch', { name: 'Pretty', exact: true })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Follow new' })).toBeChecked();
    await expect(onboarding(page)).toBeHidden();
    await expectCorpo(page, '{\n  "a": 1\n}');
    // Item 14, E7: o redirect pelo navegador fica em Outbound › "Forward from this browser (legacy)".
    await page
      .getByRole('navigation', { name: 'URL sections' })
      .getByRole('link', { name: 'Outbound', exact: true })
      .click();
    await page.getByRole('button', { name: 'Forward from this browser (legacy)' }).click();
    await expect(page.getByRole('switch', { name: 'Auto redirect' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Settings...' }).click();
    // Escopado: a página Outbound tem outros campos (o compositor).
    const redirecao = page.getByRole('dialog', { name: 'Redirection Settings' });
    await expect(redirecao.getByLabel('Redirect to')).toHaveValue('http://destino.example');
    await expect(redirecao.getByLabel('Content Type')).toHaveValue('application/json');
    await expect(redirecao.getByLabel('Redirect Headers')).toHaveValue('x-token,referer');
    await expect(redirecao.getByRole('combobox', { name: 'HTTP Method' })).toContainText('PUT');
  });

  test('deve gravar nas mesmas chaves em JSON e manter após recarregar Quando as opções mudam', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId);
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);

    // Fidelidade ao C (INBOX-22): "Pretty" nasce ligado; desligar grava `formatJsonEnable` false.
    await expect(page.getByRole('switch', { name: 'Pretty', exact: true })).toBeChecked();
    await page.getByRole('switch', { name: 'Pretty', exact: true }).click();
    await page.getByRole('switch', { name: 'Follow new' }).click();
    await page.reload();

    await expect(page.getByRole('switch', { name: 'Pretty', exact: true })).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Follow new' })).toBeChecked();
    const stored = await readStorage(page);
    expect(stored).toMatchObject({
      formatJsonEnable: 'false',
      autoNavEnable: 'true',
      redirectEnable: 'false',
      redirectUrl: 'null',
      redirectContentType: '"text/plain"',
      redirectHeaders: 'null',
      redirectMethod: '""',
      hideTutorial: 'false',
      unread: '{}',
    });
    expect(JSON.parse(stored['token'])).toMatchObject({ uuid: tokenId });
  });
});
