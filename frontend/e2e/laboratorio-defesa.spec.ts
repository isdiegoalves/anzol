import { abrirChecks } from './support/checks';
import { expect, test } from './support/fixtures';
import { gravarRegras } from './support/regras';
import { seedStorage } from './support/storage';

// Laboratório de defesa em Checks › Defense lab: a URL comum cria a URL de laboratório (segredo e briefing mostrados
// uma vez); na URL de laboratório, a pessoa abre a rodada, julga a onda 1 à mão, grava as regras do piso, fecha e lê
// o relatório, com o gabarito vindo do servidor.

interface Laboratorio {
  token: { uuid: string };
  read_secret: string;
}

/** Cada onda passa as 32 requisições pela captura de verdade: leva alguns segundos. */
const ONDA = { timeout: 45_000 };

test.describe('Dado o laboratório de defesa em Checks', () => {
  test('deve criar a URL de laboratório pela tela, mostrar o segredo e o briefing uma vez e abri-la destrancada', async ({
    page,
    tokens,
  }) => {
    const comum = await tokens.create();
    await seedStorage(page, { hideTutorial: 'true' });
    const cartao = await abrirChecks(page, comum, 'Defense lab');
    await expect(cartao.getByRole('button', { name: 'Start a round' })).toHaveCount(0);

    const criada = page.waitForResponse(
      (resposta) =>
        resposta.request().method() === 'POST' && resposta.url().endsWith('/defense-lab'),
    );
    await cartao.getByRole('button', { name: 'Create a defense lab URL' }).click();
    const resposta = await criada;
    expect(resposta.status()).toBe(201);
    const lab = (await resposta.json()) as Laboratorio;
    tokens.track(lab.token.uuid);
    tokens.protectedWith(lab.token.uuid, lab.read_secret);

    const dialogo = page.getByRole('dialog', { name: 'Defense lab URL created' });
    await expect(dialogo).toContainText(lab.read_secret);
    await expect(dialogo).toContainText("fictional online store's payment provider");
    await dialogo.getByRole('button', { name: 'Copy read secret' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(lab.read_secret);
    await dialogo.getByRole('button', { name: 'Open the lab URL' }).click();
    await expect(dialogo).toBeHidden();

    await expect(page).toHaveURL(new RegExp(`#/${lab.token.uuid}/checks\\?section=defense$`));
    const nova = page.getByRole('region', { name: 'Defense lab', exact: true });
    await expect(nova.getByText('Defense lab URL', { exact: true })).toBeVisible();
    await expect(nova.getByRole('button', { name: 'Start a round' })).toBeVisible();
    await nova.getByText('Briefing: what normal traffic looks like').click();
    await expect(nova).toContainText('payment.refunded only follows a payment.paid');
  });

  test('deve abrir a rodada, julgar a onda 1 à mão, conter pelo piso, fechar e mostrar o relatório', async ({
    page,
    request,
    tokens,
  }) => {
    test.setTimeout(180_000);
    const criada = await request.post('/defense-lab', { data: {} });
    expect(criada.status()).toBe(201);
    const lab = (await criada.json()) as Laboratorio;
    const tokenId = lab.token.uuid;
    tokens.track(tokenId);
    tokens.protectedWith(tokenId, lab.read_secret);
    await seedStorage(page, { hideTutorial: 'true' });
    const destrancar = await page.request.post(`/token/${tokenId}/unlock`, {
      data: { secret: lab.read_secret },
    });
    expect(destrancar.ok()).toBe(true);

    const cartao = await abrirChecks(page, tokenId, 'Defense lab');
    await cartao.getByRole('textbox', { name: /^Seed/ }).fill('42');
    await cartao.getByRole('button', { name: 'Start a round' }).click();
    await expect(cartao.getByRole('status')).toContainText(
      /^Round [0-9a-f]{8} is open: wave 1 delivered 32 requests\.$/,
      ONDA,
    );
    await expect(cartao.getByRole('region', { name: 'Prompt for your agent' })).toContainText(
      `on URL ${tokenId}`,
    );

    const tabela = cartao.getByRole('table', { name: 'Wave 1 requests' });
    await expect(tabela.getByRole('row')).toHaveCount(33);
    const linhas = tabela.getByRole('row');
    let piso = 0;
    for (let n = 1; n <= 32; n++) {
      const linha = linhas.nth(n);
      const assinatura = (await linha.getByRole('cell').nth(2).textContent())?.trim();
      if (assinatura !== 'Valid') {
        await linha.getByRole('combobox').click();
        await page.getByRole('option', { name: 'Attack · integrity' }).click();
        piso++;
      }
    }
    expect(piso).toBe(4);
    await cartao.getByRole('button', { name: 'Mark the rest legitimate' }).click();
    await expect(cartao.getByText('32 of 32 marked · 32 not sent')).toBeVisible();
    await cartao.getByRole('button', { name: 'Send verdicts' }).click();
    await expect(cartao.getByRole('status')).toHaveText(
      'The server has verdicts for 32 of 32 requests.',
    );

    await gravarRegras(page.request, tokenId, [
      { name: 'assinatura inválida', match: { signature: 'invalid' }, response: { status: 401 } },
      { name: 'assinatura ausente', match: { signature: 'absent' }, response: { status: 401 } },
    ]);
    await cartao.getByRole('button', { name: 'Finish the round' }).click();
    await expect(cartao.getByText('4 of 14 attacks detected')).toBeVisible(ONDA);

    const numeros = cartao.getByRole('list', { name: 'Round results' });
    await expect(numeros).toContainText('0 of 18 legitimate');
    await expect(numeros).toContainText('4 of 12 containable attacks blocked in wave 2');
    await expect(numeros).toContainText('18 of 18 in wave 2');
    await expect(numeros).toContainText('32 of 32 judged');
    await expect(numeros).toContainText('0 of 6');
    const relatorio = cartao.getByRole('table', { name: 'Results by scenario' });
    await expect(relatorio.getByRole('row')).toHaveCount(15);
    for (const codigo of ['I1', 'I2', 'I3', 'I4']) {
      const linha = relatorio.locator(`tr[data-scenario="${codigo}"]`);
      await expect(linha).toContainText('Detected');
      await expect(linha).toContainText('Blocked (401)');
    }
    await expect(relatorio.locator('tr[data-scenario="C1"]')).toContainText('Not containable');
    await expect(cartao.getByText(/Seed 42 · defense-catalog\/1 ·/)).toBeVisible();

    await page.reload();
    const deNovo = await abrirChecks(page, tokenId, 'Defense lab');
    await expect(deNovo.getByText('4 of 14 attacks detected')).toBeVisible();
    await expect(deNovo.getByRole('button', { name: 'Start another round' })).toBeVisible();
  });
});
