import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { abrirChecks } from './support/checks';
import { TokenTracker, Webhook, expect, test } from './support/fixtures';
import { filtro, item, itens } from './support/inbox';

// Decisões do Anzol, M1 — a Entrada filtra pelo motivo exato (`.docs-arquivo/decisoes-anzol/api.md`): a busca ganha
// `signature_reason` (o `reason` sem o parêntese final, como o Health mostra) e `schema_path` (JSON Pointer), e o
// "Show in Inbox" do Health passa a usá-los em vez do largo `?signature=invalid` / `?schema=invalid`. SUPOSIÇÕES:
// - SUPOSIÇÃO: o filtro vai para a rota junto dos parâmetros de hoje (`?signature=invalid&…` / `?schema=invalid&…`),
//   num parâmetro próprio cujo nome o teste não fixa; o teste só exige o texto do motivo ou do caminho na query
//   (codificado com `%20` ou `+`, e `/` como `/` ou `%2F`).
// - SUPOSIÇÃO: o filtro ativo é um chip do `group "Filters"` (`button[aria-pressed="true"]`), como "Answered by:
//   {nome}", com o nome "Signature: {motivo}" / "Schema: {caminho}"; o teste exige só o motivo ou o caminho no nome.
//   Remover = clicar no chip (como os chips de desfecho de C2); se houver um `button "Remove …"` à parte, ele é usado.
// - SUPOSIÇÃO: remover o chip do motivo deixa o filtro largo da rota (`Signature invalid` / `Schema invalid`), e a
//   lista volta a mostrar as outras mensagens daquele estado.

const SECRET = 'segredo-do-motivo-exato';
const SCHEMA = {
  type: 'object',
  properties: { id: { type: 'integer' }, valor: { type: 'number' } },
};

function stripe(secret: string, body: string, t = Math.floor(Date.now() / 1000)): Webhook {
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return {
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
    data: body,
  };
}

interface Cenario {
  tokenId: string;
  /** Assinatura: fora da tolerância (1000 s); schema válido. */
  velhaValida: string;
  /** Assinatura: fora da tolerância (2000 s); schema: `/valor` errado. */
  velhaValor: string;
  /** Assinatura: segredo errado ("signature mismatch"); schema: `/id` errado. */
  trocadaId: string;
  /** Assinatura válida; schema: `/valor` errado. */
  certaValor: string;
}

/**
 * Quatro mensagens com motivos e caminhos misturados: o filtro largo pega 3 em cada lado, o exato só 2 (ou 1). Assim
 * o teste distingue o filtro exato do largo de hoje.
 */
async function cenario(tokens: TokenTracker): Promise<Cenario> {
  const tokenId = await tokens.create({
    signature: { provider: 'stripe', secret: SECRET },
    schema: SCHEMA,
  });
  const agora = Math.floor(Date.now() / 1000);
  return {
    tokenId,
    velhaValida: await tokens.send(tokenId, stripe(SECRET, '{"id":1,"valor":10}', agora - 1000)),
    velhaValor: await tokens.send(tokenId, stripe(SECRET, '{"id":2,"valor":"dez"}', agora - 2000)),
    trocadaId: await tokens.send(tokenId, stripe('outro-segredo', '{"id":"3","valor":5}')),
    certaValor: await tokens.send(tokenId, stripe(SECRET, '{"id":4,"valor":"x"}')),
  };
}

/** O chip do filtro ativo com o motivo ou o caminho no nome. */
function chipDo(page: Page, texto: string): Locator {
  const escapado = texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page
    .getByRole('group', { name: 'Filters' })
    .getByRole('button', { name: new RegExp(escapado) })
    .first();
}

