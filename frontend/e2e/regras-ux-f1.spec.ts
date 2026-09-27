import { Dialog, Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import {
  abrirRegra,
  abrirRegras,
  aceitarSaida,
  acaoDoEditor,
  alertaDeRascunho,
  alertaParaCorrigir,
  arquivoDeRegras,
  celular,
  dialogo,
  editor,
  gravarRegras,
  importar,
  lerRegras,
  linhaDaRegra,
  memoriaDaAba,
  novaRegra,
  parte,
} from './support/regras';

// UX de Regras, fatia F1 — proteção (WM-12, E-04, WM-37, WM-19, WM-13; guia-ux §3.1; CA-3 e CA-4 no que é da tela).
// Salvar e Testar nunca desabilitados; nenhuma saída do editor perde rascunho sem perguntar; rascunho por regra na
// aba, sem valores de cabeçalho sensível; confirmação com nome do que muda; import com a diferença, Mesclar e
// Desfazer; atalhos. SUPOSIÇÕES (o guia não fixa):
// - SUPOSIÇÃO: "Turn all rules off" é um `button` visível no cabeçalho da lista (ao lado de Import/Export); o guia
//   só nomeia o diálogo e o snackbar.
// - SUPOSIÇÃO: "Reset all scenarios" continua sendo o `button "Reset all…"` da seção "Scenarios on this URL" (aba
//   Scenario, RULES-12), agora com o `dialog "Reset all scenarios?"` antes de gravar.
// - SUPOSIÇÃO: no `dialog "Import rules"` o botão primário segue o rádio escolhido ("Replace" ou "Merge"); o teto de
//   100 desabilita o rádio de Mesclar.
// - SUPOSIÇÃO: o `alert` de validação cita cada campo pelo rótulo ("Status", "Delay (ms)", …).
// - SUPOSIÇÃO: `aria-keyshortcuts` com a grafia da ARIA ("Control+S", "Control+Enter"; "Meta+…" pode vir junto).

const PIX = {
  name: 'Pix',
  priority: 5,
  match: { method: ['POST'], path: { equals: '/pagamentos' } },
  response: { status: 201, headers: {}, body: '' },
};
const BOLETO = {
  name: 'Boleto',
  priority: 6,
  match: { method: ['POST'], path: { equals: '/boletos' } },
  response: { status: 202, headers: {}, body: '' },
};

/** Status da aba Response (o spinbutton). */
function status(regiao: Locator): Locator {
  return regiao.getByRole('spinbutton', { name: 'Status' });
}

/** Troca o nome da regra digitando (tecla de verdade: ativa a página para o `beforeunload`). */
async function renomear(regiao: Locator, nome: string): Promise<void> {
  const campo = regiao.getByRole('textbox', { name: 'Name', exact: true });
  await campo.click();
  await campo.press('ControlOrMeta+a');
  await campo.pressSequentially(nome);
  await expect(regiao.getByText('Unsaved changes')).toBeVisible();
}

/** Clica na linha de outra regra (só no desktop: no celular a lista some com o editor aberto, F8). */
async function clicarNaLinha(page: Page, nome: string): Promise<void> {
  await linhaDaRegra(page, nome).locator('td.item').getByRole('button').click();
}

test.describe('Dado o editor com o formulário inválido (WM-12, WM-04; CA-3)', () => {
  test('deve manter Save habilitado e, no clique, ir à aba e ao campo inválido, dizer o que corrigir e não gravar', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Status errado');
    await parte(regra, 'Response');
    await status(regra).fill('99');
    await parte(regra, 'Match');

    const salvar = regra.getByRole('button', { name: 'Save', exact: true });
    await expect(salvar).toBeEnabled();
    await salvar.click();

    await expect(regra.getByRole('tab', { name: 'Response', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(status(regra)).toBeFocused();
    await expect(alertaParaCorrigir(regra)).toContainText(/To save, fix: .*Status/);
    await expect(regra).toBeVisible();
    expect(await lerRegras(request, tokenId)).toEqual([]);

    await status(regra).fill('201');
    await expect(alertaParaCorrigir(regra)).toHaveCount(0);
  });

  test('deve manter "Test against history" habilitado e dizer "To test, fix:" em vez de testar', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pagamentos' });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Status errado');
    await parte(regra, 'Response');
    await status(regra).fill('600');
    await parte(regra, 'Match');

    const testar = regra.getByRole('button', { name: 'Test against history' });
    await expect(testar).toBeEnabled();
    await testar.click();

    await expect(alertaParaCorrigir(regra, 'test')).toContainText(/To test, fix: .*Status/);
    await expect(status(regra)).toBeFocused();
    await expect(regra.getByRole('status', { name: 'History test' })).toHaveCount(0);
  });
});

test.describe('Dado uma regra com alterações não salvas (E-04, WM-12: guarda de rascunho)', () => {
  test('deve perguntar "Discard changes?" ao clicar noutra regra, com "Keep editing" como padrão', async ({
    page,
    request,
    tokens,
  }) => {
    test.skip(celular(page), 'desktop: no celular a lista some com o editor aberto (F8)');
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX, BOLETO]);
    await abrirRegras(page, tokenId);
    const pix = await abrirRegra(page, 'Pix');
    await renomear(pix, 'Pix 2');

    await clicarNaLinha(page, 'Boleto');
    const pergunta = dialogo(page, 'Discard changes?');
    await expect(pergunta).toBeVisible();
    await expect(pergunta).toContainText('"Pix" has unsaved changes.');
    const continuar = pergunta.getByRole('button', { name: 'Keep editing' });
    await expect(continuar).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(pergunta).toBeHidden();
    await expect(pix).toBeVisible();
    await expect(pix.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Pix 2');

    await clicarNaLinha(page, 'Boleto');
    await dialogo(page, 'Discard changes?').getByRole('button', { name: 'Discard' }).click();
    await expect(editor(page, 'Edit rule Boleto')).toBeVisible();
    expect((await lerRegras(request, tokenId)).map((r) => r.name)).toEqual(['Pix', 'Boleto']);
  });

  test('deve perguntar antes de sair por "Discard", por Esc e pelo rail, e descartar só no "Discard" do diálogo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);
    const pix = await abrirRegra(page, 'Pix');
    await renomear(pix, 'Pix 2');
    const pergunta = dialogo(page, 'Discard changes?');

    await page.keyboard.press('Escape');
    await expect(pergunta).toBeVisible();
    await pergunta.getByRole('button', { name: 'Keep editing' }).click();
    await expect(pix).toBeVisible();

    await page.getByRole('link', { name: /^Inbox(, .+)?$/ }).click();
    await expect(pergunta).toBeVisible();
    await pergunta.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules/`));
    await expect(pix.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Pix 2');

    await acaoDoEditor(page, pix, 'Discard');
    await expect(pergunta).toBeVisible();
    await pergunta.getByRole('button', { name: 'Discard' }).click();
    await expect(pix).toBeHidden();
    expect((await lerRegras(request, tokenId)).map((r) => r.name)).toEqual(['Pix']);
  });

  test('deve pedir confirmação do navegador (beforeunload) ao fechar a aba', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);
    const pix = await abrirRegra(page, 'Pix');
    await renomear(pix, 'Pix 2');

    // Sem a guarda, a aba fecha direto (evento `close`); com ela, o navegador pergunta (`beforeunload`).
    const aviso = new Promise<Dialog | null>((resolve) => {
      page.once('dialog', resolve);
      page.once('close', () => resolve(null));
    });
    await page.close({ runBeforeUnload: true });
    const janela = await aviso;
    expect(janela?.type(), 'a aba fechou sem perguntar').toBe('beforeunload');
    await janela!.dismiss();
    await expect(pix.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Pix 2');
  });

  test('não deve perguntar nada Quando não há alteração', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX, BOLETO]);
    await abrirRegras(page, tokenId);
    const pix = await abrirRegra(page, 'Pix');

    await acaoDoEditor(page, pix, 'Discard');
    await expect(pix).toBeHidden();
    await expect(dialogo(page, 'Discard changes?')).toHaveCount(0);

    if (!celular(page)) {
      await abrirRegra(page, 'Pix');
      await clicarNaLinha(page, 'Boleto');
      await expect(editor(page, 'Edit rule Boleto')).toBeVisible();
      await expect(dialogo(page, 'Discard changes?')).toHaveCount(0);
    }
  });
});

test.describe('Dado um rascunho guardado na aba (E-04)', () => {
  test('deve oferecer "Restore draft" ao reabrir a regra e limpar o rascunho ao salvar', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const [pix] = await gravarRegras(request, tokenId, [PIX]);
    aceitarSaida(page);
    await page.goto(`/#/${tokenId}/rules/${pix.id}`);
    let regra = editor(page, 'Edit rule Pix');
    await parte(regra, 'Response');
    await status(regra).fill('418');
    await expect.poll(() => memoriaDaAba(page)).toContain('418');

    await page.reload();
    regra = editor(page, 'Edit rule Pix');
    await expect(regra).toBeVisible();
    const rascunho = alertaDeRascunho(regra);
    await expect(rascunho).toBeVisible();
    await expect(rascunho).not.toContainText('Sensitive header values were not kept.');
    await parte(regra, 'Response');
    await expect(status(regra)).toHaveValue('201');

    await rascunho.getByRole('button', { name: 'Restore draft' }).click();
    await expect(rascunho).toBeHidden();
    await parte(regra, 'Response');
    await expect(status(regra)).toHaveValue('418');
    await expect(regra.getByText('Unsaved changes')).toBeVisible();
    await regra.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(regra).toBeHidden();
    await expect
      .poll(async () => (await lerRegras(request, tokenId))[0]?.['response'])
      .toMatchObject({ status: 418 });

    await page.reload();
    await abrirRegra(page, 'Pix');
    await expect(alertaDeRascunho(editor(page, 'Edit rule Pix'))).toHaveCount(0);
  });

  test('deve apagar o rascunho com "Discard draft" e não oferecê-lo de novo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const [pix] = await gravarRegras(request, tokenId, [PIX]);
    aceitarSaida(page);
    await page.goto(`/#/${tokenId}/rules/${pix.id}`);
    let regra = editor(page, 'Edit rule Pix');
    await parte(regra, 'Response');
    await status(regra).fill('418');
    await expect.poll(() => memoriaDaAba(page)).toContain('418');

    await page.reload();
    regra = editor(page, 'Edit rule Pix');
    await alertaDeRascunho(regra).getByRole('button', { name: 'Discard draft' }).click();
    await expect(alertaDeRascunho(regra)).toHaveCount(0);
    await parte(regra, 'Response');
    await expect(status(regra)).toHaveValue('201');
    await expect.poll(() => memoriaDaAba(page)).not.toContain('418');

    await page.reload();
    await expect(editor(page, 'Edit rule Pix')).toBeVisible();
    await expect(alertaDeRascunho(editor(page, 'Edit rule Pix'))).toHaveCount(0);
  });

  test('não deve guardar o valor de cabeçalho sensível, e deve dizer isso ao restaurar a regra nova', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    aceitarSaida(page);
    await page.goto(`/#/${tokenId}/rules/new`);
    let regra = editor(page);
    await expect(regra).toBeVisible();
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Com chave');
    await parte(regra, 'Match');
    await regra.getByRole('button', { name: 'Add header condition' }).click();
    await regra.getByRole('textbox', { name: 'Header 1 name' }).fill('X-Api-Key');
    await regra.getByRole('textbox', { name: 'Header 1 value' }).fill('segredo-e2e-5521');
    await expect.poll(() => memoriaDaAba(page)).toContain('Com chave');
    expect(await memoriaDaAba(page)).not.toContain('segredo-e2e-5521');

    await page.reload();
    regra = editor(page);
    const rascunho = alertaDeRascunho(regra);
    await expect(rascunho).toContainText('Sensitive header values were not kept.');
    await rascunho.getByRole('button', { name: 'Restore draft' }).click();
    await expect(regra.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Com chave',
    );
    await parte(regra, 'Match');
    await expect(regra.getByRole('textbox', { name: 'Header 1 name' })).toHaveValue('X-Api-Key');
    await expect(regra.getByRole('textbox', { name: 'Header 1 value' })).toHaveValue('');
  });
});

