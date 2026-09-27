import { createHmac } from 'node:crypto';
import { Locator, Page } from '@playwright/test';
import { expectSemViolacoesGraves } from './support/a11y';
import { Webhook, expect, test } from './support/fixtures';

// Item 14, E7: o que a página Outbound acrescenta e reenvio.spec.ts não cobre — o link direto para o compositor
// (`?replay=` e `?send-from=`), o aviso de assinatura velha no Replay (de A) com "Send as new with a fresh
// signature" e o axe (CA-2). SUPOSIÇÕES (contrato da E7, além das de reenvio.spec.ts):
// - o Replay de uma mensagem com `t=` do Stripe (ou `x-slack-request-timestamp`) mais velho que a tolerância da URL
//   diz, na `region "Replay request"`, "The {Stripe|Slack} signature in this request is older than the tolerance
//   ({n} s): the receiver will likely reject the replay." e mostra o `button "Send as new with a fresh
//   signature"`; com o timestamp dentro da tolerância, nada disso aparece;
// - "Send as new with a fresh signature" abre o compositor em Send (`region "Send request"`) com a mensagem
//   (mesmo corpo), "Sign with this URL's signature" ligado e sem o header de assinatura velho na lista.

const SECRET = 'segredo-do-outbound';
const BODY = '{"type":"payment_intent.succeeded"}';
const AGORA = () => Math.floor(Date.now() / 1000);

function stripe(t: number, body = BODY): Webhook {
  const v1 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  return {
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
    data: body,
  };
}

function slack(ts: number, body = 'token=x&text=oi'): Webhook {
  const v0 = createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex');
  return {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Slack-Request-Timestamp': String(ts),
      'X-Slack-Signature': `v0=${v0}`,
    },
    data: body,
  };
}

const AVISO = /signature in this request is older than the tolerance/;

async function openReplay(page: Page, tokenId: string, requestId: string): Promise<Locator> {
  await page.goto(`/#/${tokenId}/outbound?replay=${requestId}`);
  const replay = page.getByRole('region', { name: 'Replay request' });
  await expect(replay).toBeVisible();
  return replay;
}

test.describe('Dado o link direto para o compositor', () => {
  test('deve abrir o Replay da mensagem com ?replay= e o Send preenchido com ?send-from=', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create();
    const requestId = await tokens.send(tokenId, {
      method: 'PATCH',
      path: '/pedidos?x=1',
      headers: { 'Content-Type': 'text/plain', 'X-Origem': 'e2e' },
      data: 'corpo do link',
    });

    const replay = await openReplay(page, tokenId, requestId);
    // Fidelidade ao C (OUTBOUND-05): "Sends to" com a URL efetiva (antes, "Appends /pedidos?x=1 to the target").
    await replay.getByRole('textbox', { name: 'Target URL' }).fill('http://destino.example/app');
    await expect(replay.getByText('Sends to http://destino.example/app/pedidos?x=1')).toBeVisible();

    await page.goto(`/#/${tokenId}/outbound?send-from=${requestId}`);
    const send = page.getByRole('region', { name: 'Send request' });
    await expect(send.getByRole('combobox', { name: 'Method' })).toHaveText('PATCH');
    await expect(send.getByRole('textbox', { name: 'Body' })).toHaveValue('corpo do link');
  });
});

test.describe('Dado o Replay de uma mensagem assinada com timestamp', () => {
  test('deve avisar que a assinatura do Stripe está velha e mandar como nova com assinatura fresca', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'stripe', secret: SECRET } });
    const velha = await tokens.send(tokenId, stripe(AGORA() - 3600));

    const replay = await openReplay(page, tokenId, velha);

    await expect(replay.getByText(AVISO)).toBeVisible();
    await expect(replay.getByText(AVISO)).toContainText('Stripe');
    await replay.getByRole('button', { name: 'Send as new with a fresh signature' }).click();

    const send = page.getByRole('region', { name: 'Send request' });
    await expect(send).toBeVisible();
    await expect(
      send.getByRole('switch', { name: "Sign with this URL's signature" }),
    ).toBeChecked();
    await expect(send.getByRole('textbox', { name: 'Body' })).toHaveValue(BODY);
    const nomes = await send
      .getByRole('textbox', { name: /^Header \d+ name$/ })
      .evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).value.toLowerCase()),
      );
    expect(nomes).not.toContain('stripe-signature');
  });

  test('não deve avisar Quando o t= do Stripe está dentro da tolerância', async ({
    page,
    tokens,
  }) => {
    const tokenId = await tokens.create({ signature: { provider: 'stripe', secret: SECRET } });
    const fresca = await tokens.send(tokenId, stripe(AGORA()));

    const replay = await openReplay(page, tokenId, fresca);

    await expect(replay.getByRole('textbox', { name: 'Target URL' })).toBeVisible();
    await expect(replay.getByText(AVISO)).toHaveCount(0);
    await expect(
      replay.getByRole('button', { name: 'Send as new with a fresh signature' }),
    ).toHaveCount(0);
  });

  test('deve avisar Quando o x-slack-request-timestamp está velho', async ({ page, tokens }) => {
    const tokenId = await tokens.create({ signature: { provider: 'slack', secret: SECRET } });
    const velha = await tokens.send(tokenId, slack(AGORA() - 3600));

    const replay = await openReplay(page, tokenId, velha);

    await expect(replay.getByText(AVISO)).toContainText('Slack');
    await expect(
      replay.getByRole('button', { name: 'Send as new with a fresh signature' }),
    ).toBeVisible();
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`Dado Outbound no tema ${colorScheme} a ${viewport.width}×${viewport.height} (axe, CA-2)`, () => {
      test.use({ colorScheme, viewport });

      test('deve passar no axe sem violação grave com o compositor e o erro de saída', async ({
        page,
        tokens,
      }) => {
        const tokenId = await tokens.create();
        const requestId = await tokens.send(tokenId, { data: 'x' });
        const replay = await openReplay(page, tokenId, requestId);
        await expectSemViolacoesGraves(page, `Outbound, ${colorScheme}, ${viewport.width} px`);

        await replay
          .getByRole('textbox', { name: 'Target URL' })
          .fill('http://169.254.169.254/latest/meta-data');
        await replay.getByRole('button', { name: 'Replay', exact: true }).click();
        await expect(
          page.getByRole('region', { name: 'Outbound detail' }).getByRole('alert'),
        ).toContainText('Blocked');
        await expectSemViolacoesGraves(
          page,
          `Outbound com erro, ${colorScheme}, ${viewport.width} px`,
        );
      });
    });
  }
}
