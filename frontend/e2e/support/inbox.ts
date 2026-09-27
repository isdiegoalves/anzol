import { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * Inbox da interface nova (item 14, E4): lista, busca, detalhe e página do link só-leitura. Os nomes vêm da tabela
 * "Nomes acessíveis" da §1 do plano; o que ela não fixa segue a implementação da E4 (18412de) e está marcado
 * SUPOSIÇÃO.
 *
 * - SUPOSIÇÃO: a coluna da lista é a `region "Request list"`; cada mensagem é um `.item` (a lista virtual do CDK),
 *   com o botão que abre a mensagem e a lixeira "Delete request {uuid}". O nome acessível do botão diz tudo o que o
 *   item mostra (C §2.1): "{MÉTODO} {rota}, #{5 primeiros do UUID}, from {IP}, {data}", o título e o motivo de cada
 *   verificação ("Signature invalid: signature mismatch") e "unread" enquanto não foi aberta; o item aberto tem
 *   `aria-current`. O selo visível é curto ("Sig OK", "Bad sig", "No sig", "Bad schema", "Near miss", o nome da
 *   regra que respondeu).
 * - SUPOSIÇÃO: o detalhe mantém `table "Request Details"` (linhas URL, Host, Date, ID, com o nome em `th`; S15)
 *   fora das abas; o método fica no selo do cabeçalho e o `heading` é a rota (caminho e query depois do token). As
 *   abas são `tab` "Body", "Headers (n)", "Query (n)", "Form (n)", com as tabelas "Headers", "Query strings" e "Form
 *   values" de hoje dentro delas (só a aba aberta fica no DOM).
 * - SUPOSIÇÃO: o corpo é o `app-code-view` da E2 com o nome acessível "Request body" (o `pre`; o XML realçado usa
 *   o mesmo nome); o texto de cada linha fica na sua `.line` e a mensagem de cada erro de schema numa `.mark` logo
 *   abaixo (C §2.2).
 * - SUPOSIÇÃO: os cartões do `group "Checks on this request"` mostram o título e a segunda linha do `pipelineOf`
 *   da E2 ("Signature valid" + provedor, "Schema invalid" + primeiro erro, "Answered by rule" + nome, "No rule
 *   matched" + "Closest: …"); no near miss, o `button "Why? (n)"` (com `aria-expanded`), logo abaixo do grupo, abre
 *   a `list "Conditions of {regra} that failed"` com as frases do `failed`.
 */

/** A coluna da lista (`region "Request list"`). */
export function lista(page: Page): Locator {
  return page.getByRole('region', { name: 'Request list', exact: true });
}

/** Os itens da lista (um por mensagem carregada). */
export function itens(page: Page): Locator {
  return lista(page).locator('.item');
}

/**
 * O item de uma mensagem, pelo `#` e os 5 primeiros caracteres do UUID no nome acessível do botão (fidelidade ao C,
 * INBOX-11: o `#id` pode sair da linha 1 e ficar só na linha 2 ou no nome acessível).
 */
export function item(page: Page, uuid: string): Locator {
  return itens(page).filter({
    has: page.getByRole('button', { name: new RegExp(`#${uuid.substring(0, 5)}`) }),
  });
}

/** O botão que abre a mensagem (o nome acessível resume o item). */
export function abrirItem(page: Page, uuid: string): Locator {
  return item(page, uuid).getByRole('button', {
    name: new RegExp(`#${uuid.substring(0, 5)}`),
  });
}

/**
 * Os metadados da mensagem aberta. Fidelidade ao C (INBOX-17, trava 3): a tabela "Request Details" vira uma linha de
 * metadados, com URL (link), Host + whois, data absoluta, ID completo, tamanho, seq e "Copy request ID".
 * SUPOSIÇÃO: a linha é o `group "Request metadata"` ("Metadados da requisição" em pt-BR).
 */
export function detalhes(page: Page): Locator {
  return page.getByRole('group', { name: 'Request metadata' });
}

/** Abre `#/{token}/{mensagem}/1` e espera o detalhe dela. */
export async function abrirMensagem(page: Page, tokenId: string, requestId: string): Promise<void> {
  await page.goto(`/#/${tokenId}/${requestId}/1`);
  await expect(detalhes(page)).toContainText(requestId);
}

/** `group "Checks on this request"`: os cartões de assinatura, schema e regra do detalhe. */
export function verificacoes(page: Page): Locator {
  return page.getByRole('group', { name: 'Checks on this request' });
}

/** O `button "Why? (n)"` do near miss. */
export function porque(page: Page): Locator {
  return page.getByRole('button', { name: /^Why\? \(\d+\)$/ });
}

/** As frases do `failed` do near miss (depois do "Why? (n)"). */
export function falhas(page: Page): Locator {
  return page.getByRole('list', { name: /^Conditions of .* that failed$/ }).getByRole('listitem');
}

/** `toolbar "Request actions"`: Replay…, Send as new…, Compare with…, Create rule…, Copy payload, Copy As… */
export function acoes(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Request actions' });
}

export type Aba = 'Body' | 'Headers' | 'Query' | 'Form';

/** A aba do detalhe: "Body" ou "Headers (n)", "Query (n)", "Form (n)". */
export function aba(page: Page, nome: Aba): Locator {
  return page.getByRole('tab', {
    name: nome === 'Body' ? /^Body\b/ : new RegExp(`^${nome} \\(\\d+\\)$`),
  });
}

/** Troca de aba e espera ela ficar selecionada. */
export async function abrirAba(page: Page, nome: Aba): Promise<void> {
  await aba(page, nome).click();
  await expect(aba(page, nome)).toHaveAttribute('aria-selected', 'true');
}

/** O bloco do corpo (`app-code-view`, "Request body"). */
export function corpo(page: Page): Locator {
  return page.getByLabel('Request body', { exact: true });
}

/**
 * O texto do corpo como aparece: uma linha por `.line` do `app-code-view` (sem número de linha nem as marcas de
 * schema); sem `.line` (ex.: XML realçado à parte), o `innerText` do bloco.
 */
export function textoDoCorpo(page: Page): Promise<string> {
  return corpo(page).evaluate((bloco) => {
    const partes = [...bloco.querySelectorAll('.line')];
    return partes.length > 0
      ? partes.map((linha) => linha.textContent ?? '').join('\n')
      : (bloco as HTMLElement).innerText.replace(/\n$/, '');
  });
}

/** Espera o corpo mostrar exatamente `texto`. */
export async function expectCorpo(page: Page, texto: string): Promise<void> {
  await expect(corpo(page)).toBeVisible();
  await expect.poll(() => textoDoCorpo(page)).toBe(texto);
}

/** As mensagens de erro de schema marcadas no corpo (C §2.2: "erros de schema na linha do JSON"). */
export function marcasDeSchema(page: Page): Locator {
  return corpo(page).locator('.mark');
}

/**
 * Linhas de uma tabela (`th` e `td` de cada `tr` do `tbody`, com as células separadas por espaço). Serve à tabela de hoje (só
 * `td`) e ao `app-kv-table` da E2 (nome em `th`).
 */
export function linhas(page: Page | Locator, tabela: string): Promise<string[]> {
  return page
    .getByRole('table', { name: tabela })
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs
        .map((tr) =>
          [...tr.querySelectorAll('th, td')]
            .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim())
            .join(' '),
        )
        .filter((texto) => texto !== ''),
    );
}

/** A região de busca (`search`) e o campo de texto dela. */
export function busca(page: Page): Locator {
  return page.getByRole('search');
}

export function campoDeBusca(page: Page): Locator {
  const regiao = busca(page);
  return regiao
    .getByRole('searchbox', { name: 'Search' })
    .or(regiao.getByRole('textbox', { name: 'Search' }));
}

/** `group "Filters"` com os chips (`button[aria-pressed]`). */
export function filtro(page: Page, nome: string): Locator {
  return page
    .getByRole('group', { name: 'Filters' })
    .getByRole('button', { name: nome, exact: true });
}

/** Os anúncios do `LiveAnnouncer` (CDK), que a E4 usa para as chegadas (C §2.8). */
export function anuncios(page: Page): Locator {
  return page.locator('[aria-live="polite"], [aria-live="assertive"]');
}
