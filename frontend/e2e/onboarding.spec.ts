import { randomUUID } from 'node:crypto';
import { Page, Route } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import { abrirChecks, botaoSalvar } from './support/checks';
import { expect, test } from './support/fixtures';
import { campoDeBusca, itens, lista } from './support/inbox';
import { acaoDoShell, compacto } from './support/shell';
import { readStorage, seedStorage } from './support/storage';

// Patamar, B3 (guia-combinacao §3.3 e §7; CA-6): os quatro botões Save dos cartões somem; salvar é o `button "Save
// changes"` da `region "Unsaved changes"`, que só aparece com alteração pendente e grava tudo num PUT só.

// Item 14, E10: onboarding, estados vazios, de erro e de carregamento (C §2.10 e §2.11) e o Settings completo.
// Fixo na §1: "Your URL is ready" com as abas cURL, From a provider e CLI; "Send a test request" é um `fetch` da
// própria origem para a captura `/{uuid}` (não é rota de gestão), com corpo JSON; densidade confortável por padrão e
// compacta em Settings (`html.compact`, S17); o onboarding respeita `hideTutorial` (paridade).
// SUPOSIÇÕES (contrato da E10):
// - o onboarding é a `region "Your URL is ready"`: mostra a URL da webhook, um `button "Copy URL"` (pt-BR "Copiar
//   URL"; decisão do main: o "Copy" do cabeçalho segue único na tela) e o `link "Open in new tab"`; `tab` "cURL" (comando `curl` com a URL), "From a provider" (Stripe, GitHub, Shopify e Slack, com um link
//   para Checks) e "CLI" (`anzol listen … --token {uuid}`, o CLI se chama `anzol`); e três links para o que a URL sabe fazer, que levam a
//   `#/{token}/rules`, `#/{token}/checks` e `#/{token}/outbound`;
// - "Send a test request" (`button`) manda `POST` com `Content-Type: application/json` e um corpo JSON;
// - URL inexistente: como hoje, a tela cria outra e vai para ela, mas explica no onboarding da nova (e não num
//   snackbar de 10 s): "The URL {uuid antigo} doesn't exist anymore…";
// - carregando a lista, a `region "Request list"` fica com `aria-busy="true"` (skeleton), e sem ele depois;
// - erro de rede ao salvar (Checks): snackbar com a ação "Retry", o formulário mantém o que foi digitado e o "Retry"
//   salva de novo;
// - Settings: `radiogroup "Density"` com "Comfortable" (padrão) e "Compact"; a escolha fica em
//   `localStorage.density` ('"compact"') e põe a classe `compact` no `<html>`; o `switch "Keyboard shortcuts"` de
//   hoje desliga os atalhos de uma tecla e fica guardado.

function onboarding(page: Page) {
  return page.getByRole('region', { name: 'Your URL is ready' });
}

