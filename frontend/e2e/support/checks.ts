import { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * Fidelidade ao C, fase 2 (CHECKS-13): antes do Save, o `status` continua "To save, fill in: …" / "To save, fix: …";
 * depois do clique, o `alert` conta os campos: "N fields need attention: …" ("1 field needs attention: …").
 *
 * Checks da interface nova (item 14, E5): a configuração da URL sai do diálogo "Edit URL" e vira a página
 * `#/{token}/checks`, com um cartão (`region`) por assunto e um Save com nome único em cada um (§1, "Nomes
 * acessíveis"; §3 item 4). O que a §1 não fixa está marcado SUPOSIÇÃO e é o contrato que a E5 segue.
 *
 * - SUPOSIÇÃO: os campos de hoje mantêm os nomes ("Secret", "Signature header", "Prefix", "JSON Schema",
 *   "Default status code", "Content Type", "Timeout before response", "Response body", "Retry-After", "Secret to
 *   view", "Confirm secret") e as mensagens de erro de hoje.
 * - SUPOSIÇÃO: salvar um cartão responde com o snackbar "URL updated!" de hoje.
 * - SUPOSIÇÃO: o resumo do que falta fica à vista desde o início em `role=status` ("To save, fill in: …" ou "To
 *   save, fix: …", o texto de hoje) e, depois de clicar no Save, o mesmo texto passa a `role=alert` (S12); o Save
 *   aponta para ele por `aria-describedby`.
 * - SUPOSIÇÃO: `radiogroup "Signature provider"` com um `radio` por linha da tabela de provedores ("None",
 *   "Stripe", "GitHub", "Shopify", "Slack", "Generic"); o texto do radio é a linha (onde chega, o que é assinado,
 *   que segredo colar).
 * - SUPOSIÇÃO: o "Auto cleanup" é `radiogroup "Auto cleanup"` com os radios "Disabled", "500", "1000", "5000",
 *   "10000" (os valores de hoje), aqui e no "Create New URL".
 * - SUPOSIÇÃO: o "Create New URL" fica curto (S2): os campos da resposta (status, content-type, timeout, corpo,
 *   Retry-After e Auto cleanup) ficam no painel recolhido "Customize response" (um `button` com `aria-expanded`);
 *   a seção Privacy continua nele (criar já protegida é do item 12).
 */

export type Secao =
  'Signature verification' | 'Schema validation' | 'Response' | 'Privacy' | 'Health';

/** O cartão de uma seção de Checks. */
export function secao(page: Page, nome: Secao): Locator {
  return page.getByRole('region', { name: nome, exact: true });
}

/**
 * Patamar, B3 (guia-combinacao §3.3): abaixo de 840 px cada cartão é recolhível, e o cabeçalho dele é um `button`
 * com `aria-expanded` e o nome "{seção}, {estado}". Abre o cartão se estiver recolhido; na largura grande (ou na tela
 * de hoje, sem cabeçalho recolhível) não faz nada.
 */
export async function abrirCartao(page: Page, nome: Secao): Promise<void> {
  if ((page.viewportSize()?.width ?? 1400) >= 840) {
    return;
  }
  const cabecalho = page.getByRole('button', { name: new RegExp(`^${nome}(, .+)?$`) });
  if (
    (await cabecalho.count()) === 1 &&
    (await cabecalho.getAttribute('aria-expanded')) === 'false'
  ) {
    await cabecalho.click();
    await expect(cabecalho).toHaveAttribute('aria-expanded', 'true');
  }
}

/**
 * Abre `#/{token}/checks` e espera o token vir do servidor (os campos vêm preenchidos com ele). No celular abre o
 * cartão da seção (B3: cartões recolhíveis).
 */
export async function abrirChecks(page: Page, tokenId: string, nome: Secao): Promise<Locator> {
  await page.goto(`/#/${tokenId}/checks`);
  await expect(page.getByRole('heading', { name: 'Checks', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
    new RegExp(`/${tokenId}$`),
  );
  const regiao = secao(page, nome);
  await expect(regiao).toBeVisible();
  await abrirCartao(page, nome);
  return regiao;
}

/** `region "Unsaved changes"`: a barra de salvar de Verificações (B3), que só existe com alteração pendente. */
export function barraDeSalvar(page: Page): Locator {
  return page.getByRole('region', { name: 'Unsaved changes' });
}

/** `button "Save changes"` da barra (o texto visível leva o atalho: "Save changes · Ctrl+S"). */
export function botaoSalvar(page: Page): Locator {
  return barraDeSalvar(page).getByRole('button', { name: /^Save changes\b/ });
}

/**
 * Clica em "Save changes", espera a resposta do `PUT /token/{id}` e devolve o corpo dele. Patamar, B3 (CA-6): um
 * botão só para a página; o parâmetro do botão de cada cartão deixou de existir.
 */
export async function salvar(page: Page, tokenId: string): Promise<Record<string, unknown>> {
  const put = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && response.url().endsWith(`/token/${tokenId}`),
  );
  await botaoSalvar(page).click();
  // Espera a resposta deste PUT antes do aviso: o "URL updated!" de um save anterior não conta. O snackbar anterior
  // pode ainda estar no DOM, saindo (animação), num overlay mais antigo: o desta gravação é o último.
  const response = await put;
  const body = response.request().postDataJSON() as Record<string, unknown>;
  await expect(page.getByText('URL updated!').last()).toBeVisible();
  return body;
}

/** O resumo do que falta, antes de tentar salvar (`status`). */
export function pendente(regiao: Locator): Locator {
  return regiao.getByRole('status').filter({ hasText: /^To save, (fill in|fix):/ });
}

const ATENCAO = /^\d+ fields? needs? attention:/;

/**
 * O resumo do que falta depois de clicar no Save (`alert` "N fields need attention: …", CHECKS-13). Patamar, B3: em
 * Verificações o alerta é o resumo da barra de salvar; nos diálogos ("Create New URL") continua dentro deles.
 */
export function pendenteAlerta(regiao: Locator): Locator {
  return regiao
    .getByRole('alert')
    .filter({ hasText: ATENCAO })
    .or(barraDeSalvar(regiao.page()).getByRole('alert').filter({ hasText: ATENCAO }));
}

/** O resumo do que falta, em `status` ou `alert` (o texto muda conforme os campos são preenchidos). */
export function resumo(regiao: Locator): Locator {
  return regiao
    .getByRole('status')
    .filter({ hasText: /^To save, (fill in|fix):/ })
    .or(pendenteAlerta(regiao));
}

/** Escolhe o provedor na tabela que é também o seletor. */
export async function escolherProvedor(regiao: Locator, nome: string): Promise<void> {
  const radio = regiao
    .getByRole('radiogroup', { name: 'Signature provider' })
    .getByRole('radio', { name: new RegExp(`^${nome}\\b`) });
  await radio.click();
  await expect(radio).toBeChecked();
}

/** Escolhe o limite da limpeza automática (Checks › Response ou Create New URL). */
export async function escolherLimpeza(regiao: Locator, opcao: string): Promise<void> {
  const radio = regiao
    .getByRole('radiogroup', { name: 'Auto cleanup' })
    .getByRole('radio', { name: opcao, exact: true });
  await radio.click();
  await expect(radio).toBeChecked();
}

/** Abre o "Create New URL" pelo FAB e expande o "Customize response". */
export async function abrirCreate(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'New URL', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New URL' });
  await expect(dialog).toBeVisible();
  const painel = dialog.getByRole('button', { name: 'Customize response' });
  await expect(painel).toHaveAttribute('aria-expanded', 'false');
  await painel.click();
  await expect(painel).toHaveAttribute('aria-expanded', 'true');
  return dialog;
}