test.describe('Dado as ações em massa (WM-37: confirmação com o nome do que muda)', () => {
  test('deve confirmar "Turn all rules off?", desligar todas e religar com "Undo"', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX, BOLETO]);
    await abrirRegras(page, tokenId);

    await page.getByRole('button', { name: 'Turn all rules off' }).click();
    const pergunta = dialogo(page, 'Turn all rules off?');
    await expect(pergunta).toContainText('2 rules stop answering until turned on again.');
    await page.keyboard.press('Escape');
    await expect(pergunta).toBeHidden();
    expect((await lerRegras(request, tokenId)).map((r) => r['enabled'])).toEqual([true, true]);

    await page.getByRole('button', { name: 'Turn all rules off' }).click();
    await pergunta.getByRole('button', { name: 'Turn off', exact: true }).click();
    await expect(page.getByText('2 rules turned off')).toBeVisible();
    await expect
      .poll(async () => (await lerRegras(request, tokenId)).map((r) => r['enabled']))
      .toEqual([false, false]);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () => (await lerRegras(request, tokenId)).map((r) => r['enabled']))
      .toEqual([true, true]);
  });

  test('deve confirmar "Reset all scenarios?" nomeando os cenários antes de voltar a Started', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [
      {
        name: 'Falha 1',
        priority: 1,
        scenario: { name: 'entrega', requiredState: 'Started', newState: 'falhou-1' },
        response: { status: 503 },
      },
      {
        name: 'Sucesso',
        priority: 2,
        scenario: { name: 'entrega', requiredState: 'falhou-1' },
        response: { status: 200 },
      },
    ]);
    expect((await request.post(`/${tokenId}`)).status()).toBe(503);
    await abrirRegras(page, tokenId);
    const regra = await abrirRegra(page, 'Falha 1');
    await parte(regra, 'Scenario');

    await regra.getByRole('button', { name: /^Reset all\b/ }).click();
    const pergunta = dialogo(page, 'Reset all scenarios?');
    await expect(pergunta).toContainText(/Resets 1 scenarios? to Started: entrega\./);
    await pergunta.getByRole('button', { name: 'Cancel' }).click();
    expect((await request.post(`/${tokenId}`)).status()).toBe(200);

    await regra.getByRole('button', { name: /^Reset all\b/ }).click();
    await pergunta.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(pergunta).toBeHidden();
    await expect.poll(async () => (await request.post(`/${tokenId}`)).status()).toBe(503);
  });
});