test.describe('Dado uma URL nova, sem mensagens', () => {
  // Pedido do dono (2026-09-27): o "What is a webhook?" deixa de apontar para o blog do autor antigo e vira uma
  // explicação curta, na própria tela, num `<details>` com esse `<summary>`, sem link externo.
  test('deve explicar "What is a webhook?" num details, sem link externo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    const pronta = onboarding(page);
    await expect(pronta).toBeVisible();

    const oQueE = pronta.locator('details', {
      has: page.locator('summary', { hasText: /^\s*What is a webhook\?\s*$/ }),
    });
    await expect(oQueE).toHaveCount(1);
    await expect(oQueE).not.toHaveAttribute('open');
    await oQueE.locator('summary').click();
    await expect(oQueE).toHaveAttribute('open', '');
    const explicacao = (await oQueE.innerText()).replace(/What is a webhook\?/, '').trim();
    expect(explicacao.length, 'explicação curta ao abrir').toBeGreaterThan(20);
    await expect(oQueE.locator('a')).toHaveCount(0);
    await expect(pronta.getByRole('link', { name: 'What is a webhook?' })).toHaveCount(0);
    await expect(page.locator('a[href*="fredsted"]')).toHaveCount(0);
  });

  test('deve mostrar "Your URL is ready" com a URL, as três abas e os destinos da URL', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});

    await page.goto(`/#/${tokenId}`);

    const pronta = onboarding(page);
    const url = `${new URL(page.url()).origin}/${tokenId}`;
    await expect(pronta).toContainText(url);
    await expect(pronta.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute(
      'href',
      url,
    );
    await pronta.getByRole('button', { name: 'Copy URL', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

    await pronta.getByRole('tab', { name: 'cURL', exact: true }).click();
    await expect(pronta.getByRole('tabpanel')).toContainText(/curl .*/);
    await expect(pronta.getByRole('tabpanel')).toContainText(url);
    await pronta.getByRole('tab', { name: 'From a provider', exact: true }).click();
    for (const provedor of ['Stripe', 'GitHub', 'Shopify', 'Slack']) {
      await expect(pronta.getByRole('tabpanel')).toContainText(provedor);
    }
    await expect(
      pronta.getByRole('tabpanel').locator(`a[href*="/${tokenId}/checks"]`).first(),
    ).toBeVisible();
    await pronta.getByRole('tab', { name: 'CLI', exact: true }).click();
    await expect(pronta.getByRole('tabpanel')).toContainText('anzol listen');
    await expect(pronta.getByRole('tabpanel')).toContainText(`--token ${tokenId}`);

    for (const destino of ['rules', 'checks', 'outbound']) {
      await expect(pronta.locator(`a[href$="/${tokenId}/${destino}"]`).first()).toBeVisible();
    }
    await expect(page.getByText('Waiting for first request...')).toBeVisible();
  });

  test('deve mandar um JSON para a captura e mostrar a mensagem na Inbox Quando "Send a test request" é clicado', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    const stream = page.waitForResponse((r) => r.url().endsWith(`/token/${tokenId}/stream`));
    await page.goto(`/#/${tokenId}`);
    expect((await stream).status()).toBe(200);
    const origem = new URL(page.url()).origin;
    const enviar = onboarding(page).getByRole('button', { name: 'Send a test request' });
    await expect(enviar).toBeVisible();

    const [enviada] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && r.url() === `${origem}/${tokenId}`),
      enviar.click(),
    ]);

    expect(await enviada.headerValue('content-type')).toContain('application/json');
    expect(() => JSON.parse(enviada.postData() ?? '')).not.toThrow();
    await expect(page.getByRole('heading', { name: 'Requests (1)' })).toBeVisible();
    await expect(itens(page)).toHaveCount(1);
    const [mensagem] = await tokens.listed(tokenId);
    expect(mensagem.method).toBe('POST');
  });
});

