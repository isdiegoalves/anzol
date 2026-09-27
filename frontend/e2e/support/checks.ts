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

/** Abre `#/{token}/checks` e espera o token vir do servidor (os campos vêm preenchidos com ele). */
export async function abrirChecks(page: Page, tokenId: string, nome: Secao): Promise<Locator> {
  await page.goto(`/#/${tokenId}/checks`);
  await expect(page.getByRole('heading', { name: 'Checks', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
    new RegExp(`/${tokenId}$`),
  );
  const regiao = secao(page, nome);
  await expect(regiao).toBeVisible();
  return regiao;
}

export type Salvar = 'Save signature' | 'Save schema' | 'Save response' | 'Save privacy';

/** Clica no Save do cartão, espera a resposta do `PUT /token/{id}` e devolve o corpo dele. */
export async function salvar(
  page: Page,
  regiao: Locator,
  botao: Salvar,
  tokenId: string,
): Promise<Record<string, unknown>> {
  const put = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && response.url().endsWith(`/token/${tokenId}`),
  );
  await regiao.getByRole('button', { name: botao, exact: true }).click();
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

/** O resumo do que falta depois de clicar no Save (`alert` "N fields need attention: …", CHECKS-13). */
export function pendenteAlerta(regiao: Locator): Locator {
  return regiao.getByRole('alert').filter({ hasText: ATENCAO });
}

/** O resumo do que falta, em `status` ou `alert` (o texto muda conforme os campos são preenchidos). */
export function resumo(regiao: Locator): Locator {
  return regiao
    .getByRole('status')
    .filter({ hasText: /^To save, (fill in|fix):/ })
    .or(regiao.getByRole('alert').filter({ hasText: ATENCAO }));
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
