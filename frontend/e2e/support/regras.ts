import { Locator, Page } from '@playwright/test';
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
 * - SUPOSIÇÃO: a regra "em palavras" é o parágrafo "In plain words: When …";
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
