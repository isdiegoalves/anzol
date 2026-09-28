import { createHmac } from 'node:crypto';
import { APIRequestContext, Locator, Page } from '@playwright/test';
import { TokenTracker, Webhook, expect, test } from './support/fixtures';
import { filtro, itens, abrirFiltros } from './support/inbox';
import { abrirRegra, abrirRegras, linhaDaRegra, metodo, novaRegra, parte } from './support/regras';

// Patamar, B1 (guia-combinacao §3.1 e §7): os chips ficam recolhidos atrás do `button "Filters"`; `abrirFiltros()`
// abre o painel antes de usar um chip.

// Item 14.1, fase 2, fatia F3-2 (fidelidade ao protótipo C): os itens "discutir" de Rules e Insights que o dono
// decidiu adotar (`.docs-arquivo/fidelidade-prototipo/discutir-decididos.json`), com o ajuste do `porque` nos
// "adotar-adaptado". Cor e tipografia (RULES-25, o h1 do RULES-06, a caixa do RULES-15, a barra de proporção do
// RULES-21) ficam para a regressão visual; o RULES-26 (aria-current) já está na F3. SUPOSIÇÕES:
// - RULES-06: ao lado do h1 "Rules", o contador "N · M on"; a frase "Checked by priority, lowest first. The first
//   enabled rule that matches answers; if none does, the URL's default response does."; "Import" e "Export" viram
//   botões de ícone com o mesmo nome acessível e `title`; a linha "Hits over the last N requests kept." fica;
// - RULES-08: a regra desligada mostra o chip "OFF" e, no lugar dos hits, "Not checked while off";
// - RULES-12: o painel de cenários sai de baixo da lista e vai para a aba Scenario do editor, na seção "Scenarios on
//   this URL", com os nomes que o regras-fase-b cobra (`table "Scenarios"`, "Set state", "Reset all", "Refresh",
//   `combobox "New state of {cenário}"`);
// - RULES-15: a regra em palavras é o parágrafo com `aria-label="Rule in plain words"`, sem o rótulo "In plain
//   words:", com o método e o status em `<strong>` e o caminho em `<code>`;
// - RULES-16: o "Describe the rule" (Suggest) vem recolhido; abre pelo próprio título;
// - RULES-21: quando a mensagem foi respondida pela resposta padrão, a prévia diz "N would now get {status} from this
//   rule instead of the default {status}";
// - RULES-23: o atraso vira `radiogroup "Delay"` ("None", "Fixed", "Uniform", "Log-normal") com "Before answering; up
//   to 60 s."; o Dribble diz "Send the body in chunks over time"; o switch "Template" fica na linha do rótulo do
//   corpo, acima do campo; a dica da falha ("With a fault, … are ignored") fica sempre à vista;
// - RULES-38: em Insights, a janela é o `combobox "Window"` com "Last 50", "Last 200" e "Last 500" (padrão "Last
//   500", a janela de E9), e cada motivo de assinatura e caminho de schema é um `link` para a Inbox filtrada
//   (`?signature=invalid`, `?signature=absent`, `?schema=invalid`), como o Health (CHECKS-17);
// - RULES-39: o KPI Requests diz "N of the N kept" quando a URL guarda menos que a janela e "the newest 500 of N
//   kept" quando guarda mais.

const SECRET = 'segredo-da-fidelidade-f3-2';

function github(secret: string | null, body: string): Webhook {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) {
    headers['X-Hub-Signature-256'] =
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }
  return { headers, data: body };
}

async function putRules(api: APIRequestContext, tokenId: string, rules: object[]): Promise<void> {
  const response = await api.put(`/token/${tokenId}/rules`, { data: rules });
  expect(response.status(), await response.text()).toBe(200);
}