test.describe('Dado um link para uma URL que não existe', () => {
  // Patamar, B1 (guia-combinacao §3.1 e §7; UX-16, P1 decidida): a Entrada não cria outra URL sozinha; mostra a
  // página única de URL inexistente, com o endereço pedido.
  test('deve mostrar a página de URL inexistente, sem criar outra', async ({ page }) => {
    const antiga = randomUUID();
    await seedStorage(page, {});

    await page.goto(`/#/${antiga}`);

    await expect(
      page.getByRole('heading', { name: 'This URL no longer exists', level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/${antiga}$`));
    await expect(page.getByRole('button', { name: 'Create a new URL' })).toBeVisible();
    await expect(onboarding(page)).toHaveCount(0);
  });
});

test.describe('Dado a lista carregando', () => {
  test('deve marcar a lista como ocupada até os itens chegarem', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { data: 'um' });
    await seedStorage(page, {});
    let soltar: () => void = () => undefined;
    const liberada = new Promise<void>((resolve) => (soltar = resolve));
    await page.route(`**/token/${tokenId}/requests?**`, async (route: Route) => {
      await liberada;
      await route.continue();
    });

    await page.goto(`/#/${tokenId}`);

    await expect(lista(page)).toHaveAttribute('aria-busy', 'true');
    soltar();
    await expect(itens(page)).toHaveCount(1);
    await expect(lista(page)).not.toHaveAttribute('aria-busy', 'true');
  });
});

test.describe('Dado um filtro sem resultado', () => {
  test('deve dizer que nada casa e que as novas que casarem aparecem ao vivo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { data: 'alguma coisa' });
    await page.goto(`/#/${tokenId}`);
    await expect(itens(page)).toHaveCount(1);

    if (compacto(page)) {
      // Fidelidade ao C (F1, INBOX-31): no compacto, a busca abre pela lupa da barra do topo.
      await page.getByRole('button', { name: 'Search requests' }).click();
    }
    await campoDeBusca(page).fill('nada-casa-com-isto');

    await expect(page.getByText('No requests match these filters')).toBeVisible();
    await expect(page.getByText('New requests that match will appear here live.')).toBeVisible();
  });
});

test.describe('Dado um erro de rede ao salvar em Checks', () => {
  test('deve oferecer "Retry", manter o que foi digitado e salvar no Retry', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ default_content: 'antes' });
    await seedStorage(page, {});
    const resposta = await abrirChecks(page, tokenId, 'Response');
    let falhar = true;
    await page.route(`**/token/${tokenId}`, async (route) => {
      if (route.request().method() === 'PUT' && falhar) {
        falhar = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await resposta.getByLabel('Response body').fill('depois');
    await botaoSalvar(page).click();

    // B3: o erro de rede ao salvar fica na barra, com "Try again" (antes "Retry" no cartão).
    const retry = page.getByRole('button', { name: /^(Try again|Retry)$/ });
    await expect(retry).toBeVisible();
    await expect(resposta.getByLabel('Response body')).toHaveValue('depois');
    const put = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().endsWith(`/token/${tokenId}`),
    );
    await retry.click();
    expect((await put).status()).toBe(200);
    expect(await tokens.read(tokenId)).toMatchObject({ default_content: 'depois' });
  });
});

test.describe('Dado o Settings completo', () => {
  test('deve trocar a densidade para compacta e guardá-la ao recarregar', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await (await acaoDoShell(page, 'Settings')).click();
    const densidade = page.getByRole('radiogroup', { name: 'Density' });
    await expect(densidade.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
    await expect(page.locator('html')).not.toHaveClass(/\bcompact\b/);

    await densidade.getByRole('radio', { name: 'Compact' }).check();

    await expect(page.locator('html')).toHaveClass(/\bcompact\b/);
    expect((await readStorage(page))['density']).toBe('"compact"');
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bcompact\b/);
  });

  test('deve desligar os atalhos de uma tecla e manter desligados ao recarregar', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await seedStorage(page, {});
    await page.goto(`/#/${tokenId}`);
    await (await acaoDoShell(page, 'Settings')).click();

    await page.getByRole('switch', { name: 'Keyboard shortcuts' }).uncheck();
    await page.reload();
    await page.keyboard.press('g');
    await page.keyboard.press('r');

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}$`));
    await (await acaoDoShell(page, 'Settings')).click();
    await expect(page.getByRole('switch', { name: 'Keyboard shortcuts' })).not.toBeChecked();
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`Dado o onboarding vazio no tema ${colorScheme} a ${viewport.width}×${viewport.height} (axe, CA-2)`, () => {
      test.use({ colorScheme, viewport });

      test('deve passar no axe sem violação grave', async ({ page, tokens }) => {
        const tokenId = await tokens.create();
        await seedStorage(page, {});
        await page.goto(`/#/${tokenId}`);
        await expect(onboarding(page)).toBeVisible();

        await expectSemViolacoesGraves(page, `onboarding, ${colorScheme}, ${viewport.width} px`);
      });
    });
  }
}
