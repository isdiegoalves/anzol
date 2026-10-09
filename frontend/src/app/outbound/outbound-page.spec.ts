import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Clipboard } from '@angular/cdk/clipboard';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import { outboundResult } from '../../testing/outbound-fixtures';
import { outboundMatcher } from '../app.routes';
import { Preferences } from '../settings/preferences';
import { Redirector } from '../settings/redirect';
import { Viewport, WindowClass } from '../shell/viewport';
import { Token } from '../token/token';
import { OutboundResult } from './outbound';
import { OutboundPage } from './outbound-page';

const HISTORY = `/token/${TOKEN_ID}/outbound`;
const RECENT = `/token/${TOKEN_ID}/requests?page=1&sorting=newest`;
const PEDIDO = webhookRequest(1, {
  method: 'PUT',
  url: `http://localhost:8084/${TOKEN_ID}/pedidos?x=1`,
  headers: { 'content-type': ['text/plain'], 'x-origem': ['e2e'], host: ['localhost'] },
  content: 'corpo original',
});
/** Stripe assinou há uma hora: velho para a tolerância padrão (300 s). */
const VELHA = webhookRequest(2, {
  headers: {
    'stripe-signature': [`t=${Math.floor(Date.now() / 1000) - 3600},v1=abc`],
    'content-type': ['application/json'],
  },
  content: '{"id":"evt_1"}',
});

