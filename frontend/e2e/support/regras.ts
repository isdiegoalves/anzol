import { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * Rules da interface nova (item 14, E6): o editor sai do diálogo e vira a `region "New rule"` / `region "Edit rule
 * {nome}"` ao lado da lista, na mesma página (S15: mesmo nome, papel `region`). Nomes combinados com a fatia
 * (front-rules) e marcados SUPOSIÇÃO onde a §1 não os fixa:
 *
 * - SUPOSIÇÃO: a lista continua `table "Rules"` com `tbody tr[data-rule-id]`, `td.data` (nome, prioridade, match,
 *   status), `td.name`, `.flag`, `switch "Enable rule {nome}"`, "Move up"/"Move down", "Edit", "Delete" e a alça
 *   `button "Reorder {nome}"` (arrasto e ↑/↓, com o anúncio "{nome} moved to position N of M"); os hits da janela
 *   de `stats` em `td.hits` ("Answered N", "· N near misses"); a resposta padrão fixa no `tfoot` ("Default
 *   response"), com a frase "Hits over the last N requests kept." acima da tabela;
 * - SUPOSIÇÃO: o editor tem `tablist "Rule parts"` com as abas "Match", "Response", "Scenario" e "Test" (os campos
 *   de hoje, com os mesmos nomes, dentro de cada aba; "Name" e a visão Form/JSON acima das abas); "Test against
 *   history" seleciona a aba Test; "Save" continua desabilitado com o formulário inválido;
 * - SUPOSIÇÃO: salvar volta a `#/{token}/rules` (a região some) com o snackbar "Rule saved"; o aviso "View rules"
 *   deixa de existir; "Create rule from this request" leva a `#/{token}/rules/new?from={id}`;
 * - SUPOSIÇÃO: a regra "em palavras" é o parágrafo `aria-label="Rule in plain words"` ("When …", sem o rótulo "In
 *   plain words:"; fidelidade ao C, fase 2, RULES-15);
 * - SUPOSIÇÃO: conflito de leitura (a lista mudou no servidor desde a leitura) → `alert` "The rules changed elsewhere
 *   …" com `button "Reload"`, sem salvar.
 */

/*
 * Fidelidade ao protótipo C (item 14.1, F3), nomes combinados com a fatia (front-rules):
 * - SUPOSIÇÃO (RULES-01/02/03/04): cada `tbody tr[data-rule-id]` tem a célula `td.item` com um `button` que abre o
 *   editor (nome acessível = nome da regra; `aria-current="true"` na aberta); dentro dele `.priority` ("P5"),
 *   `.name`, `.flag`, `app-status-code.status`, `.match` (todas as condições, " · " entre elas) e `.hits` ("Answered
 *   N of the last M", "· N near misses"; a transição do cenário antes). Saem os botões "Edit" e "Delete" da linha;
 *   ficam a alça, o switch e "Move up"/"Move down" (trava 8);
 * - SUPOSIÇÃO (RULES-13): o editor tem no topo `textbox "Name"`, o chip "Unsaved changes", `spinbutton "Priority"`,
 *   `switch "Enabled"`, `button "Delete rule"` (regra salva), "Discard" (no lugar de "Cancel") e um "Save" só; o
 *   "Test against history" fica na barra das abas;
 * - SUPOSIÇÃO (RULES-17): `group "Methods"` com `button[aria-pressed]` por método; `radiogroup "Signature"` e
 *   `radiogroup "Schema"` com "Any", "Valid", "Invalid" (e "Absent" na assinatura).
 */

export type ParteDaRegra = 'Match' | 'Response' | 'Scenario' | 'Test';

/** A linha de uma regra na `table "Rules"`, pelo botão que abre o editor. */
export function linhaDaRegra(page: Page, nome: string): Locator {
  return page
    .getByRole('table', { name: 'Rules' })
    .locator('tbody tr[data-rule-id]')
    .filter({ has: page.locator('td.item').getByRole('button', { name: nome, exact: true }) });
}

/** Abre o editor de uma regra salva pela linha dela (RULES-04: a linha inteira abre o editor). */
export async function abrirRegra(page: Page, nome: string): Promise<Locator> {
  await linhaDaRegra(page, nome).locator('td.item').getByRole('button').click();
  const regiao = editor(page, `Edit rule ${nome}`);
  await expect(regiao).toBeVisible();
  return regiao;
}

/** As regras da lista como [nome, prioridade (sem o "P"), match, status]. */
export function linhasDasRegras(page: Page): Promise<string[][]> {
  return page
    .getByRole('table', { name: 'Rules' })
    .locator('tbody tr[data-rule-id]')
    .evaluateAll((trs) =>
      trs.map((tr) => {
        const texto = (seletor: string) =>
          tr.querySelector(seletor)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        return [
          texto('.name'),
          texto('.priority').replace(/^P/, ''),
          texto('.match'),
          (/\d{3}/.exec(texto('.status')) ?? [''])[0],
        ];
      }),
    );
}

/** Marca um método no `group "Methods"` do editor. */
export async function metodo(regiao: Locator, nome: string): Promise<void> {
  const chip = regiao
    .getByRole('group', { name: 'Methods' })
    .getByRole('button', { name: nome, exact: true });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
}

/** Escolhe a condição de assinatura ou de schema no segmentado. */
export async function condicao(
  regiao: Locator,
  grupo: 'Signature' | 'Schema',
  valor: 'Any' | 'Valid' | 'Invalid' | 'Absent',
): Promise<void> {
  const radio = regiao.getByRole('radiogroup', { name: grupo }).getByRole('radio', { name: valor });
  await radio.click();
  await expect(radio).toBeChecked();
}

/** Abre `#/{token}/rules` e espera a lista carregada (antes disso, salvar apagaria as regras salvas). */
export async function abrirRegras(page: Page, tokenId: string): Promise<void> {
  await page.goto(`/#/${tokenId}/rules`);
  await expect(page.getByRole('table', { name: 'Rules' })).toBeVisible();
}

/** A região do editor ("New rule" ou "Edit rule {nome}"). */
export function editor(page: Page, nome: 'New rule' | `Edit rule ${string}` = 'New rule'): Locator {
  return page.getByRole('region', { name: nome, exact: true });
}

/** "New rule" na página de regras; devolve o editor. */
export async function novaRegra(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'New rule', exact: true }).click();
  const regiao = editor(page);
  await expect(regiao).toBeVisible();
  return regiao;
}

/** Troca de aba no editor e espera ela ficar selecionada. */
export async function parte(regiao: Locator, nome: ParteDaRegra): Promise<void> {
  const aba = regiao
    .getByRole('tablist', { name: 'Rule parts' })
    .getByRole('tab', { name: nome, exact: true });
  await aba.click();
  await expect(aba).toHaveAttribute('aria-selected', 'true');
}

/** Salva e espera a volta à lista, com o aviso. */
export async function salvarRegra(page: Page, regiao: Locator, tokenId: string): Promise<void> {
  await regiao.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(regiao).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#/${tokenId}/rules$`));
  await expect(page.getByText('Rule saved')).toBeVisible();
}

/*
 * UX de Regras (iniciativa `regras-ux`, guia em `.docs-arquivo/regras-ux/guia-ux.md`): nomes acessíveis novos das
 * fatias F1–F9 e das telas de C1–C4, em inglês (texto-fonte do `$localize`). O que o guia não fixa está marcado
 * SUPOSIÇÃO no spec da fatia (`regras-ux-f*.spec.ts`).
 */

export type Regra = Record<string, unknown> & { id?: string; name: string };

/** `PUT /token/{id}/rules` (troca a lista inteira); devolve as regras com os ids. */
export async function gravarRegras(
  api: APIRequestContext,
  tokenId: string,
  regras: object[],
): Promise<Regra[]> {
  const resposta = await api.put(`/token/${tokenId}/rules`, { data: regras });
  expect(resposta.status(), await resposta.text()).toBe(200);
  return (await resposta.json()) as Regra[];
}

/** `GET /token/{id}/rules`. */
export async function lerRegras(api: APIRequestContext, tokenId: string): Promise<Regra[]> {
  return (await (await api.get(`/token/${tokenId}/rules`)).json()) as Regra[];
}

/**
 * F8: abaixo de 1200 px o editor vira folha de tela cheia (a lista some enquanto ele está aberto) e "Discard",
 * "Delete rule" e "Duplicate rule" vão para o `⋮` "More actions" do cabeçalho.
 */
export function celular(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1400) < 1200;
}

