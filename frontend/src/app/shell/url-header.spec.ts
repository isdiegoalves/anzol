import { Clipboard } from '@angular/cdk/clipboard';
import { provideRouter } from '@angular/router';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { Subscription } from 'rxjs';
import { expectNoAxeViolations } from '../../testing/axe';
import { FakeEventSource } from '../../testing/fake-event-source';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { OutboundActions } from '../outbound/outbound-actions';
import { RequestStream } from '../realtime/request-stream';
import { Preferences } from '../settings/preferences';
import { Token } from '../token/token';
import { TokenActions } from '../token/token-actions';
import { UrlHeader } from './url-header';

describe('Dado o cabeçalho da URL aberta', () => {
  let actions: { lockUrl: ReturnType<typeof vi.fn> };
  let send: ReturnType<typeof vi.fn>;

  const renderWith = (url: Token | null) => {
    actions = { lockUrl: vi.fn().mockResolvedValue(undefined) };
    send = vi.fn();
    return render(UrlHeader, {
      providers: [
        provideRouter([]),
        { provide: TokenActions, useValue: actions },
        { provide: OutboundActions, useValue: { send } },
      ],
      configureTestBed: (testBed) => testBed.inject(Preferences).token.set(url),
    });
  };

  afterEach(() => localStorage.clear());

  it('deve mostrar a URL que recebe webhooks, copiar com "Copy" e passar no axe', async () => {
    const { container, fixture } = await renderWith(token());
    const copy = vi
      .spyOn(fixture.debugElement.injector.get(Clipboard), 'copy')
      .mockReturnValue(true);

    const url = screen.getByRole('textbox', { name: 'Webhook URL' }) as HTMLInputElement;
    expect(url.value).toBe(`${location.protocol}//${location.host}/${TOKEN_ID}`);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(copy).toHaveBeenCalledWith(url.value);
    await expectNoAxeViolations(container);
  });

  it('deve abrir o Send de hoje Quando o botão é clicado', async () => {
    await renderWith(token());

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await vi.waitFor(() => expect(send).toHaveBeenCalledWith());
  });

  it('deve levar a Checks pelo "Edit" (o antigo Edit URL)', async () => {
    await renderWith(token());

    expect(screen.getByRole('link', { name: 'Edit' })).toHaveProperty(
      'href',
      expect.stringMatching(new RegExp(`/${TOKEN_ID}/checks$`)),
    );
  });

  it('deve mostrar "Lock" e trancar a URL Quando ela é protegida', async () => {
    await renderWith(token({ protected: true }));

    await userEvent.click(screen.getByRole('button', { name: 'Lock' }));

    await vi.waitFor(() => expect(actions.lockUrl).toHaveBeenCalledWith());
  });

  it.each([
    ['não é protegida', token({ protected: false })],
    ['veio de uma versão sem o campo', token()],
  ])('não deve mostrar "Lock" Quando a URL %s', async (_caso, url) => {
    await renderWith(url);

    expect(screen.queryByRole('button', { name: 'Lock' })).toBeNull();
  });

  it('não deve mostrar nada Quando não há URL aberta', async () => {
    const { container } = await renderWith(null);

    expect(container.textContent?.trim()).toBe('');
  });

  it('deve levar a Checks pelos chips de assinatura e schema Quando a URL os tem', async () => {
    await renderWith(
      token({ signature: { provider: 'stripe', secret: '••••1234' }, schema: { type: 'object' } }),
    );

    expect(
      screen.getByRole('link', { name: 'Signature verification: Stripe. Open Checks' }),
    ).toHaveProperty('href', expect.stringContaining(`/${TOKEN_ID}/checks?section=signature`));
    expect(screen.getByRole('link', { name: 'Schema validation on. Open Checks' })).toHaveProperty(
      'href',
      expect.stringContaining(`/${TOKEN_ID}/checks?section=schema`),
    );
  });

  describe('Dado o stream SSE da Inbox', () => {
    const subscriptions = new Subscription();

    beforeEach(() => {
      FakeEventSource.instances = [];
      vi.stubGlobal('EventSource', FakeEventSource);
    });

    afterEach(() => vi.unstubAllGlobals());

    it('deve dizer "Live", "Reconnecting…" e "Offline" conforme a conexão, e sumir sem stream', async () => {
      const { fixture } = await renderWith(token());
      const stream = fixture.debugElement.injector.get(RequestStream);
      const status = () => screen.queryByRole('status')?.textContent?.trim() ?? null;
      expect(status()).toBeNull();

      const subscription = stream.connect(TOKEN_ID).subscribe();
      subscriptions.add(subscription);
      await fixture.whenStable();
      expect(status()).toBe('Connecting…');

      FakeEventSource.latest().open();
      await fixture.whenStable();
      expect(status()).toBe('Live');

      FakeEventSource.latest().fail(FakeEventSource.CONNECTING);
      await fixture.whenStable();
      expect(status()).toBe('Reconnecting…');

      FakeEventSource.latest().fail(FakeEventSource.CLOSED);
      await fixture.whenStable();
      expect(status()).toBe('Offline');

      subscription.unsubscribe();
      await fixture.whenStable();
      expect(status()).toBeNull();
    });
  });
});
