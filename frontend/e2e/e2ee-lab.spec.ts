import { abrirChecks } from './support/checks';
import { expect, test } from './support/fixtures';
import { detalhes, verificacoes } from './support/inbox';
import { seedStorage } from './support/storage';

// Laboratório E2EE no cartão "E2EE decryption": a URL de laboratório (`POST /e2ee-lab`) roda os cenários do
// contrato pelo "Run scenarios" e mostra o relatório; a URL comum cria uma pelo "Create a lab URL", que mostra os
// segredos uma vez e abre a URL nova já destrancada.

interface Laboratorio {
  token: { uuid: string };
  read_secret: string;
  hmac_secret: string;
}

/** A rodada entrega os 27 cenários pela captura de verdade: leva alguns segundos. */
const RODADA = { timeout: 45_000 };

test.describe('Dado o laboratório E2EE em Checks', () => {
  test('deve rodar os cenários na URL de laboratório, com 27 de 27 conferindo, e abrir a mensagem de um deles', async ({
    page,
    request,
    tokens,
  }) => {
    test.setTimeout(90_000);
    const resposta = await request.post('/e2ee-lab', { data: {} });
    expect(resposta.status()).toBe(201);
    const lab = (await resposta.json()) as Laboratorio;
    const tokenId = lab.token.uuid;
    tokens.track(tokenId);
    tokens.protectedWith(tokenId, lab.read_secret);
    await seedStorage(page, { hideTutorial: 'true' });
    const destrancar = await page.request.post(`/token/${tokenId}/unlock`, {
      data: { secret: lab.read_secret },
    });
    expect(destrancar.ok()).toBe(true);

    const cartao = await abrirChecks(page, tokenId, 'E2EE decryption');
    const regiao = cartao.getByRole('region', { name: 'Lab scenarios' });
    await expect(regiao.getByText('Lab URL', { exact: true })).toBeVisible();
    await expect(regiao.getByText(/^Expires in (2[0-3] hours|a day) \(/)).toBeVisible();
    await expect(cartao.getByRole('button', { name: 'Create a lab URL' })).toHaveCount(0);

    await regiao.getByRole('button', { name: 'Run scenarios' }).click();
    await expect(regiao.getByRole('status')).toContainText('Running the scenarios');
    await expect(regiao.getByRole('status')).toContainText(
      '27 of 27 scenarios gave the expected result',
      RODADA,
    );
    const tabela = regiao.getByRole('table', { name: 'Scenario results' });
    await expect(tabela.getByRole('row')).toHaveCount(28);
    await expect(tabela.getByText('Diverged', { exact: true })).toHaveCount(0);
    await expect(tabela.getByText('As expected', { exact: true })).toHaveCount(27);

    const p1 = tabela.locator('tr[data-scenario="P1"]');
    await expect(p1).toContainText('202 valid');
    await expect(p1).toContainText('data same as sent');
    const link = p1.getByRole('link', { name: /^Open request #[0-9a-f]{8} of P1 in the Inbox$/ });
    const curto = ((await link.textContent()) ?? '').trim().slice(1);
    await link.click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/${curto}[0-9a-f-]{28}/1$`));
    await expect(detalhes(page)).toContainText(curto);
    await expect(verificacoes(page)).toContainText(
      /Decrypted\s*encryption key enc-v\d · signed by the sender's key lab-sig-1/,
    );
  });

  test('deve criar a URL de laboratório pela tela, mostrar os segredos uma vez e abri-la destrancada', async ({
    page,
    tokens,
  }) => {
    const comum = await tokens.create();
    await seedStorage(page, { hideTutorial: 'true' });
    const cartao = await abrirChecks(page, comum, 'E2EE decryption');
    await expect(cartao.getByRole('button', { name: 'Run scenarios' })).toHaveCount(0);

    const criada = page.waitForResponse(
      (resposta) => resposta.request().method() === 'POST' && resposta.url().endsWith('/e2ee-lab'),
    );
    await cartao
      .getByRole('region', { name: 'E2EE lab' })
      .getByRole('button', { name: 'Create a lab URL' })
      .click();
    const resposta = await criada;
    expect(resposta.status()).toBe(201);
    const lab = (await resposta.json()) as Laboratorio;
    tokens.track(lab.token.uuid);
    tokens.protectedWith(lab.token.uuid, lab.read_secret);

    const dialogo = page.getByRole('dialog', { name: 'Lab URL created' });
    await expect(dialogo).toContainText("the server shows them only this once, and they don't");
    await expect(dialogo).toContainText(lab.read_secret);
    await expect(dialogo).toContainText(lab.hmac_secret);
    await dialogo.getByRole('button', { name: 'Copy read secret' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(lab.read_secret);
    await dialogo.getByRole('button', { name: 'Open the lab URL' }).click();
    await expect(dialogo).toBeHidden();

    await expect(page).toHaveURL(new RegExp(`#/${lab.token.uuid}/checks\\?section=e2ee$`));
    await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
      new RegExp(`/${lab.token.uuid}$`),
    );
    const regiao = page
      .getByRole('region', { name: 'E2EE decryption', exact: true })
      .getByRole('region', { name: 'Lab scenarios' });
    await expect(regiao.getByText('Lab URL', { exact: true })).toBeVisible();
    await expect(regiao.getByRole('button', { name: 'Run scenarios' })).toBeVisible();
  });
});
