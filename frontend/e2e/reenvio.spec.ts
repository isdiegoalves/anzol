import { IncomingHttpHeaders, Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { abrirMensagem, verificacoes } from './support/inbox';

// Reenvio pelo servidor e envio pela tela (CA-5): Replay na mensagem, Send na barra da URL (com e
// sem assinatura), "Send as new…" e a aba Outbound. Precisa do backend com
// `POST /token/{id}/request/{rid}/replay`, `POST /token/{id}/send` e `GET /token/{id}/outbound`,
// e de `WEBHOOK_OUTBOUND_ALLOW_PRIVATE=true` no stack: o receptor roda neste processo (no host) e
// o app, no container, o alcança por `host.docker.internal` (troque com E2E_RECEIVER_HOST).
//
// Item 14, E7: os diálogos Replay e Send viram o compositor da página Outbound (`region "Replay request"` e
// `region "Send request"`, S15) e o resultado fica na mesma página, na `region "Outbound detail"` (C §2.7).
// SUPOSIÇÕES (contrato da E7):
// - "Replay…" no detalhe leva a `#/{token}/outbound?replay={id}`; "Send as new…" a `?send-from={id}`; o "Send" do
//   cabeçalho da URL é um `link` (decisão do main) para `#/{token}/outbound?send=new`, com o compositor em Send;
//   os campos mantêm os nomes de hoje;
// - o resultado mostra o status pelo `app-status-code` ("201" e a frase), as tabelas "Response headers" e "Sent
//   headers" e o corpo no `app-code-view` "Response body"; o erro de saída é um `alert` com o título e a orientação
//   de hoje;
// - sem assinatura na URL, a dica do "Sign with this URL's signature" aponta para Checks: "This URL has no signature
//   configured. Set one up in Checks to sign." (o "Edit URL" deixou de existir na E5);
// - o histórico continua `table "Outbound history"`.

const RECEIVER_HOST = process.env['E2E_RECEIVER_HOST'] ?? 'host.docker.internal';
const SECRET = 'segredo-do-e2e-reenvio';

interface Received {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Receptor HTTP no host: guarda o que chega e responde 201 com um JSON e um header próprio. */
async function startReceiver(): Promise<{ url: string; received: Received[]; server: Server }> {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(201, { 'Content-Type': 'application/json', 'X-Receptor': 'e2e' });
      res.end('{"recebido":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://${RECEIVER_HOST}:${port}`, received, server };
}

let receiver: Awaited<ReturnType<typeof startReceiver>>;

test.beforeEach(async () => {
  receiver = await startReceiver();
});

test.afterEach(async () => {
  await new Promise((resolve) => receiver.server.close(resolve));
});

async function openRequest(page: Page, tokenId: string, requestId: string) {
  // Item 14, E4: o detalhe muda de forma (`support/inbox.ts`).
  await abrirMensagem(page, tokenId, requestId);
}

/** "Send" do cabeçalho da URL, com o token já vindo do servidor (a assinatura está nele): o compositor em Send. */
async function openSend(page: Page, tokenId: string): Promise<Locator> {
  await page.goto(`/#/${tokenId}`);
  await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
    new RegExp(`/${tokenId}$`),
  );
  await page.getByRole('link', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/${tokenId}/outbound\\?send=new$`));
  const dialog = page.getByRole('region', { name: 'Send request' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** O resultado do envio, que fica na página (não some ao fechar nada). */
function outboundDetail(page: Page): Locator {
  return page.getByRole('region', { name: 'Outbound detail' });
}

/** "Replay…" no detalhe: leva ao compositor de Outbound com a mensagem escolhida. */
async function openReplay(page: Page, tokenId: string, requestId: string): Promise<Locator> {
  await page.getByRole('button', { name: /^Replay/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/${tokenId}/outbound\\?replay=${requestId}$`));
  const dialog = page.getByRole('region', { name: 'Replay request' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function choose(page: Page, select: Locator, option: string) {
  await select.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('Dado uma mensagem recebida', () => {
  test('deve reenviar ao receptor com caminho e query, mostrar a resposta e lembrar o destino Quando "Replay…" é usado', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, {
      method: 'POST',
      path: '/pedidos?x=1',
      headers: { 'Content-Type': 'application/json', 'X-Origem': 'e2e' },
      data: '{"pedido":7}',
    });
    await openRequest(page, tokenId, requestId);

    const dialog = await openReplay(page, tokenId, requestId);
    await expect(dialog.getByText('Appends /pedidos?x=1 to the target')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Target URL' }).fill(`${receiver.url}/app`);
    await dialog.getByRole('button', { name: 'Replay', exact: true }).click();

    const detail = outboundDetail(page);
    await expect(detail.getByText('201', { exact: true })).toBeVisible();
    await expect(detail.getByRole('table', { name: 'Response headers' })).toContainText(
      'x-receptor',
    );
    await expect(detail.getByLabel('Response body', { exact: true })).toHaveText(
      /^\{\s*"recebido":\s*true\s*\}$/,
    );
    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0]).toEqual(
      expect.objectContaining({ method: 'POST', url: '/app/pedidos?x=1', body: '{"pedido":7}' }),
    );
    expect(receiver.received[0].headers['x-origem']).toBe('e2e');

    // O destino fica lembrado para esta URL: um novo Replay pelo detalhe já vem com ele.
    await openRequest(page, tokenId, requestId);
    const outra = await openReplay(page, tokenId, requestId);
    await expect(outra.getByRole('textbox', { name: 'Target URL' })).toHaveValue(
      `${receiver.url}/app`,
    );
  });

  test('deve mostrar o bloqueio com a orientação de WEBHOOK_OUTBOUND_ALLOW_PRIVATE Quando o destino é o endereço de metadados', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: 'x' });
    await openRequest(page, tokenId, requestId);

    const dialog = await openReplay(page, tokenId, requestId);
    await dialog
      .getByRole('textbox', { name: 'Target URL' })
      .fill('http://169.254.169.254/latest/meta-data');
    await dialog.getByRole('button', { name: 'Replay', exact: true }).click();

    const alert = outboundDetail(page).getByRole('alert');
    await expect(alert).toContainText('Blocked');
    await expect(alert).toContainText('WEBHOOK_OUTBOUND_ALLOW_PRIVATE=true');
  });

  test('deve abrir o Send já preenchido com método, headers e corpo Quando "Send as new…" é clicado', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain', 'X-Origem': 'e2e' },
      data: 'corpo original',
    });
    await openRequest(page, tokenId, requestId);

    await page.getByRole('button', { name: /^Send as new/ }).click();

    await expect(page).toHaveURL(new RegExp(`#/${tokenId}/outbound\\?send-from=${requestId}$`));
    const dialog = page.getByRole('region', { name: 'Send request' });
    await expect(dialog.getByRole('combobox', { name: 'Method' })).toHaveText('PUT');
    await expect(dialog.getByRole('textbox', { name: 'Body' })).toHaveValue('corpo original');
    const names = await dialog
      .getByRole('textbox', { name: /^Header \d+ name$/ })
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect(names).toContain('x-origem');
    expect(names).not.toContain('host');
    expect(names).not.toContain('content-length');
  });
});

