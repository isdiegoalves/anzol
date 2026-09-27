import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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
    http = TestBed.inject(HttpTestingController);
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

    const items = [
      ...screen.getByRole('table', { name: 'Outbound history' }).querySelectorAll('tbody tr'),
    ] as HTMLElement[];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('/app/pedidos?n=2');
    expect(items[0].getAttribute('aria-selected')).toBe('true');
    const detail = screen.getByRole('region', { name: 'Outbound detail' });
    expect(within(detail).getByRole('table', { name: 'Response headers' }).textContent).toContain(
      'x-app',
    );
    expect(within(detail).getByRole('table', { name: 'Sent headers' })).toBeTruthy();
    expect(within(detail).getByLabelText('Response body').textContent).toBe('{"ok":true}');

    await userEvent.click(items[1]);
    expect(within(detail).getByText(/pedidos\?n=1/)).toBeTruthy();
    await expectNoAxeViolations(harness.routeNativeElement as HTMLElement);
  });

  it('deve reenviar a mensagem da rota e mostrar o resultado no detalhe Quando Replay é clicado', async () => {
    await open(`?replay=${PEDIDO.uuid}`);

    const composer = await screen.findByRole('region', { name: 'Replay request' });
    expect(
      (within(composer).getByRole('combobox', { name: 'Request to replay' }) as HTMLSelectElement)
        .value,
    ).toBe(PEDIDO.uuid);
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
  });

  it('deve avisar da assinatura velha e abrir o Send assinado Quando "Send as new with a fresh signature" é clicado', async () => {
    await open(`?replay=${VELHA.uuid}`, {
      url: token({ signature: { provider: 'stripe', secret: '••••1234', toleranceSeconds: 300 } }),
    });

    const composer = await screen.findByRole('region', { name: 'Replay request' });
    expect(within(composer).getByRole('status').textContent).toMatch(
      /The Stripe signature in this request is older than the tolerance \(300 s\): the receiver will likely reject the replay\. It was signed 60 min ago\./,
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

  it('deve dizer que a URL não existe mais Quando o histórico responde 410', async () => {
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
});