test.describe('Dado o import de um arquivo de regras (WM-19; CA-4)', () => {
  const A = { name: 'A', priority: 1, response: { status: 200, headers: {}, body: '' } };
  const B = { name: 'B', priority: 2, response: { status: 503, headers: {}, body: '' } };
  const C = { name: 'C', priority: 3, response: { status: 204, headers: {}, body: '' } };

  /** Salvas: A, B (503), C. Arquivo: A igual, B com 200, sem C, e D novo (sem id). */
  async function cenario(page: Page, request: Parameters<typeof gravarRegras>[0], tokenId: string) {
    const [a, b] = await gravarRegras(request, tokenId, [A, B, C]);
    const arquivo = arquivoDeRegras([
      a,
      { ...b, response: { ...(b['response'] as object), status: 200 } },
      { name: 'D', priority: 4, response: { status: 201, headers: {}, body: '' } },
    ]);
    await abrirRegras(page, tokenId);
    return importar(page, arquivo);
  }

  test('deve mostrar a diferença por id, substituir com "Replace" e voltar atrás com "Undo"', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const janela = await cenario(page, request, tokenId);

    await expect(janela).toContainText('This file has 3 rules. Compared with the 3 saved:');
    await expect(janela).toContainText('1 unchanged · 1 changed · 1 removed · 1 new');
    await expect(janela).toContainText(/Changed \(1\)/);
    await expect(janela).toContainText(/B\W+response\.status 503 → 200/);
    await expect(janela).toContainText(/Removed \(1\)/);
    await expect(janela).toContainText(/New \(1\)/);
    await expect(janela.getByRole('radio', { name: 'Merge: keep the 3, add 1' })).toBeEnabled();
    expect((await lerRegras(request, tokenId)).map((r) => r.name)).toEqual(['A', 'B', 'C']);

    await janela.getByRole('radio', { name: 'Replace the 3 saved rules' }).check();
    await janela.getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(page.getByText('Imported 3 rules')).toBeVisible();
    await expect
      .poll(async () => (await lerRegras(request, tokenId)).map((r) => r.name))
      .toEqual(['A', 'B', 'D']);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
      .poll(async () =>
        (await lerRegras(request, tokenId)).map((r) => [
          r.name,
          (r['response'] as { status: number }).status,
        ]),
      )
      .toEqual([
        ['A', 200],
        ['B', 503],
        ['C', 204],
      ]);
  });

  test('deve manter as salvas e acrescentar só as novas Quando escolhe "Merge"', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const janela = await cenario(page, request, tokenId);

    await janela.getByRole('radio', { name: 'Merge: keep the 3, add 1' }).check();
    await janela.getByRole('button', { name: 'Merge', exact: true }).click();

    await expect
      .poll(async () => (await lerRegras(request, tokenId)).map((r) => r.name).sort())
      .toEqual(['A', 'B', 'C', 'D']);
    const b = (await lerRegras(request, tokenId)).find((r) => r.name === 'B');
    expect(b?.['response']).toMatchObject({ status: 503 });
  });

  test('não deve mudar nada Quando "Cancel"', async ({ page, request, tokens }) => {
    const tokenId = await tokens.create();
    const janela = await cenario(page, request, tokenId);

    await janela.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(janela).toBeHidden();
    expect((await lerRegras(request, tokenId)).map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  test('deve desabilitar "Merge" com "Would exceed 100 rules." Quando passaria do teto', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(
      request,
      tokenId,
      Array.from({ length: 99 }, (_, i) => ({ name: `R${i + 1}`, priority: i + 1 })),
    );
    await abrirRegras(page, tokenId);

    const janela = await importar(page, arquivoDeRegras([{ name: 'Nova 1' }, { name: 'Nova 2' }]));

    await expect(janela).toContainText('Would exceed 100 rules.');
    await expect(janela.getByRole('radio', { name: 'Merge: keep the 99, add 2' })).toBeDisabled();
    await expect(janela.getByRole('radio', { name: 'Replace the 99 saved rules' })).toBeEnabled();
  });

  test('deve dizer que o arquivo precisa ser uma lista, sem abrir a prévia', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);

    await importar(page, arquivoDeRegras({ name: 'não é lista' }));

    await expect(page.getByRole('alert')).toContainText(
      'The file must contain a JSON list of rules.',
    );
    await expect(dialogo(page, 'Import rules')).toHaveCount(0);
    expect(await lerRegras(request, tokenId)).toHaveLength(1);
  });

  test('deve ter "Import" e "Export" com rótulo visível', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    for (const nome of ['Import', 'Export']) {
      await expect(page.getByRole('button', { name: nome, exact: true })).toHaveText(nome);
    }
  });
});