test.describe('Dado o Send do cabeçalho da URL', () => {
  test('deve deixar "Sign with this URL\'s signature" desligado e explicar Quando a URL não tem assinatura', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();

    const dialog = await openSend(page, tokenId);

    await expect(
      dialog.getByRole('switch', { name: "Sign with this URL's signature" }),
    ).toBeDisabled();
    await expect(
      dialog.getByText('This URL has no signature configured. Set one up in Checks to sign.'),
    ).toBeVisible();
  });

  test('deve disparar sem assinatura, com os headers do editor, e mostrar a resposta', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const dialog = await openSend(page, tokenId);

    await choose(page, dialog.getByRole('combobox', { name: 'Method' }), 'PATCH');
    await dialog.getByRole('textbox', { name: 'URL', exact: true }).fill(`${receiver.url}/hook`);
    await dialog.getByRole('button', { name: 'Add header' }).click();
    await dialog.getByRole('textbox', { name: 'Header 1 name' }).fill('X-Trace');
    await dialog.getByRole('textbox', { name: 'Header 1 value' }).fill('abc');
    await dialog.getByRole('textbox', { name: 'Body' }).fill('olá');
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();

    await expect(outboundDetail(page).getByText('201', { exact: true })).toBeVisible();
    expect(receiver.received).toEqual([
      expect.objectContaining({ method: 'PATCH', url: '/hook', body: 'olá' }),
    ]);
    expect(receiver.received[0].headers['x-trace']).toBe('abc');
  });

  test('deve assinar com a configuração da URL, ser aceito pela verificação e não expor o segredo', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'github', secret: SECRET } });
    // O próprio Anzol verifica: o alvo é esta URL, vista do container.
    const port = new URL(test.info().project.use.baseURL ?? '').port || '80';
    const target = `http://${RECEIVER_HOST}:${port}/${tokenId}/assinado`;
    const dialog = await openSend(page, tokenId);

    await dialog.getByRole('textbox', { name: 'URL', exact: true }).fill(target);
    await dialog.getByRole('textbox', { name: 'Body' }).fill('{"assinado":true}');
    await dialog.getByRole('switch', { name: "Sign with this URL's signature" }).click();
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();

    const detail = outboundDetail(page);
    await expect(detail.getByText('200', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(SECRET);
    // Nome de header não diferencia maiúsculas: o servidor manda X-Hub-Signature-256.
    await expect(detail.getByRole('table', { name: 'Sent headers' })).toContainText(
      /x-hub-signature-256/i,
    );

    // A mensagem que chegou a esta mesma URL foi verificada como válida.
    await page
      .getByRole('navigation', { name: 'URL sections' })
      .getByRole('link', { name: 'Inbox', exact: true })
      .click();
    await expect(verificacoes(page)).toContainText(/Signature valid\s*GitHub/);
  });
});

test.describe('Dado a aba Outbound', () => {
  test('deve listar o disparo com status, alvo, método e tempo e abrir o detalhe com headers e corpo', async ({
    page,
    request,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const replayed = await tokens.send(tokenId, { path: '/x', data: 'um' });
    const response = await request.post(`/token/${tokenId}/request/${replayed}/replay`, {
      data: { url: `${receiver.url}/de-fora`, keep_path: true },
    });
    expect(response.status(), await response.text()).toBe(200);

    await page.goto(`/#/${tokenId}/outbound`);

    const rows = page.getByRole('table', { name: 'Outbound history' }).locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('201');
    await expect(rows.first()).toContainText('POST');
    await expect(rows.first()).toContainText('/de-fora/x');
    await expect(rows.first()).toContainText('Replay');
    await expect(rows.first()).toContainText(/\d+ ms/);
    const detail = page.getByRole('region', { name: 'Outbound detail' });
    await expect(detail.getByRole('table', { name: 'Sent headers' })).toBeVisible();
    await expect(detail.getByRole('table', { name: 'Response headers' })).toContainText(
      'x-receptor',
    );
    await expect(detail.getByLabel('Response body', { exact: true })).toHaveText(
      /^\{\s*"recebido":\s*true\s*\}$/,
    );
  });
});