export type AcaoDoEditor = 'Discard' | 'Delete rule' | 'Duplicate rule';

/** Uma ação do cabeçalho do editor: botão no desktop; item do `⋮` "More actions" no celular (F8). */
export async function acaoDoEditor(page: Page, regiao: Locator, nome: AcaoDoEditor): Promise<void> {
  if (celular(page)) {
    await regiao.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: nome, exact: true }).click();
  } else {
    await regiao.getByRole('button', { name: nome, exact: true }).click();
  }
}

/** F8: no celular, "Back to list" fecha a folha do editor; no desktop a lista já está ao lado. */
export async function voltarALista(page: Page, regiao: Locator): Promise<void> {
  if (celular(page)) {
    await regiao.getByRole('button', { name: 'Back to list', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Rules' })).toBeVisible();
  }
}

/** Um diálogo (MatDialog) pelo título. */
export function dialogo(page: Page, nome: string | RegExp): Locator {
  return page.getByRole('dialog', { name: nome });
}

/** F1: o `alert` "To save, fix: …" / "To test, fix: …" logo abaixo do cabeçalho do editor. */
export function alertaParaCorrigir(regiao: Locator, acao: 'save' | 'test' = 'save'): Locator {
  return regiao.getByRole('alert').filter({ hasText: new RegExp(`To ${acao}, fix:`) });
}

/** F1: o `alert` do rascunho guardado na aba ("You have a draft from …"). */
export function alertaDeRascunho(regiao: Locator): Locator {
  return regiao.getByRole('alert').filter({ hasText: /You have a draft from/ });
}

/** Arquivo para "Import": caminho ou conteúdo. */
export type ArquivoDeRegras = string | { name: string; mimeType: string; buffer: Buffer };

/** Um arquivo de regras em memória. */
export function arquivoDeRegras(conteudo: unknown): ArquivoDeRegras {
  return {
    name: 'rules.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo)),
  };
}

/** F1: "Import" (botão com rótulo visível) → escolher o arquivo. Devolve o `dialog "Import rules"`. */
export async function importar(page: Page, arquivo: ArquivoDeRegras): Promise<Locator> {
  const seletor = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await seletor).setFiles(arquivo);
  return dialogo(page, 'Import rules');
}

/**
 * F1: importa substituindo tudo (o `radio "Replace the {m} saved rules"` e o `button "Replace"` do `dialog "Import
 * rules"`).
 */
export async function importarSubstituindo(page: Page, arquivo: ArquivoDeRegras): Promise<void> {
  const janela = await importar(page, arquivo);
  await expect(janela).toBeVisible();
  await janela.getByRole('radio', { name: /^Replace the \d+ saved rules?$/ }).check();
  await janela.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(janela).toBeHidden();
}

/** O `sessionStorage` da aba como texto (F1: o rascunho por regra fica ali). */
export function memoriaDaAba(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify({ ...sessionStorage }));
}

/** Aceita o `beforeunload` da guarda de rascunho nas recargas que o teste faz de propósito. */
export function aceitarSaida(page: Page): void {
  page.on('dialog', (janela) => {
    if (janela.type() === 'beforeunload') {
      void janela.accept();
    }
  });
}