function textoVisivel(el: Locator): Promise<string> {
  return el.evaluate((no) => (no as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
}

async function mesmaLinha(a: Locator, b: Locator): Promise<boolean> {
  const [ca, cb] = [await a.boundingBox(), await b.boundingBox()];
  return !!ca && !!cb && Math.abs(ca.y + ca.height / 2 - (cb.y + cb.height / 2)) <= 12;
}

const REGRAS = [
  { name: 'Pix', priority: 1, match: { method: ['POST'] }, response: { status: 201 } },
  { name: 'Parada', priority: 2, enabled: false, response: { status: 503 } },
  {
    name: 'Falha 1',
    priority: 3,
    scenario: { name: 'entrega', requiredState: 'Started', newState: 'falhou-1' },
    response: { status: 503 },
  },
  {
    name: 'Sucesso',
    priority: 4,
    scenario: { name: 'entrega', requiredState: 'falhou-1' },
    response: { status: 200 },
  },
];

async function urlComRegras(request: APIRequestContext, tokens: TokenTracker): Promise<string> {
  const tokenId = await tokens.create();
  await putRules(request, tokenId, REGRAS);
  return tokenId;
}

test.describe('Dado o cabeçalho e as linhas da lista de regras (RULES-06/08)', () => {
  test('deve contar as regras ligadas, resumir a frase e marcar a desligada com OFF', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await urlComRegras(request, tokens);
    // UX de Regras, WM-29: sem mensagens a linha diz "No requests yet…"; com uma, "Hits over the last 1 request
    // kept.", que é o que este teste confere. Um POST: a "Pix" responde e o cenário "entrega" fica em Started.
    await tokens.send(tokenId, { method: 'POST' });
    await abrirRegras(page, tokenId);

    const titulo = page.getByRole('heading', { name: 'Rules', level: 1 });
    const contador = page.getByText('4 · 3 on', { exact: true });
    await expect(contador).toBeVisible();
    expect(await mesmaLinha(titulo, contador)).toBe(true);
    // UX de Regras, guia §1 (WM-08): a frase do modelo mental substitui a "Checked by priority…".
    await expect(
      page.getByText(
        /^Rules are checked in this order\. The first one that matches answers\. A catch-all rule answers whatever is left; the URL['’]s default response answers when no rule does\.$/,
      ),
    ).toBeVisible();
    // UX de Regras, WM-19 (guia §3.1): "Import" e "Export" voltam a ter rótulo visível (deixam de ser só ícone).
    for (const nome of ['Import', 'Export']) {
      const botao = page.getByRole('button', { name: nome, exact: true });
      expect(await textoVisivel(botao)).toBe(nome);
    }
    await expect(page.getByText(/^Hits over the last \d+ requests? kept\.$/)).toBeVisible();

    const parada = linhaDaRegra(page, 'Parada');
    await expect(parada.getByText('OFF', { exact: true })).toBeVisible();
    await expect(parada.locator('.hits')).toHaveText('Not checked while off');
  });
});

test.describe('Dado os cenários da URL (RULES-12)', () => {
  test('deve mostrá-los na aba Scenario do editor, e não abaixo da lista', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await urlComRegras(request, tokens);
    await abrirRegras(page, tokenId);
    await expect(page.getByRole('table', { name: 'Scenarios' })).toHaveCount(0);

    const regra = await abrirRegra(page, 'Falha 1');
    await parte(regra, 'Scenario');
    const secao = regra.locator('section', {
      has: page.getByRole('heading', { name: 'Scenarios on this URL' }),
    });
    const linha = secao
      .getByRole('table', { name: 'Scenarios' })
      .locator('tr[data-scenario="entrega"]');
    await expect(linha).toContainText('Started');
    await expect(secao.getByRole('button', { name: 'Reset all' })).toBeVisible();
    await expect(secao.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(linha.getByRole('button', { name: 'Set state' })).toBeVisible();
    await expect(secao.getByRole('combobox', { name: 'New state of entrega' })).toBeVisible();
  });
});

test.describe('Dado o topo do editor (RULES-15/16)', () => {
  test('deve mostrar a regra em palavras com destaque e o Suggest recolhido', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);

    const descrever = regra.getByRole('textbox', { name: 'Describe the rule' });
    await expect(descrever).toBeHidden();
    await regra.getByText('Describe the rule', { exact: true }).click();
    await expect(descrever).toBeVisible();

    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Pix');
    await metodo(regra, 'POST');
    // "Any path" é o padrão e deixa o Path desabilitado.
    await regra.getByRole('combobox', { name: 'Path match' }).click();
    await page.getByRole('option', { name: 'Equals', exact: true }).click();
    await regra.getByRole('textbox', { name: 'Path', exact: true }).fill('/pagamentos');
    await parte(regra, 'Response');
    await regra.getByRole('spinbutton', { name: 'Status' }).fill('201');

    const frase = regra.getByLabel('Rule in plain words');
    await expect(frase).toHaveText(/^When a POST to \/pagamentos\b.*answer 201\.$/);
    await expect(frase).not.toContainText('In plain words:');
    await expect(frase.locator('strong', { hasText: 'POST' })).toBeVisible();
    await expect(frase.locator('code', { hasText: '/pagamentos' })).toBeVisible();
    await expect(frase.locator('strong', { hasText: '201' })).toBeVisible();
  });
});

test.describe('Dado a prévia contra o histórico de uma mensagem da resposta padrão (RULES-21)', () => {
  test('deve dizer o status que a mensagem recebia antes', async ({ page, tokens }) => {
    const tokenId = await tokens.create();
    await tokens.send(tokenId, { path: '/y' });
    await abrirRegras(page, tokenId);

    const regra = await novaRegra(page);
    await regra.getByRole('textbox', { name: 'Name', exact: true }).fill('Nova');
    await parte(regra, 'Response');
    await regra.getByRole('spinbutton', { name: 'Status' }).fill('202');
    await regra.getByRole('button', { name: 'Test against history' }).click();

    await expect(
      regra.getByText(/^1 would now get 202 from this rule instead of the default 200$/),
    ).toBeVisible();
  });
});