test.describe('Dado os atalhos do editor (WM-13)', () => {
  test('deve salvar com Ctrl/Cmd+S com o foco no corpo da resposta', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await expect(regra.getByRole('button', { name: 'Save', exact: true })).toHaveAttribute(
      'aria-keyshortcuts',
      /Control\+S/i,
    );
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Atalho');
    await parte(regra, 'Response');
    const corpo = regra.getByRole('textbox', { name: 'Response body' });
    await corpo.click();
    await corpo.pressSequentially('ok');

    await corpo.press('ControlOrMeta+s');

    await expect(regra).toBeHidden();
    await expect(page.getByText('Rule saved')).toBeVisible();
    expect(await lerRegras(request, tokenId)).toEqual([
      expect.objectContaining({
        name: 'Atalho',
        response: expect.objectContaining({ body: 'ok' }),
      }),
    ]);
  });

  test('deve testar com Ctrl/Cmd+Enter com o foco num campo', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/pagamentos' });
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await expect(regra.getByRole('button', { name: 'Test against history' })).toHaveAttribute(
      'aria-keyshortcuts',
      /Control\+Enter/i,
    );
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Atalho');
    await parte(regra, 'Match');
    const caminho = regra.getByRole('textbox', { name: 'Path', exact: true });
    await caminho.fill('/pagamentos');

    await caminho.press('ControlOrMeta+Enter');

    await expect(regra.getByRole('tab', { name: 'Test', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(regra.getByRole('status', { name: 'History test' })).toContainText(
      /1 of the 1 most recent requests? would match/,
    );
  });

  test('deve fechar com Esc sem alteração, e com diálogo aberto o Esc fecha só o diálogo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await gravarRegras(request, tokenId, [PIX]);
    await abrirRegras(page, tokenId);
    let pix = await abrirRegra(page, 'Pix');
    await pix.getByRole('textbox', { name: 'Name', exact: true }).focus();

    await page.keyboard.press('Escape');
    await expect(pix).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules$`));

    pix = await abrirRegra(page, 'Pix');
    await renomear(pix, 'Pix 2');
    await page.keyboard.press('Escape');
    const pergunta = dialogo(page, 'Discard changes?');
    await expect(pergunta).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pergunta).toBeHidden();
    await expect(pix).toBeVisible();
    await expect(pix.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Pix 2');
  });
});