/** A query da rota com o texto (espaço como `%20` ou `+`, barra crua ou `%2F`). */
function naQuery(texto: string): RegExp {
  const partes = texto
    .split('')
    .map((c) =>
      c === ' ' ? '(%20|\\+)' : c === '/' ? '(/|%2F)' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('');
  return new RegExp(`\\?.*${partes}`, 'i');
}

/** Clica no "Show in Inbox" da linha do Health e espera a Entrada. */
async function mostrarNaEntrada(page: Page, tokenId: string, linha: RegExp): Promise<void> {
  const health = await abrirChecks(page, tokenId, 'Health');
  const link = health.getByRole('link', { name: linha });
  await expect(link).toContainText('Show in Inbox');
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#/${tokenId}(/[0-9a-f-]{36}/\\d+)?\\?`));
}

/** Remove o chip do filtro: o `button "Remove …"` se existir, senão o próprio chip. */
async function removerChip(page: Page, texto: string): Promise<void> {
  const chip = chipDo(page, texto);
  const remover = page
    .getByRole('group', { name: 'Filters' })
    .getByRole('button', {
      name: new RegExp(`^Remove\\b.*${texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    });
  if ((await remover.count()) > 0) {
    await remover.first().click();
  } else {
    await chip.click();
  }
}

test.describe('Dado o Health com motivos de assinatura e caminhos de schema (M1)', () => {
  test('deve abrir a Entrada só com as mensagens do motivo "timestamp outside tolerance"', async ({
    page,
    tokens,
  }) => {
    const c = await cenario(tokens);
    const health = await abrirChecks(page, c.tokenId, 'Health');
    const link = health.getByRole('link', { name: /timestamp outside tolerance/ });
    await expect(link).toHaveAttribute('href', naQuery('timestamp outside tolerance'));

    await mostrarNaEntrada(page, c.tokenId, /timestamp outside tolerance/);

    await expect(page).toHaveURL(naQuery('timestamp outside tolerance'));
    await expect(chipDo(page, 'timestamp outside tolerance')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(itens(page)).toHaveCount(2);
    await expect(item(page, c.velhaValida)).toBeVisible();
    await expect(item(page, c.velhaValor)).toBeVisible();
    await expect(item(page, c.trocadaId)).toHaveCount(0);
  });

  test('deve abrir a Entrada só com as mensagens do caminho de schema "/valor"', async ({
    page,
    tokens,
  }) => {
    const c = await cenario(tokens);
    const health = await abrirChecks(page, c.tokenId, 'Health');
    await expect(health.getByRole('link', { name: /\/valor/ })).toHaveAttribute(
      'href',
      naQuery('/valor'),
    );

    await mostrarNaEntrada(page, c.tokenId, /\/valor/);

    await expect(page).toHaveURL(naQuery('/valor'));
    await expect(chipDo(page, '/valor')).toHaveAttribute('aria-pressed', 'true');
    await expect(itens(page)).toHaveCount(2);
    await expect(item(page, c.velhaValor)).toBeVisible();
    await expect(item(page, c.certaValor)).toBeVisible();
    await expect(item(page, c.trocadaId)).toHaveCount(0);
  });

  test('deve abrir só a mensagem do caminho "/id", e não as de "/valor"', async ({
    page,
    tokens,
  }) => {
    const c = await cenario(tokens);

    await mostrarNaEntrada(page, c.tokenId, /\/id\b/);

    await expect(chipDo(page, '/id')).toHaveAttribute('aria-pressed', 'true');
    await expect(itens(page)).toHaveCount(1);
    await expect(item(page, c.trocadaId)).toBeVisible();
  });
});

test.describe('Dado a Entrada filtrada por um motivo exato (M1)', () => {
  test('deve manter o filtro ao recarregar a página', async ({ page, tokens }) => {
    const c = await cenario(tokens);
    await mostrarNaEntrada(page, c.tokenId, /timestamp outside tolerance/);
    await expect(itens(page)).toHaveCount(2);

    await page.reload();

    await expect(page).toHaveURL(naQuery('timestamp outside tolerance'));
    await expect(chipDo(page, 'timestamp outside tolerance')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(itens(page)).toHaveCount(2);
    await expect(item(page, c.trocadaId)).toHaveCount(0);
  });

  test('deve voltar à lista sem o filtro do motivo Quando o chip é removido', async ({
    page,
    tokens,
  }) => {
    const c = await cenario(tokens);
    await mostrarNaEntrada(page, c.tokenId, /timestamp outside tolerance/);
    await expect(itens(page)).toHaveCount(2);

    await removerChip(page, 'timestamp outside tolerance');

    await expect(chipDo(page, 'timestamp outside tolerance')).toHaveCount(0);
    await expect(page).not.toHaveURL(naQuery('timestamp outside tolerance'));
    await expect(item(page, c.trocadaId)).toBeVisible();
    await expect(item(page, c.velhaValida)).toBeVisible();
  });

  test('deve voltar à lista sem o filtro do caminho Quando o chip é removido', async ({
    page,
    tokens,
  }) => {
    const c = await cenario(tokens);
    await mostrarNaEntrada(page, c.tokenId, /\/valor/);
    await expect(itens(page)).toHaveCount(2);

    await removerChip(page, '/valor');

    await expect(chipDo(page, '/valor')).toHaveCount(0);
    await expect(page).not.toHaveURL(naQuery('/valor'));
    await expect(item(page, c.trocadaId)).toBeVisible();
    // O filtro largo continua, se ficou (SUPOSIÇÃO): "Schema invalid" ligado não esconde as de schema errado.
    if ((await filtro(page, 'Schema invalid').getAttribute('aria-pressed')) === 'true') {
      await expect(item(page, c.velhaValida)).toHaveCount(0);
    }
  });
});