describe('Dado a página Outbound', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [{ matcher: outboundMatcher, component: OutboundPage }],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => localStorage.clear());

  /** Abre a rota e responde a URL, as recentes e o histórico. */
  const open = async (
    query = '',
    {
      url = token(),
      history = [outboundResult(2), outboundResult(1)] as OutboundResult[],
      recent = [PEDIDO, VELHA],
    }: { url?: Token; history?: OutboundResult[]; recent?: (typeof PEDIDO)[] } = {},
  ) => {
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl(`/${TOKEN_ID}/outbound${query}`);
    (await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}`))).flush(url);
    http.expectOne(RECENT).flush(requestPage(recent));
    http.expectOne(HISTORY).flush(history);
    await vi.waitFor(() =>
      expect(screen.getByRole('table', { name: 'Outbound history' })).toBeTruthy(),
    );
    await harness.fixture.whenStable();
    return harness;
  };

  it('deve listar o histórico, abrir o mais novo no detalhe e passar no axe', async () => {
    const harness = await open();

    expect(screen.getByRole('main', { name: 'Outbound' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const items = [
      ...screen.getByRole('table', { name: 'Outbound history' }).querySelectorAll('tbody tr'),
    ] as HTMLElement[];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('/app/pedidos?n=2');
    expect(items[0].getAttribute('aria-selected')).toBe('true');
    const detail = screen.getByRole('region', { name: 'Outbound detail' });
    expect(within(detail).getByLabelText('Response body').textContent).toBe('{"ok":true}');
    await userEvent.click(within(detail).getByRole('tab', { name: /^Response headers/ }));
    expect(within(detail).getByRole('table', { name: 'Response headers' }).textContent).toContain(
      'x-app',
    );
    await userEvent.click(within(detail).getByRole('tab', { name: /^Sent headers/ }));
    expect(within(detail).getByRole('table', { name: 'Sent headers' })).toBeTruthy();

    await userEvent.click(items[1]);
    expect(within(detail).getByText(/pedidos\?n=1/)).toBeTruthy();
    await expectNoAxeViolations(harness.routeNativeElement as HTMLElement);
  });

  it('deve mostrar no detalhe o que o replay injetou e o que o app respondeu', async () => {
    const harness = await open('', {
      history: [
        outboundResult(1, {
          chaos: {
            delay_ms: 200,
            duplicate: true,
            abort_mid_body: false,
            slow_body_bps: null,
            timeout_ms: null,
            injected: ['delay_ms', 'duplicate'],
            body_bytes_sent: null,
            duplicate_result: { status: 409, duration_ms: 3, error: null },
          },
        }),
      ],
    });

    const detail = screen.getByRole('region', { name: 'Outbound detail' });
    expect(
      within(detail).getByText('Injected: delay 200 ms, sent twice (second: 409 Conflict)'),
    ).toBeTruthy();
    expect(detail.querySelector('.big-status')?.textContent?.trim()).toBe('201');
    await expectNoAxeViolations(harness.routeNativeElement as HTMLElement);
  });

  it('deve dizer "No answer read" no lugar do status Quando o corte injetado não deixou ler a resposta', async () => {
    await open('', {
      history: [
        outboundResult(1, {
          status: undefined,
          headers: undefined,
          body: undefined,
          chaos: {
            delay_ms: 0,
            duplicate: false,
            abort_mid_body: true,
            slow_body_bps: null,
            timeout_ms: null,
            injected: ['abort_mid_body'],
            body_bytes_sent: 12,
            duplicate_result: null,
          },
        }),
      ],
    });

    const detail = screen.getByRole('region', { name: 'Outbound detail' });
    expect(detail.querySelector('.big-status')?.textContent?.trim()).toBe('No answer read');
    expect(within(detail).getByText('Injected: body cut after 12 bytes')).toBeTruthy();
    const linha = screen.getByRole('table', { name: 'Outbound history' }).querySelector('tbody tr');
    expect(linha?.textContent).toContain('No answer read');
  });

  it('deve reenviar a mensagem da rota e mostrar o resultado no detalhe Quando Replay é clicado', async () => {
    await open(`?replay=${PEDIDO.uuid}`);

    const composer = await screen.findByRole('region', { name: 'Replay request' });
    expect(
      within(composer).getByRole('button', {
        name: `Request to replay: #${PEDIDO.uuid.slice(0, 5)}, PUT /pedidos?x=1. Change`,
      }),
    ).toBeTruthy();
    expect(within(composer).getByText('/pedidos?x=1')).toBeTruthy();
    await userEvent.type(
      within(composer).getByRole('textbox', { name: 'Target URL' }),
      'http://localhost:3000/app',
    );
    await userEvent.click(within(composer).getByRole('button', { name: 'Replay' }));

    const call = http.expectOne(`/token/${TOKEN_ID}/request/${PEDIDO.uuid}/replay`);
    expect(call.request.body).toEqual({
      url: 'http://localhost:3000/app',
      keep_path: true,
      timeout: 10_000,
    });
    call.flush(outboundResult(3, { target: 'http://host.docker.internal:3000/app/pedidos?x=1' }));
    await vi.waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Outbound detail' })).getByText(
          'http://host.docker.internal:3000/app/pedidos?x=1',
        ),
      ).toBeTruthy(),
    );
    // O botão fica desabilitado no envio: o foco vai ao resultado, e não ao body.
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        within(screen.getByRole('region', { name: 'Outbound detail' })).getByRole('heading', {
          name: 'Result',
        }),
      ),
    );
  });

  it('deve avisar da assinatura velha e abrir o Send assinado Quando "Send as new with a fresh signature" é clicado', async () => {
    await open(`?replay=${VELHA.uuid}`, {
      url: token({ signature: { provider: 'stripe', secret: '••••1234', toleranceSeconds: 300 } }),
    });

    const composer = await screen.findByRole('region', { name: 'Replay request' });
    expect(within(composer).getByRole('status').textContent).toMatch(
      /The Stripe signature in this request is older than the tolerance \(300 s\): the receiver will likely reject the replay\. It was signed 60 min ago \(t=\d+\)\./,
    );
    await userEvent.click(
      within(composer).getByRole('button', { name: 'Send as new with a fresh signature' }),
    );

    const send = await screen.findByRole('region', { name: 'Send request' });
    expect(
      within(send)
        .getByRole('switch', { name: "Sign with this URL's signature" })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect((within(send).getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement).value).toBe(
      '{"id":"evt_1"}',
    );
    const names = within(send)
      .getAllByRole('textbox', { name: /^Header \d+ name$/ })
      .map((input) => (input as HTMLInputElement).value);
    expect(names).toEqual(['content-type']);
  });

  it('não deve avisar Quando a mensagem não traz assinatura com horário', async () => {
    await open(`?replay=${PEDIDO.uuid}`);

    const composer = await screen.findByRole('region', { name: 'Replay request' });
    expect(within(composer).queryByRole('status')).toBeNull();
  });

  it('deve abrir o Send preenchido com a mensagem, sem headers de conexão, Quando a rota traz ?send-from=', async () => {
    await open(`?send-from=${PEDIDO.uuid}`);

    const send = await screen.findByRole('region', { name: 'Send request' });
    expect((within(send).getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement).value).toBe(
      'corpo original',
    );
    const names = within(send)
      .getAllByRole('textbox', { name: /^Header \d+ name$/ })
      .map((input) => (input as HTMLInputElement).value);
    expect(names).toEqual(['content-type', 'x-origem']);
  });

  it('deve apontar o Send para a própria URL e caminho da mensagem Quando ?to=self (WM-28)', async () => {
    await open(`?send-from=${PEDIDO.uuid}&to=self`);

    const send = await screen.findByRole('region', { name: 'Send request' });
    expect((within(send).getByRole('textbox', { name: 'URL' }) as HTMLInputElement).value).toBe(
      PEDIDO.url,
    );
  });

  it('deve disparar pelo servidor com a assinatura Quando ?send=signed e a URL assina', async () => {
    await open('?send=signed', {
      url: token({ signature: { provider: 'github', secret: '••••1234' } }),
    });

    const send = await screen.findByRole('region', { name: 'Send request' });
    await userEvent.type(
      within(send).getByRole('textbox', { name: 'URL' }),
      'http://localhost:3000/x',
    );
    await userEvent.click(within(send).getByRole('button', { name: 'Send' }));

    const call = http.expectOne(`/token/${TOKEN_ID}/send`);
    expect(call.request.body).toMatchObject({
      url: 'http://localhost:3000/x',
      method: 'POST',
      sign: true,
    });
    call.flush(outboundResult(4, { kind: 'send' }));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        within(screen.getByRole('region', { name: 'Outbound detail' })).getByRole('heading', {
          name: 'Result',
        }),
      ),
    );
  });

  it('deve deixar a assinatura desligada e apontar Checks Quando a URL não assina', async () => {
    await open('?send=new');

    const send = await screen.findByRole('region', { name: 'Send request' });
    expect(
      (
        within(send).getByRole('switch', {
          name: "Sign with this URL's signature",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(within(send).getByRole('link', { name: 'Checks' }).getAttribute('href')).toContain(
      'checks?section=signature',
    );
  });

  it('deve reenviar pelo navegador a mensagem escolhida Quando "Redirect Now" é clicado', async () => {
    TestBed.inject(Preferences).redirectUrl.set('http://redirect.test');
    const redirect = vi.spyOn(TestBed.inject(Redirector), 'redirect').mockResolvedValue();
    await open(`?replay=${PEDIDO.uuid}`);
    await screen.findByRole('region', { name: 'Replay request' });

    await userEvent.click(
      screen.getByRole('button', { name: 'Forward from this browser (legacy)' }),
    );
    const forward = screen.getByRole('region', { name: 'Forward from this browser (legacy)' });
    expect(
      (within(forward).getByRole('switch', { name: 'Auto redirect' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await userEvent.click(within(forward).getByRole('button', { name: 'Redirect Now' }));

    expect(redirect).toHaveBeenCalledWith(PEDIDO);
  });

  it.each(['replay', 'send-from'])(
    'deve ignorar ?%s= que não é um UUID, sem chamar o servidor (path traversal)',
    async (param) => {
      await open(`?${param}=..%2F..%2F..%2Fshare%2Fabc`);
      await new Promise((resolve) => setTimeout(resolve));

      http.expectNone((sent) => sent.url.includes('share'));
      http.expectNone((sent) => sent.url.includes('/request/'));
    },
  );

  it('deve dizer que a URL não existe mais Quando o histórico responde 410', async () => {
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl(`/${TOKEN_ID}/outbound`);
    (await vi.waitFor(() => http.expectOne(`/token/${TOKEN_ID}`))).flush(token());
    http.expectOne(RECENT).flush(requestPage([]));
    http.expectOne(HISTORY).flush(null, { status: 410, statusText: 'Gone' });

    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent?.trim()).toBe(
        'This URL no longer exists (410).',
      ),
    );
  });

  describe('Dado a fidelidade ao protótipo C (F2)', () => {
    const detail = () => screen.getByRole('region', { name: 'Outbound detail' });

    it('OUTBOUND-01: deve pôr histórico e trabalho num split redimensionável a partir de 840 px', async () => {
      TestBed.overrideProvider(Viewport, {
        useValue: { windowClass: signal<WindowClass>('large') },
      });
      await open();

      const separator = screen.getByRole('separator', { name: 'Resize history and request' });
      expect(separator.getAttribute('aria-valuenow')).toBe('420');
      const start = separator.previousElementSibling;
      expect(start?.querySelector('table[aria-label="Outbound history"]')).toBeTruthy();
      const end = separator.nextElementSibling;
      expect(end?.querySelector('[aria-labelledby="outbound-new-title"]')).toBeTruthy();
      expect(end?.querySelector('[aria-label="Outbound detail"]')).toBeTruthy();
    });

    it('OUTBOUND-03: deve mostrar o alvo numa linha (com o inteiro no title) e o ícone do tipo', async () => {
      await open();

      const row = screen
        .getByRole('table', { name: 'Outbound history' })
        .querySelector('tbody tr') as HTMLElement;
      const target = row.querySelector('.target') as HTMLElement;
      expect(target.getAttribute('title')).toBe('http://host.docker.internal:3000/app/pedidos?n=2');
      expect(row.querySelector('.kind app-icon')).toBeTruthy();
    });

    it('OUTBOUND-05: deve dizer para onde o Replay vai, com e sem "Keep path and query"', async () => {
      await open(`?replay=${PEDIDO.uuid}`);
      const composer = await screen.findByRole('region', { name: 'Replay request' });
      await userEvent.type(
        within(composer).getByRole('textbox', { name: 'Target URL' }),
        'http://localhost:3000/app',
      );

      const sendsTo = () => composer.querySelector('.sends-to code')?.textContent;
      expect(composer.querySelector('.sends-to')?.textContent).toMatch(/^Sends to http/);
      expect(sendsTo()).toBe('http://localhost:3000/app/pedidos?x=1');
      await userEvent.click(within(composer).getByRole('switch', { name: 'Keep path and query' }));
      expect(sendsTo()).toBe('http://localhost:3000/app');
    });

    it('OUTBOUND-07: deve dizer qual header a assinatura acrescenta', async () => {
      await open('?send=signed', {
        url: token({
          signature: { provider: 'stripe', secret: '••••1234', toleranceSeconds: 300 },
        }),
      });

      const send = await screen.findByRole('region', { name: 'Send request' });
      expect(send.textContent).toContain(
        "Adds Stripe-Signature: t=…,v1=… with this URL's HMAC secret; it never leaves the server.",
      );
    });

    it('OUTBOUND-09: deve mostrar o status grande, o #id da origem e as abas com contadores', async () => {
      await open();

      expect(detail().querySelector('.big-status')?.textContent?.trim()).toBe('201');
      expect(detail().textContent).toContain('#00000');
      const tabs = within(detail()).getAllByRole('tab');
      expect(tabs.map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
        'Response body',
        'Response headers (2)',
        'Sent headers (1)',
      ]);
      expect(tabs[0].getAttribute('aria-selected')).toBe('true');
      expect(within(detail()).getByLabelText('Response body').textContent).toBe('{"ok":true}');

      await userEvent.click(tabs[1]);
      expect(
        within(detail()).getByRole('table', { name: 'Response headers' }).textContent,
      ).toContain('x-app');
      await userEvent.keyboard('{ArrowRight}');
      expect(within(detail()).getByRole('table', { name: 'Sent headers' })).toBeTruthy();
    });

    it('OUTBOUND-08: deve repetir o replay pelo servidor Quando "Run again" é clicado', async () => {
      await open();

      await userEvent.click(within(detail()).getByRole('button', { name: 'Run again' }));

      const call = http.expectOne(
        `/token/${TOKEN_ID}/request/00000000-0000-4000-8000-000000000001/replay`,
      );
      expect(call.request.body).toEqual({
        url: 'http://host.docker.internal:3000/app/pedidos?n=2',
        keep_path: false,
        timeout: 10_000,
      });
      call.flush(outboundResult(5));
      await vi.waitFor(() => expect(detail().textContent).toContain('/app/pedidos?n=5'));
    });

    it('OUTBOUND-08: deve repetir com o mesmo caos Quando o replay do histórico foi feito com caos', async () => {
      await open('', {
        history: [
          outboundResult(1, {
            chaos: {
              delay_ms: 200,
              duplicate: true,
              abort_mid_body: false,
              slow_body_bps: 512,
              timeout_ms: null,
              injected: ['delay_ms', 'slow_body_bps', 'duplicate'],
              body_bytes_sent: null,
              duplicate_result: { status: 201, duration_ms: 3, error: null },
            },
          }),
        ],
      });

      await userEvent.click(within(detail()).getByRole('button', { name: 'Run again' }));

      const call = http.expectOne(
        `/token/${TOKEN_ID}/request/00000000-0000-4000-8000-000000000001/replay`,
      );
      expect(call.request.body).toEqual({
        url: 'http://host.docker.internal:3000/app/pedidos?n=1',
        keep_path: false,
        timeout: 10_000,
        chaos: { delay_ms: 200, duplicate: true, slow_body_bps: 512 },
      });
      call.flush(outboundResult(5));
    });

    it('OUTBOUND-08: deve repetir a desistência do caos com um timeout acima dela Quando ela passa do timeout padrão', async () => {
      await open('', {
        history: [
          outboundResult(1, {
            status: undefined,
            chaos: {
              delay_ms: 0,
              duplicate: false,
              abort_mid_body: true,
              slow_body_bps: null,
              timeout_ms: 15_000,
              injected: ['abort_mid_body'],
              body_bytes_sent: 7,
              duplicate_result: null,
            },
          }),
        ],
      });

      await userEvent.click(within(detail()).getByRole('button', { name: 'Run again' }));

      const call = http.expectOne(
        `/token/${TOKEN_ID}/request/00000000-0000-4000-8000-000000000001/replay`,
      );
      expect(call.request.body).toMatchObject({
        timeout: 15_001,
        chaos: { abort_mid_body: true, timeout_ms: 15_000 },
      });
      expect(call.request.body.chaos).not.toHaveProperty('delay_ms');
      call.flush(outboundResult(5));
    });

    it('OUTBOUND-08: deve repetir o send com o mesmo corpo Quando o send foi feito nesta página', async () => {
      await open('?send=new');
      const send = await screen.findByRole('region', { name: 'Send request' });
      await userEvent.type(
        within(send).getByRole('textbox', { name: 'URL' }),
        'http://localhost:3000/x',
      );
      await userEvent.type(within(send).getByRole('textbox', { name: 'Body' }), 'um corpo');
      await userEvent.click(within(send).getByRole('button', { name: 'Send' }));
      const first = http.expectOne(`/token/${TOKEN_ID}/send`);
      first.flush(outboundResult(6, { kind: 'send', source_request: null }));

      await userEvent.click(await within(detail()).findByRole('button', { name: 'Run again' }));

      const again = http.expectOne(`/token/${TOKEN_ID}/send`);
      expect(again.request.body).toEqual(first.request.body);
      again.flush(outboundResult(7, { kind: 'send', source_request: null }));
    });

    it('OUTBOUND-08: deve copiar o resultado como curl, com o corpo da mensagem reenviada', async () => {
      const copy = vi.fn().mockReturnValue(true);
      TestBed.overrideProvider(Clipboard, { useValue: { copy } });
      await open('', { history: [outboundResult(1, { source_request: PEDIDO.uuid })] });

      await userEvent.click(within(detail()).getByRole('button', { name: 'Copy as curl' }));

      await vi.waitFor(() => expect(copy).toHaveBeenCalled());
      const curl = copy.mock.calls[0][0] as string;
      expect(curl).toMatch(
        /^curl -X POST 'http:\/\/host\.docker\.internal:3000\/app\/pedidos\?n=1'/,
      );
      expect(curl).toContain("-H 'content-type: application/json'");
      expect(curl).toContain("--data-raw 'corpo original'");
    });

    it('OUTBOUND-05: deve trocar a mensagem pelo botão "Change" (lista das recentes)', async () => {
      await open(`?replay=${PEDIDO.uuid}`);
      const composer = await screen.findByRole('region', { name: 'Replay request' });

      await userEvent.click(within(composer).getByRole('button', { name: /^Request to replay: / }));
      const items = await screen.findAllByRole('menuitem');
      expect(items).toHaveLength(2);
      await userEvent.click(items[1]);

      // As duas mensagens do teste começam com o mesmo #id: o método diz qual ficou.
      expect(
        within(composer)
          .getByRole('button', { name: /^Request to replay: / })
          .getAttribute('aria-label'),
      ).toBe(`Request to replay: #${VELHA.uuid.slice(0, 5)}, POST /. Change`);
    });

    describe('Dado as decisões do dono (F2 fase 2)', () => {
      it('OUTBOUND-02 e 12: deve pôr o título e o Refresh em ícone no cartão do histórico, com a frase curta', async () => {
        await open();

        const title = screen.getByRole('heading', { level: 1, name: 'Outbound' });
        expect(title.classList.contains('page-title')).toBe(true);
        const card = title.closest('.history') as HTMLElement;
        expect(card.querySelector('table[aria-label="Outbound history"]')).toBeTruthy();
        const refresh = within(card).getByRole('button', { name: 'Refresh history' });
        expect(refresh.textContent?.trim()).toBe('');
        expect(card.textContent).toContain(
          'Replays of received requests and new sends, newest first. 30 sends per minute per URL.',
        );
        expect(screen.queryByRole('heading', { name: /last 50/ })).toBeNull();

        await userEvent.click(refresh);
        http.expectOne(RECENT).flush(requestPage([PEDIDO]));
        http.expectOne(HISTORY).flush([]);
      });

      it('OUTBOUND-04: deve ter o h2 "New request" com o segmentado e manter as regiões', async () => {
        await open(`?replay=${PEDIDO.uuid}`);

        const composer = screen.getByRole('region', { name: 'New request' });
        expect(
          within(composer).getByRole('heading', { level: 2, name: 'New request' }),
        ).toBeTruthy();
        expect(composer.textContent).toContain('The server sends it and records the answer below.');
        expect(await screen.findByRole('region', { name: 'Replay request' })).toBeTruthy();
      });

      it('OUTBOUND-06: deve mostrar o t= lido no aviso de assinatura velha', async () => {
        await open(`?replay=${VELHA.uuid}`, {
          url: token({
            signature: { provider: 'stripe', secret: '••••1234', toleranceSeconds: 300 },
          }),
        });

        const composer = await screen.findByRole('region', { name: 'Replay request' });
        expect(within(composer).getByRole('status').textContent).toMatch(/\(t=\d+\)/);
      });

      it('OUTBOUND-10: deve pôr o ícone de aviso no erro de saída e dizer que os headers enviados estão embaixo', async () => {
        await open('', {
          history: [
            outboundResult(9, {
              status: null,
              headers: null,
              body: null,
              error: { kind: 'blocked', message: 'blocked: link-local address (always blocked)' },
            }),
          ],
        });

        const alert = within(detail()).getByRole('alert');
        expect(alert.querySelector('app-icon')).toBeTruthy();
        expect(alert.textContent).toContain('Blocked: link-local address (always blocked)');
        expect(alert.textContent).toContain(
          'Nothing reached the target, so there is no response. The sent headers are below.',
        );
      });

      it('OUTBOUND-11: deve sugerir o anzol listen no Forward legado', async () => {
        await open();

        await userEvent.click(
          screen.getByRole('button', { name: 'Forward from this browser (legacy)' }),
        );

        expect(
          screen.getByRole('region', { name: 'Forward from this browser (legacy)' }).textContent,
        ).toContain('anzol listen');
      });
    });
  });
});