test.describe('Dado a aba Response do editor (RULES-23)', () => {
  test('deve ter o atraso em segmentado, o Template na linha do corpo e as dicas à vista', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    await abrirRegras(page, tokenId);
    const regra = await novaRegra(page);
    await parte(regra, 'Response');

    const atraso = regra.getByRole('radiogroup', { name: 'Delay' });
    await expect(atraso.getByRole('radio')).toHaveText(['None', 'Fixed', 'Uniform', 'Log-normal']);
    await expect(atraso.getByRole('radio', { name: 'None' })).toBeChecked();
    await expect(regra.getByText(/^Before answering; up to 60 s\.?$/)).toBeVisible();
    await atraso.getByRole('radio', { name: 'Fixed' }).click();
    await expect(regra.getByRole('spinbutton', { name: 'Delay (ms)' })).toBeVisible();

    await expect(regra.getByText('Send the body in chunks over time')).toBeVisible();
    await expect(
      regra.getByText(/With a fault, (the )?status, headers, body, delay and dribble are ignored/),
    ).toBeVisible();

    const template = await regra.getByRole('switch', { name: 'Template' }).boundingBox();
    const corpo = await regra.getByRole('textbox', { name: 'Response body' }).boundingBox();
    expect(template!.y + template!.height).toBeLessThanOrEqual(corpo!.y);
  });
});

/** Abre Insights e espera o resumo. */
async function abrirInsights(page: Page, tokenId: string): Promise<void> {
  await page.goto(`/#/${tokenId}/insights`);
  await expect(page.getByRole('region', { name: 'Summary' })).toBeVisible();
}

test.describe('Dado Insights com falhas de assinatura e de schema (RULES-38/39)', () => {
  test('deve ter a janela 50/200/500, dizer quantas a URL guarda e levar cada motivo à Inbox filtrada', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({
      signature: { provider: 'github', secret: SECRET },
      schema: { type: 'object', properties: { id: { type: 'integer' } } },
    });
    await tokens.send(tokenId, github('outro-segredo', '{"id":1}'));
    await tokens.send(tokenId, github(null, '{"id":2}'));
    await tokens.send(tokenId, github(SECRET, '{"id":"3"}'));
    await abrirInsights(page, tokenId);

    await expect(page.getByRole('region', { name: 'Summary' })).toContainText(
      /\b3 of the 3 kept\b/,
    );
    const janela = page.getByRole('combobox', { name: 'Window' });
    await expect(janela).toContainText('Last 500');
    await janela.click();
    await expect(page.getByRole('option')).toHaveText(['Last 50', 'Last 200', 'Last 500']);
    await page.keyboard.press('Escape');

    const casos: [string, RegExp, string][] = [
      ['Signature', /signature mismatch/, 'signature=invalid'],
      ['Signature', /header X-Hub-Signature-256 absent/, 'signature=absent'],
      ['Schema', /\/id/, 'schema=invalid'],
    ];
    for (const [regiao, motivo, parametro] of casos) {
      await expect(
        page.getByRole('region', { name: regiao, exact: true }).getByRole('link', { name: motivo }),
      ).toHaveAttribute('href', new RegExp(`#/${tokenId}\\?${parametro}$`));
    }
    await page
      .getByRole('region', { name: 'Signature', exact: true })
      .getByRole('link', { name: /signature mismatch/ })
      .click();
    // Na janela larga a Inbox abre sozinha uma mensagem, e a rota ganha o id dela: em vez da rota exata, espera o
    // filtro aplicado (o chip pressionado e só a mensagem de assinatura inválida na lista).
    await expect(page).toHaveURL(new RegExp(`#/${tokenId}(/[^?]*)?\\?signature=invalid$`));
    await abrirFiltros(page);
    await expect(filtro(page, 'Signature invalid')).toHaveAttribute('aria-pressed', 'true');
    await expect(itens(page)).toHaveCount(1);
  });

  test('deve dizer "the newest 500 of N kept" Quando a URL guarda mais que a janela', async ({
    page,
    tokens,
  }) => {
    test.setTimeout(120_000);
    const tokenId = await tokens.create();
    await tokens.sendMany(tokenId, 510);
    await abrirInsights(page, tokenId);
    await expect(page.getByRole('region', { name: 'Summary' })).toContainText(
      /\bthe newest 500 of 510 kept\b/,
    );
  });
});
