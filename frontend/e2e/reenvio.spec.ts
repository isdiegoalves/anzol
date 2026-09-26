import { IncomingHttpHeaders, Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';

// Reenvio pelo servidor e envio pela tela (CA-5): Replay na mensagem, Send na barra da URL (com e
// sem assinatura), "Send as new…" e a aba Outbound. Precisa do backend com
// `POST /token/{id}/request/{rid}/replay`, `POST /token/{id}/send` e `GET /token/{id}/outbound`,
// e de `WEBHOOK_OUTBOUND_ALLOW_PRIVATE=true` no stack: o receptor roda neste processo (no host) e
// o app, no container, o alcança por `host.docker.internal` (troque com E2E_RECEIVER_HOST).

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
  await page.goto(`/#/${tokenId}/${requestId}/1`);
  await expect(page.locator('.req-id')).toHaveText(requestId);
}

/** Barra da URL com o token já vindo do servidor (a assinatura está nele). */
async function openSend(page: Page, tokenId: string): Promise<Locator> {
  await page.goto(`/#/${tokenId}`);
  await expect(page.getByRole('textbox', { name: 'Webhook URL' })).toHaveValue(
    new RegExp(`/${tokenId}$`),
  );
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send request' });
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

    await page.getByRole('button', { name: /^Replay/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Replay request' });
    await expect(dialog.getByText('Appends /pedidos?x=1 to the target')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Target URL' }).fill(`${receiver.url}/app`);
    await dialog.getByRole('button', { name: 'Replay', exact: true }).click();

    await expect(dialog.locator('.status')).toHaveText('201');
    await expect(dialog.getByRole('table', { name: 'Response headers' })).toContainText(
      'x-receptor',
    );
    await expect(dialog.locator('pre.body')).toHaveText('{"recebido":true}');
    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0]).toEqual(
      expect.objectContaining({ method: 'POST', url: '/app/pedidos?x=1', body: '{"pedido":7}' }),
    );
    expect(receiver.received[0].headers['x-origem']).toBe('e2e');

    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: /^Replay/ }).click();
    await expect(
      page.getByRole('dialog', { name: 'Replay request' }).getByRole('textbox', {
        name: 'Target URL',
      }),
    ).toHaveValue(`${receiver.url}/app`);
  });

  test('deve mostrar o bloqueio com a orientação de WEBHOOK_OUTBOUND_ALLOW_PRIVATE Quando o destino é o endereço de metadados', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, { data: 'x' });
    await openRequest(page, tokenId, requestId);

    await page.getByRole('button', { name: /^Replay/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Replay request' });
    await dialog
      .getByRole('textbox', { name: 'Target URL' })
      .fill('http://169.254.169.254/latest/meta-data');
    await dialog.getByRole('button', { name: 'Replay', exact: true }).click();

    const alert = dialog.locator('.error[role=alert]');
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

    const dialog = page.getByRole('dialog', { name: 'Send request' });
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

test.describe('Dado o Send da barra da URL', () => {
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
      dialog.getByText('This URL has no signature configured. Set one up in Edit URL to sign.'),
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

    await expect(dialog.locator('.status')).toHaveText('201');
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
    // O próprio webhook.site verifica: o alvo é esta URL, vista do container.
    const port = new URL(test.info().project.use.baseURL ?? '').port || '80';
    const target = `http://${RECEIVER_HOST}:${port}/${tokenId}/assinado`;
    const dialog = await openSend(page, tokenId);

    await dialog.getByRole('textbox', { name: 'URL', exact: true }).fill(target);
    await dialog.getByRole('textbox', { name: 'Body' }).fill('{"assinado":true}');
    await dialog.getByRole('switch', { name: "Sign with this URL's signature" }).click();
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();

    await expect(dialog.locator('.status')).toHaveText('200');
    await expect(dialog).not.toContainText(SECRET);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Signature valid — GitHub')).toBeVisible();

    await page.getByRole('link', { name: 'Outbound' }).click();
    const detail = page.getByRole('region', { name: 'Outbound detail' });
    // Nome de header não diferencia maiúsculas: o servidor manda X-Hub-Signature-256.
    await expect(detail.getByRole('table', { name: 'Sent headers' })).toContainText(
      /x-hub-signature-256/i,
    );
    await expect(page.locator('app-outbound-page')).not.toContainText(SECRET);
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
    await expect(detail.locator('pre.body')).toHaveText('{"recebido":true}');
  });
});
