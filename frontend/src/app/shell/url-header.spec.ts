import { Clipboard } from '@angular/cdk/clipboard';
import { provideHttpClient } from '@angular/common/http';
import { clearTranslations, loadTranslations } from '@angular/localize';
import { Router, provideRouter } from '@angular/router';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { Subscription } from 'rxjs';
import { expectNoAxeViolations } from '../../testing/axe';
import { FakeEventSource } from '../../testing/fake-event-source';
import { TOKEN_ID, token } from '../../testing/fixtures';
import { RequestStream } from '../realtime/request-stream';
import { Preferences } from '../settings/preferences';
import { Token } from '../token/token';
import { TokenActions } from '../token/token-actions';
import { translations } from '../../locale/pt-BR';
import { RequestStore } from '../requests/request-store';
import { UrlHeader } from './url-header';

describe('Dado o cabeçalho da URL aberta', () => {
  let actions: {
    lockUrl: ReturnType<typeof vi.fn>;
    deleteUrl: ReturnType<typeof vi.fn>;
    copyCliCommand: ReturnType<typeof vi.fn>;
  };

  const renderWith = (url: Token | null) => {
    actions = {
      lockUrl: vi.fn().mockResolvedValue(undefined),
      deleteUrl: vi.fn().mockResolvedValue(undefined),
      copyCliCommand: vi.fn(),
    };
    return render(UrlHeader, {
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: TokenActions, useValue: actions },
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

  it('deve dizer "Enviar" (verbo) e "Copiar" em pt-BR Quando a tradução está carregada', async () => {
    loadTranslations(translations);
    try {
      await renderWith(token());

      expect(screen.getByRole('link', { name: 'Enviar' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Copiar' })).toBeTruthy();
    } finally {
      clearTranslations();
    }
  });

  it('deve levar ao Send de Outbound pelo "Send"', async () => {
    await renderWith(token());

    expect(screen.getByRole('link', { name: 'Send' }).getAttribute('href')).toBe(
      `/${TOKEN_ID}/outbound?send=new`,
    );
  });

  it('deve ter o menu "More URL actions" no lugar do botão "Edit" (INBOX-04, CHECKS-22)', async () => {
    const user = userEvent.setup();
    const { container, fixture } = await renderWith(token());
    const navigate = vi.spyOn(fixture.debugElement.injector.get(Router), 'navigate');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();

    const more = screen.getByRole('button', { name: 'More URL actions' });
    await user.click(more);
    await fixture.whenStable();

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      'Edit URL',
      'Open in new tab',
      'Copy CLI command',
      'Delete URL',
    ]);
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('menuitem', { name: 'Edit URL' }));
    expect(navigate).toHaveBeenCalledWith(['/', TOKEN_ID, 'checks']);
    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'Open in new tab' }));
    expect(open).toHaveBeenCalledWith(`${location.origin}/${TOKEN_ID}`, '_blank', 'noopener');
    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'Copy CLI command' }));
    await vi.waitFor(() => expect(actions.copyCliCommand).toHaveBeenCalledOnce());
    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'Delete URL' }));
    await vi.waitFor(() => expect(actions.deleteUrl).toHaveBeenCalledOnce());
  });

  it('deve mostrar quantas mensagens a URL guarda e o limite, levando a Checks › Response (INBOX-03)', async () => {
    const { fixture } = await renderWith(token({ auto_cleanup: 1000 }));
    const store = fixture.debugElement.injector.get(RequestStore);
    store.tokenId.set(TOKEN_ID);
    store.total.set(128);
    await fixture.whenStable();

    const chip = screen.getByRole('link', {
      name: '128 requests, auto cleanup keeps the 1000 most recent',
    });
    expect(chip.textContent?.replace(/\s+/g, ' ').trim()).toBe('128 · keeps 1000');
    expect(chip.getAttribute('href')).toBe(`/${TOKEN_ID}/checks?section=response`);
  });

  it('deve mostrar só a contagem Quando a URL não tem limpeza automática', async () => {
    const { fixture } = await renderWith(token({ auto_cleanup: null }));
    const store = fixture.debugElement.injector.get(RequestStore);
    store.tokenId.set(TOKEN_ID);
    store.total.set(1);
    await fixture.whenStable();

    expect(screen.getByRole('link', { name: '1 request' }).textContent?.trim()).toBe('1');
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
