import { RulesSeen } from '../rules/rules-seen';
import { HttpTestingController } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationError, Router, provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { FakeEventSource } from '../../testing/fake-event-source';
import { TOKEN_ID, requestPage, token, webhookRequest } from '../../testing/fixtures';
import {
  checksMatcher,
  compareMatcher,
  inboxMatcher,
  insightsMatcher,
  malformedMatcher,
  outboundMatcher,
  rulesMatcher,
} from '../app.routes';
import { Connection } from '../realtime/connection-store';
import { RequestStore } from '../requests/request-store';
import { Preferences } from '../settings/preferences';
import { KNOWN_URLS_KEY, KnownUrls } from '../token/known-urls';
import { TokenActions } from '../token/token-actions';
import { UrlLock } from '../token/url-lock';
import { UrlMissing } from '../token/url-missing';
import { ANNOUNCEMENT_MS } from '../ui/live-region';
import { ScreenState } from './screen-state';
import { Shell } from './shell';

@Component({ template: '<p>página da rota</p>' })
class Page {}

const REQUEST = '0691864a-71ef-4de5-953b-518660fe6287';

describe('Dado o shell (rail, cabeçalho da URL e a página da rota)', () => {
  let createUrl: ReturnType<typeof vi.fn>;
  let createDefaultUrl: ReturnType<typeof vi.fn>;

  const renderAt = async (url: string, withToken = true) => {
    createUrl = vi.fn().mockResolvedValue(undefined);
    createDefaultUrl = vi.fn().mockResolvedValue(undefined);
    const view = await render(Shell, {
      providers: [
        provideRouter([
          { matcher: rulesMatcher, component: Page },
          { matcher: checksMatcher, component: Page },
          { matcher: outboundMatcher, component: Page },
          { matcher: insightsMatcher, component: Page },
          { matcher: compareMatcher, component: Page },
          { matcher: inboxMatcher, component: Page },
          { matcher: malformedMatcher, children: [] },
          { path: 'share/:shareId', component: Page },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TokenActions, useValue: { createUrl, createDefaultUrl } },
      ],
      configureTestBed: (testBed) => {
        if (withToken) {
          testBed.inject(Preferences).token.set(token());
        }
      },
    });
    await view.navigate(url);
    return view;
  };

  const sections = () => screen.queryByRole('navigation', { name: 'URL sections' });

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('deve listar os cinco destinos, apontar para a URL aberta e marcar o da rota, e passar no axe', async () => {
    const { container } = await renderAt(`/${TOKEN_ID}/rules`);

    const links = within(sections() as HTMLElement).getAllByRole('link');
    expect(
      links.map((link) => [
        link.textContent?.trim(),
        link.getAttribute('href'),
        link.getAttribute('aria-current'),
      ]),
    ).toEqual([
      ['Inbox', `/${TOKEN_ID}`, null],
      ['Rules', `/${TOKEN_ID}/rules`, 'page'],
      ['Checks', `/${TOKEN_ID}/checks`, null],
      ['Outbound', `/${TOKEN_ID}/outbound`, null],
      ['Insights', `/${TOKEN_ID}/insights`, null],
    ]);
    expect(screen.getByText('página da rota')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it.each([
    ['uma mensagem aberta', `/${TOKEN_ID}/${REQUEST}/1`, 'Inbox'],
    ['o Compare, que não é destino', `/${TOKEN_ID}/compare/${REQUEST}/${REQUEST}`, null],
  ])('deve marcar o destino certo Quando a rota é %s', async (_caso, url, current) => {
    await renderAt(url);

    const marked = within(sections() as HTMLElement)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent?.trim());
    expect(marked).toEqual(current ? [current] : []);
  });

  it('deve ter só o FAB, Settings e Help, sem destinos nem cabeçalho, Quando nenhuma URL está aberta', async () => {
    await renderAt('/', false);

    expect(sections()).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Webhook URL' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New URL' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Help' })).toBeTruthy();
  });

  it('deve tirar os destinos, o cabeçalho e a página Quando a URL da rota está trancada', async () => {
    const { fixture } = await renderAt(`/${TOKEN_ID}`);

    fixture.debugElement.injector.get(UrlLock).lock(TOKEN_ID);
    await fixture.whenStable();

    expect(sections()).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Webhook URL' })).toBeNull();
    expect(screen.queryByText('página da rota')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'This URL is protected' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New URL' })).toBeTruthy();
  });

  it('deve manter "New URL", Settings e Help no ⋮ da barra do celular Quando a URL está trancada (trava 11)', async () => {
    const user = userEvent.setup();
    const { fixture } = await renderAt(`/${TOKEN_ID}`);
    fixture.debugElement.injector.get(UrlLock).lock(TOKEN_ID);
    await fixture.whenStable();

    await user.click(screen.getByRole('button', { name: 'More actions', hidden: true }));

    expect(
      screen.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim()),
    ).toEqual(['New URL', 'Settings', 'Help']);
  });

  it('deve mostrar as não lidas no destino Inbox, com o número no nome (INBOX-02)', async () => {
    const { container } = await renderAt(`/${TOKEN_ID}/rules`);

    TestBed.inject(Preferences).unread.set({ [TOKEN_ID]: ['a', 'b', 'c'] });
    await screen.findByRole('link', { name: 'Inbox, 3 unread' });

    expect(container.querySelector('.destination .badge')?.textContent?.trim()).toBe('3');
    await expectNoAxeViolations(container);
  });

  // WM-01: ponto em Rules quando chegaram mensagens sem regra desde a última visita a Regras.
  it('deve marcar Rules com "{n} requests without a rule" desde a última visita', async () => {
    const { container } = await renderAt(`/${TOKEN_ID}`);
    const seen = TestBed.inject(RulesSeen);
    const store = TestBed.inject(RequestStore);
    seen.markSeen(TOKEN_ID);
    const depois = '2999-01-01 00:00:00';
    const antes = '2000-01-01 00:00:00';
    const load = store.load(TOKEN_ID);
    TestBed.inject(HttpTestingController)
      .match((req) => req.url === `/token/${TOKEN_ID}/requests`)
      .forEach((req) =>
        req.flush(
          requestPage([
            webhookRequest(1, {
              created_at: depois,
              rule: null,
              near_miss: { id: 'r', name: 'P', failed: ['x'] },
            }),
            webhookRequest(2, {
              created_at: antes,
              rule: null,
              near_miss: { id: 'r', name: 'P', failed: ['x'] },
            }),
            webhookRequest(3, { created_at: depois, rule: { id: 'r', name: 'P' } }),
          ]),
        ),
      );
    await load;

    await screen.findByRole('link', { name: 'Rules · 1 request without a rule' });
    expect(container.querySelector('.destination .dot')).not.toBeNull();

    // A visita seguinte a Regras (depois da mensagem de 2999) apaga o ponto.
    vi.useFakeTimers({ now: new Date('3000-01-01T00:00:00Z'), toFake: ['Date'] });
    seen.markSeen(TOKEN_ID);
    vi.useRealTimers();
    await screen.findByRole('link', { name: 'Rules' });
  });

  describe('Dado o ponto de atenção de Checks', () => {
    const invalid = (n: number, created_at: string) =>
      webhookRequest(n, {
        created_at,
        signature: { provider: 'stripe', valid: false, reason: 'signature mismatch' },
      });
    const hour = (created_at: string) =>
      new Date(`${created_at.replace(' ', 'T')}Z`).toLocaleTimeString('en', {
        hour: 'numeric',
        minute: '2-digit',
      });

    it('deve dizer quantas assinaturas inválidas e desde quando, pela mais antiga', async () => {
      const { container } = await renderAt(`/${TOKEN_ID}`);
      const store = TestBed.inject(RequestStore);
      expect(screen.getByRole('link', { name: 'Checks' })).toBeTruthy();

      store.tokenId.set(TOKEN_ID);
      store.append(invalid(1, '2026-09-26 21:10:05'), 1);
      store.append(invalid(2, '2026-09-26 21:40:00'), 2);

      await screen.findByRole('link', {
        name: `Checks, 2 invalid signatures since ${hour('2026-09-26 21:10:05')}`,
      });
      expect(container.querySelector('.destination .dot')).not.toBeNull();
    });

    it('deve dizer o schema inválido Quando nenhuma assinatura falhou', async () => {
      await renderAt(`/${TOKEN_ID}`);
      const store = TestBed.inject(RequestStore);

      store.tokenId.set(TOKEN_ID);
      store.append(webhookRequest(1, { schema: { valid: false, errors: [] } }), 1);

      await screen.findByRole('link', {
        name: `Checks, 1 invalid schema since ${hour(webhookRequest(1).created_at)}`,
      });
    });

    it('deve contar a decifra que falhou Quando nenhuma assinatura falhou, antes do schema', async () => {
      await renderAt(`/${TOKEN_ID}`);
      const store = TestBed.inject(RequestStore);
      const decifra = (state: 'invalid' | 'unknown_kid' | 'valid') => ({
        state,
        kid: 'enc-1',
        signature_kid: null,
        reason: state === 'invalid' ? 'aud_mismatch' : null,
        jti: null,
        duplicate_of: null,
      });

      store.tokenId.set(TOKEN_ID);
      store.append(webhookRequest(1, { schema: { valid: false, errors: [] } }), 1);
      store.append(webhookRequest(2, { decryption: decifra('invalid') }), 2);
      store.append(webhookRequest(3, { decryption: decifra('unknown_kid') }), 3);
      store.append(webhookRequest(4, { decryption: decifra('valid') }), 4);

      await screen.findByRole('link', {
        name: `Checks, 2 invalid decryptions since ${hour(webhookRequest(2).created_at)}`,
      });
    });

    it('deve apagar ao abrir Checks, ou a Entrada filtrada pela assinatura inválida, e voltar com a próxima', async () => {
      const { navigate } = await renderAt(`/${TOKEN_ID}`);
      const store = TestBed.inject(RequestStore);
      store.tokenId.set(TOKEN_ID);
      store.append(invalid(1, '2026-09-26 21:10:05'), 1);
      await screen.findByRole('link', { name: /^Checks, 1 invalid signature since/ });

      await navigate(`/${TOKEN_ID}/checks`);
      await screen.findByRole('link', { name: 'Checks' });

      store.append(invalid(2, '2999-01-01 00:00:00'), 2);
      await screen.findByRole('link', { name: /^Checks, 1 invalid signature since/ });
      vi.useFakeTimers({ now: new Date('3000-01-01T00:00:00Z'), toFake: ['Date'] });
      await navigate(`/${TOKEN_ID}?signature=invalid`);
      vi.useRealTimers();
      await screen.findByRole('link', { name: 'Checks' });
    });
  });

  it('deve abrir e fechar a busca da lista pela lupa da barra do celular (INBOX-29/31)', async () => {
    const user = userEvent.setup();
    const { container } = await renderAt(`/${TOKEN_ID}`);
    const state = TestBed.inject(ScreenState);
    const search = screen.getByRole('button', { name: 'Search requests', hidden: true });

    await user.click(search);
    expect(state.searchOpen()).toBe(true);
    expect(search.getAttribute('aria-expanded')).toBe('true');
    // Buscando, o cartão da URL recolhe (a lista começa perto do topo).
    expect(container.querySelector('app-url-header')?.classList).toContain('collapsed');

    await user.click(search);
    expect(state.searchOpen()).toBe(false);
    expect(search.getAttribute('aria-expanded')).toBe('false');
  });

  it('deve tirar a barra do topo e o cartão da URL Quando o detalhe está em tela cheia (INBOX-30/33)', async () => {
    const { container, fixture } = await renderAt(`/${TOKEN_ID}`);

    TestBed.inject(ScreenState).detailFullscreen.set(true);
    await fixture.whenStable();

    expect(container.querySelector('.rail')?.classList).toContain('on-detail');
    expect(container.querySelector('app-url-header')?.classList).toContain('collapsed');
    expect(sections()).not.toBeNull();
  });

  it('deve reunir no ⋮ da barra do celular as ações que saem da barra (INBOX-29)', async () => {
    const user = userEvent.setup();
    await renderAt(`/${TOKEN_ID}`);

    // A barra do topo só aparece abaixo de 600 px (media query, que o jsdom não aplica).
    await user.click(screen.getByRole('button', { name: 'More actions', hidden: true }));

    expect(
      screen.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim()),
    ).toEqual([
      'Send',
      'New URL',
      'Edit URL',
      'Open in new tab',
      'Copy CLI command',
      'Guides',
      'Delete URL',
      'Settings',
      'Help',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'New URL', hidden: true }));
    await vi.waitFor(() => expect(createUrl).toHaveBeenCalled());
  });

  it('deve abrir o "Create New URL" pelo botão de ícone "New URL", com o title e a tecla de hoje (UX-11)', async () => {
    const { container } = await renderAt(`/${TOKEN_ID}/checks`);
    const button = screen.getByRole('button', { name: 'New URL' });

    expect(button.getAttribute('title')).toBe('New URL (N)');
    expect(button.classList).toContain('new-url');
    expect(container.querySelector('.fab')).toBeNull();
    await userEvent.click(button);

    await vi.waitFor(() => expect(createUrl).toHaveBeenCalledWith());
  });

  describe('Dado o rail e o cabeçalho iguais em todo destino (B1, UX-11 e UX-12)', () => {
    it.each([
      ['a Entrada', `/${TOKEN_ID}`],
      ['Regras', `/${TOKEN_ID}/rules`],
      ['Métricas', `/${TOKEN_ID}/insights`],
    ])('deve abrir o tempo real e mostrar "Live" em %s', async (_caso, url) => {
      await renderAt(url);

      await vi.waitFor(() =>
        expect(FakeEventSource.latest().url).toBe(`/token/${TOKEN_ID}/stream`),
      );
      FakeEventSource.latest().open();

      expect((await screen.findByText('Live')).closest('app-live-status')).not.toBeNull();
    });

    it('deve ler o total da URL à parte e contar as que chegam Quando a tela não é a Entrada', async () => {
      await renderAt(`/${TOKEN_ID}/rules`);
      const http = TestBed.inject(HttpTestingController);

      const peek = await vi.waitFor(() =>
        http.expectOne((req) => req.url === `/token/${TOKEN_ID}/requests`),
      );
      expect(peek.request.params.get('per_page')).toBe('1');
      peek.flush(requestPage([webhookRequest(1)], { total: 2 }));
      expect(await screen.findByRole('link', { name: '2 requests' })).toBeTruthy();

      const nova = webhookRequest(9);
      FakeEventSource.latest().emit('request.created', { request: nova, total: 3 });

      expect(await screen.findByRole('link', { name: '3 requests' })).toBeTruthy();
      expect(TestBed.inject(Preferences).unread()).toEqual({ [TOKEN_ID]: [nova.uuid] });
      await screen.findByRole('link', { name: 'Inbox, 1 unread' });
    });

    it('não deve contar no badge nem no título as não lidas de outra URL', async () => {
      const outra = '7b6e2a10-0c1d-4e5f-8a9b-1c2d3e4f5a6b';
      const { fixture, navigate } = await renderAt(`/${TOKEN_ID}/rules`);
      await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
      FakeEventSource.latest().emit('request.created', { request: webhookRequest(9), total: 1 });
      await screen.findByRole('link', { name: 'Inbox, 1 unread' });

      await navigate(`/${outra}/rules`);
      await fixture.whenStable();

      await vi.waitFor(() =>
        expect(document.title).toBe(`Rules · URL ${outra.slice(0, 5)} · Anzol`),
      );
      expect(screen.getByRole('link', { name: 'Inbox' })).toBeTruthy();

      await navigate(`/${TOKEN_ID}/rules`);
      await screen.findByRole('link', { name: 'Inbox, 1 unread' });
    });

    it('não deve ler o total à parte nem contar as que chegam Quando a tela é a Entrada (ela mesma conta)', async () => {
      await renderAt(`/${TOKEN_ID}`);
      await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

      FakeEventSource.latest().emit('request.created', { request: webhookRequest(9), total: 3 });

      TestBed.inject(HttpTestingController).expectNone(
        (req) => req.url === `/token/${TOKEN_ID}/requests`,
      );
      expect(TestBed.inject(Preferences).unread()).toEqual({});
    });

    it('deve fechar o tempo real Quando a URL tranca', async () => {
      const { fixture } = await renderAt(`/${TOKEN_ID}/rules`);
      await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

      TestBed.inject(UrlLock).lock(TOKEN_ID);
      await fixture.whenStable();

      await vi.waitFor(() =>
        expect(FakeEventSource.latest().readyState).toBe(FakeEventSource.CLOSED),
      );
    });

    it('deve levar à Entrada Quando "Search requests" é clicado fora dela', async () => {
      const { fixture } = await renderAt(`/${TOKEN_ID}/rules`);
      const search = screen.getByRole('button', { name: 'Search requests' });
      expect(search.hasAttribute('aria-expanded')).toBe(false);

      await userEvent.click(search);

      const router = fixture.debugElement.injector.get(Router);
      await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}`));
      await vi.waitFor(() => expect(TestBed.inject(ScreenState).searchOpen()).toBe(true));
      TestBed.inject(ScreenState).searchOpen.set(false);
    });

    it('deve parar de esperar pela busca Quando o shell sai antes de a lista chegar', async () => {
      const { fixture } = await renderAt(`/${TOKEN_ID}/rules`);
      await userEvent.click(screen.getByRole('button', { name: 'Search requests' }));
      await vi.waitFor(() => expect(TestBed.inject(ScreenState).searchOpen()).toBe(true));
      const procuras = vi.spyOn(document, 'querySelector');

      fixture.destroy();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(
        procuras.mock.calls.filter(([seletor]) => seletor === '[role="search"] input'),
      ).toEqual([]);
      procuras.mockRestore();
    });
  });

  describe('Dado a faixa "sem conexão" (B1, UX-16)', () => {
    const region = () =>
      within(screen.getByRole('group', { name: 'Connection' })).getByRole('status');

    it('deve existir vazia desde a carga, sem botão nem contagem', async () => {
      const { container } = await renderAt(`/${TOKEN_ID}/checks`);

      expect(region().textContent).toBe('');
      expect(screen.queryByRole('button', { name: 'Try again now' })).toBeNull();
      await expectNoAxeViolations(container);
    });

    it('deve dizer a queda na região, com a contagem fora dela e "Try again now"', async () => {
      const { container, fixture } = await renderAt(`/${TOKEN_ID}`);
      const connection = TestBed.inject(Connection);

      connection.failed();
      await fixture.whenStable();

      expect(region().textContent).toMatch(/^No connection to the server since /);
      const countdown = screen.getByText(/^Trying again in \d+ s$/);
      expect(countdown.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(region().contains(countdown)).toBe(false);
      await expectNoAxeViolations(container);

      const retry = vi.spyOn(connection, 'retry').mockResolvedValue();
      await userEvent.click(screen.getByRole('button', { name: 'Try again now' }));
      expect(retry).toHaveBeenCalled();
      connection.downSince.set(null);
      connection.notice.set('');
    });
  });

  describe('Dado um destino cujo pedaço não carregou (B1, UX-16)', () => {
    const fail = (router: Router, url: string) =>
      (router.events as unknown as { next(event: unknown): void }).next(
        new NavigationError(
          1,
          url,
          new TypeError('Failed to fetch dynamically imported module: rules-page.js'),
        ),
      );

    it('deve trocar o destino no rail e dizer "Could not open Rules", com a página de antes viva', async () => {
      const { container, fixture } = await renderAt(`/${TOKEN_ID}`);
      const router = fixture.debugElement.injector.get(Router);

      fail(router, `/${TOKEN_ID}/rules`);
      await fixture.whenStable();

      const main = screen.getByRole('main');
      expect(within(main).getByRole('heading', { level: 1 }).textContent).toBe(
        'Could not open Rules',
      );
      expect(main.textContent).toContain('The server did not answer. Nothing was changed.');
      expect(screen.getByRole('link', { name: 'Rules' }).getAttribute('aria-current')).toBe('page');
      expect(screen.getByText('página da rota').closest('[hidden]')).not.toBeNull();
      expect(document.title).toBe(`Rules · URL ${TOKEN_ID.slice(0, 5)} · Anzol`);
      await expectNoAxeViolations(container);
    });

    it('deve tentar de novo o mesmo endereço em "Try again" e voltar à página Quando ele abre', async () => {
      const { fixture } = await renderAt(`/${TOKEN_ID}`);
      const router = fixture.debugElement.injector.get(Router);
      fail(router, `/${TOKEN_ID}/rules`);
      await fixture.whenStable();

      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

      await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/rules`));
      await vi.waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Could not open Rules' })).toBeNull(),
      );
      expect(screen.getByText('página da rota').closest('[hidden]')).toBeNull();
    });

    it('deve voltar à Entrada, que seguia aberta, em "Back to the Inbox"', async () => {
      const { fixture } = await renderAt(`/${TOKEN_ID}`);
      fail(fixture.debugElement.injector.get(Router), `/${TOKEN_ID}/rules`);
      await fixture.whenStable();

      await userEvent.click(screen.getByRole('link', { name: 'Back to the Inbox' }));

      await vi.waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Could not open Rules' })).toBeNull(),
      );
      expect(screen.getByRole('link', { name: 'Inbox' }).getAttribute('aria-current')).toBe('page');
    });

    it('não deve tratar como pedaço que não carregou o erro de outra navegação', async () => {
      const { fixture } = await renderAt(`/${TOKEN_ID}`);
      const router = fixture.debugElement.injector.get(Router);

      (router.events as unknown as { next(event: unknown): void }).next(
        new NavigationError(1, `/${TOKEN_ID}/rules`, new Error('outra coisa')),
      );
      await fixture.whenStable();

      expect(screen.queryByRole('heading', { level: 1, name: /^Could not open/ })).toBeNull();
    });
  });

  it('deve começar pelo "Skip to content", que leva o foco ao main (UX-21)', async () => {
    @Component({ template: '<main aria-label="Página">conteúdo</main>' })
    class WithMain {}
    await render(Shell, {
      providers: [
        provideRouter([{ matcher: inboxMatcher, component: WithMain }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
      configureTestBed: (testBed) => testBed.inject(Preferences).token.set(token()),
    }).then((view) => view.navigate(`/${TOKEN_ID}`));

    await userEvent.tab();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(document.activeElement).toBe(skip);
    expect(skip.getAttribute('href')).toBe(`#/${TOKEN_ID}`);

    await userEvent.keyboard('{Enter}');

    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('deve trocar o tema em Settings, gravar e fechar devolvendo o foco ao botão', async () => {
    const user = userEvent.setup();
    const { container } = await renderAt(`/${TOKEN_ID}`);
    const settings = screen.getByRole('button', { name: 'Settings' });

    await user.click(settings);
    const theme = await screen.findByRole('radiogroup', { name: 'Theme' });
    expect(within(theme).getByRole('radio', { name: 'System' })).toHaveProperty('checked', true);
    await user.click(within(theme).getByRole('radio', { name: 'Dark' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('"dark"');
    expect(screen.getByRole('switch', { name: 'Keyboard shortcuts' })).toHaveProperty(
      'checked',
      true,
    );
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull();
    expect(document.activeElement).toBe(settings);
  });

  it('deve trocar a densidade para compacta em Settings, gravar e pôr a classe no <html>', async () => {
    const user = userEvent.setup();
    await renderAt(`/${TOKEN_ID}`);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const density = await screen.findByRole('radiogroup', { name: 'Density' });
    expect(within(density).getByRole('radio', { name: 'Comfortable' })).toHaveProperty(
      'checked',
      true,
    );
    expect(document.documentElement.classList.contains('compact')).toBe(false);
    await user.click(within(density).getByRole('radio', { name: 'Compact' }));

    expect(document.documentElement.classList.contains('compact')).toBe(true);
    expect(localStorage.getItem('density')).toBe('"compact"');
    await user.click(within(density).getByRole('radio', { name: 'Comfortable' }));
    expect(document.documentElement.classList.contains('compact')).toBe(false);
  });

  it('deve mostrar cada idioma no próprio nome e pedir para recarregar Quando o idioma muda', async () => {
    const user = userEvent.setup();
    await renderAt(`/${TOKEN_ID}`);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const language = await screen.findByRole('radiogroup', { name: 'Language' });
    expect(
      within(language)
        .getAllByRole('radio')
        .map((radio) => radio.parentElement?.textContent?.trim()),
    ).toEqual(['English', 'Português (Brasil)']);
    expect(screen.queryByRole('button', { name: 'Reload now' })).toBeNull();
    await user.click(within(language).getByRole('radio', { name: 'Português (Brasil)' }));

    expect(localStorage.getItem('language')).toBe('"pt-BR"');
    expect(
      within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('status').textContent,
    ).toContain('The language changes when the page reloads.');
    expect(screen.getByRole('button', { name: 'Reload now' })).toBeTruthy();
  });

  it('deve mostrar os atalhos e o About com o GitHub do projeto Quando Help é clicado', async () => {
    const user = userEvent.setup();
    const { container } = await renderAt(`/${TOKEN_ID}`);

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const help = await screen.findByRole('dialog', { name: 'Help' });
    const keys = within(help).getByRole('table', { name: 'Keyboard shortcuts' });
    // B1: as teclas novas (o seletor de URLs e o painel de filtros) estão na folha.
    expect(
      within(keys)
        .getAllByRole('row')
        .map((row) => [...row.children].map((cell) => cell.textContent?.trim()).join(' ')),
    ).toEqual(
      expect.arrayContaining([
        'U Switch URL',
        'F Open or close the filters of the Inbox',
        'R · D · E Replay, compare, explain the open request',
        'P Open or close the action panel',
      ]),
    );
    expect(
      within(help)
        .getAllByRole('link')
        .map((link) => [link.textContent?.trim(), link.getAttribute('href')]),
    ).toEqual([
      ['First webhook', `/${TOKEN_ID}?guide=first`],
      ['Test a retry', `/${TOKEN_ID}?guide=retry`],
      ['GitHub', 'https://github.com/isdiegoalves/anzol'],
    ]);
    await expectNoAxeViolations(container);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
  });

  describe('Dado uma URL que não existe (B1, UX-16)', () => {
    const OTHER = 'c4291aaa-2222-4222-8222-222222222222';
    const gone = async (url: string) => {
      const view = await renderAt(url, false);
      TestBed.inject(UrlMissing).mark(TOKEN_ID);
      await screen.findByRole('heading', { name: 'This URL no longer exists', level: 1 });
      return view;
    };

    it.each([
      ['a Entrada', `/${TOKEN_ID}`],
      ['Regras', `/${TOKEN_ID}/rules`],
      ['o Compare', `/${TOKEN_ID}/compare/${REQUEST}/${REQUEST}`],
    ])('deve trocar a página de %s pela página única, com o shell em volta', async (_caso, url) => {
      const { container } = await gone(url);

      expect(screen.queryByText('página da rota')).toBeNull();
      const main = screen.getByRole('main');
      expect(main.textContent).toContain('It was deleted, or it expired after 7 days without use.');
      expect(main.textContent).toContain('Whoever sends to it gets 410 Gone.');
      expect(within(main).getByRole('button', { name: 'Create a new URL' })).toBeTruthy();
      expect(document.title).toBe('URL not found · Anzol');
      await expectNoAxeViolations(container);
    });

    it('deve mostrar no cabeçalho o endereço pedido, riscado e sem copiar, com o selo "deleted"', async () => {
      const { container, fixture } = await gone(`/${TOKEN_ID}/checks`);
      // A URL que o navegador guardava (outra) não aparece no lugar da pedida.
      TestBed.inject(Preferences).token.set(token({ uuid: OTHER }));
      await fixture.whenStable();

      const address = screen.getByRole('textbox', { name: 'Webhook URL' });
      expect((address as HTMLInputElement).value).toBe(`${location.origin}/${TOKEN_ID}`);
      expect(screen.getByRole('button', { name: 'Copy' }).getAttribute('aria-disabled')).toBe(
        'true',
      );
      expect(container.querySelector('app-url-header .gone')?.textContent).toBe('deleted');
      expect(container.querySelector('app-copy-field')?.classList).toContain('disabled');
      expect(screen.getByRole('button', { name: /Switch URL$/ })).toHaveProperty('disabled', false);
      // Nada do que é da URL aberta: nem "Send", nem o menu da URL.
      expect(screen.queryByRole('button', { name: 'More URL actions' })).toBeNull();
    });

    it('deve desligar os destinos do rail, focáveis e com a razão', async () => {
      await gone(`/${TOKEN_ID}/rules`);

      const links = within(sections() as HTMLElement).getAllByRole('link');
      expect(links).toHaveLength(5);
      for (const link of links) {
        expect(link.getAttribute('aria-disabled')).toBe('true');
        expect(link.hasAttribute('href')).toBe(false);
        expect(link.tabIndex).toBe(0);
        const reason = document.getElementById(link.getAttribute('aria-describedby') ?? '');
        expect(reason?.textContent).toBe('This URL no longer exists');
      }
    });

    it('deve criar a URL, sem perguntar nada, só Quando "Create a new URL" é clicado', async () => {
      await gone(`/${TOKEN_ID}`);
      expect(createDefaultUrl).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Create a new URL' }));

      await vi.waitFor(() => expect(createDefaultUrl).toHaveBeenCalledTimes(1));
      expect(createUrl).not.toHaveBeenCalled();
    });

    it('deve oferecer "Switch to another URL" só com outra URL na lista, e abrir o seletor', async () => {
      await gone(`/${TOKEN_ID}`);
      expect(screen.queryByRole('button', { name: 'Switch to another URL' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Remove from this browser' })).toBeNull();

      TestBed.inject(KnownUrls).opened(OTHER);
      TestBed.inject(KnownUrls).opened(TOKEN_ID);
      await userEvent.click(await screen.findByRole('button', { name: 'Switch to another URL' }));

      // O jsdom não tem `matchMedia`: o seletor abre como no celular (folha).
      const menu = await screen.findByRole('dialog', { name: 'URLs in this browser' });
      expect(
        within(menu)
          .getAllByRole('menuitemradio')
          .map((item) => item.getAttribute('aria-label')),
      ).toEqual([
        `URL ${TOKEN_ID.slice(0, 5)}, ${TOKEN_ID.slice(0, 5)}, deleted`,
        expect.stringMatching(/^URL c4291, c4291, opened /),
      ]);
      TestBed.inject(ScreenState).switcherOpen.set(false);
    });

    it('deve tirar a URL da lista do navegador e dizer que tirou', async () => {
      await gone(`/${TOKEN_ID}`);
      TestBed.inject(KnownUrls).opened(TOKEN_ID);

      await userEvent.click(
        await screen.findByRole('button', { name: 'Remove from this browser' }),
      );

      expect(TestBed.inject(KnownUrls).urls()).toEqual([]);
      expect(screen.queryByRole('button', { name: 'Remove from this browser' })).toBeNull();
      expect(screen.getByRole('main').textContent).toContain('Removed from this browser.');
      expect(document.activeElement).toBe(screen.getByRole('main'));
    });

    it('deve voltar à página da rota Quando a URL aberta passa a ser outra', async () => {
      const { fixture } = await gone(`/${TOKEN_ID}/rules`);

      await fixture.debugElement.injector.get(Router).navigateByUrl(`/${OTHER}/rules`);
      TestBed.inject(Preferences).token.set(token({ uuid: OTHER }));

      expect(await screen.findByText('página da rota')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'This URL no longer exists' })).toBeNull();
    });

    it('deve dizer que o endereço não é um id de URL Quando ele vem malformado, sem redirecionar', async () => {
      const { fixture } = await renderAt('/12345/rules', false);

      const main = await screen.findByRole('main');
      expect(main.textContent).toContain('This address is not a valid URL id.');
      expect(main.textContent).not.toContain('410 Gone');
      expect(fixture.debugElement.injector.get(Router).url).toBe('/12345/rules');
      expect(document.title).toBe('URL not found · Anzol');
      expect((screen.getByRole('textbox', { name: 'Webhook URL' }) as HTMLInputElement).value).toBe(
        `${location.origin}/12345`,
      );
    });
  });

  describe('Dado o título da aba (B1, UX-21)', () => {
    it.each([
      ['Inbox', `/${TOKEN_ID}`],
      ['Inbox', `/${TOKEN_ID}/${REQUEST}/1`],
      ['Rules', `/${TOKEN_ID}/rules`],
      ['Checks', `/${TOKEN_ID}/checks`],
      ['Outbound', `/${TOKEN_ID}/outbound`],
      ['Insights', `/${TOKEN_ID}/insights`],
      ['Compare', `/${TOKEN_ID}/compare/${REQUEST}/${REQUEST}`],
    ])('deve ser "%s · URL {id5} · Anzol" em %s', async (destination, url) => {
      await renderAt(url);

      await vi.waitFor(() =>
        expect(document.title).toBe(`${destination} · URL ${TOKEN_ID.slice(0, 5)} · Anzol`),
      );
    });

    it('deve levar o apelido e as não lidas na frente', async () => {
      const { fixture } = await renderAt(`/${TOKEN_ID}/rules`);

      TestBed.inject(KnownUrls).rename(TOKEN_ID, 'Pagamentos');
      TestBed.inject(Preferences).unread.set({ [TOKEN_ID]: ['a', 'b', 'c'] });
      await fixture.whenStable();

      expect(document.title).toBe('(3) Rules · Pagamentos · Anzol');
    });

    it('deve ser "Locked · Anzol" com a URL trancada', async () => {
      const { fixture } = await renderAt(`/${TOKEN_ID}`);
      TestBed.inject(UrlLock).lock(TOKEN_ID);
      await fixture.whenStable();
      expect(document.title).toBe('Locked · Anzol');
    });

    it('deve ser "Anzol" Quando nenhuma URL está aberta', async () => {
      await renderAt('/', false);

      await vi.waitFor(() => expect(document.title).toBe('Anzol'));
    });
  });

  describe('Dado o seletor de URLs no cabeçalho (B1)', () => {
    const OTHER = 'c4291aaa-2222-4222-8222-222222222222';
    const known = (nickname: string) =>
      localStorage.setItem(
        KNOWN_URLS_KEY,
        JSON.stringify([
          { uuid: TOKEN_ID, nickname: '', openedAt: '2026-09-28T12:00:00.000Z' },
          { uuid: OTHER, nickname, openedAt: '2026-09-28T11:00:00.000Z' },
        ]),
      );

    it('deve abrir a outra URL no mesmo destino e anunciar quando ela abriu', async () => {
      known('Pagamentos');
      const user = userEvent.setup();
      const { fixture } = await renderAt(`/${TOKEN_ID}/rules`);
      const router = fixture.debugElement.injector.get(Router);
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

      await user.click(screen.getByRole('button', { name: /Switch URL$/ }));
      await user.click(await screen.findByRole('menuitemradio', { name: /^Pagamentos/ }));

      await vi.waitFor(() => expect(router.url).toBe(`/${OTHER}/rules`));
      expect(announce).not.toHaveBeenCalled();
      TestBed.inject(Preferences).token.set(token({ uuid: OTHER }));
      await vi.waitFor(() =>
        expect(announce).toHaveBeenCalledWith('Pagamentos opened. Rules.', ANNOUNCEMENT_MS),
      );
      expect(announce).toHaveBeenCalledTimes(1);
    });

    it('deve dizer o total de requisições no anúncio Quando o destino é a Entrada', async () => {
      known('Pagamentos');
      const user = userEvent.setup();
      const { fixture } = await renderAt(`/${TOKEN_ID}`);
      const router = fixture.debugElement.injector.get(Router);
      const store = TestBed.inject(RequestStore);
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

      await user.click(screen.getByRole('button', { name: /Switch URL$/ }));
      await user.click(await screen.findByRole('menuitemradio', { name: /^Pagamentos/ }));
      await vi.waitFor(() => expect(router.url).toBe(`/${OTHER}`));
      TestBed.inject(Preferences).token.set(token({ uuid: OTHER }));
      await fixture.whenStable();
      expect(announce).not.toHaveBeenCalled();

      const load = store.load(OTHER);
      TestBed.inject(HttpTestingController)
        .match((req) => req.url === `/token/${OTHER}/requests`)
        .forEach((req) => req.flush(requestPage([webhookRequest(1), webhookRequest(2)])));
      await load;

      await vi.waitFor(() =>
        expect(announce).toHaveBeenCalledWith(
          'Pagamentos opened. Inbox, 2 requests.',
          ANNOUNCEMENT_MS,
        ),
      );
    });

    it('deve abrir o seletor com U, e o "New URL…" dele abrir o "Create New URL"', async () => {
      known('');
      const user = userEvent.setup();
      await renderAt(`/${TOKEN_ID}`);

      await user.keyboard('u');
      await user.click(await screen.findByRole('menuitem', { name: /^New URL…/ }));

      await vi.waitFor(() => expect(createUrl).toHaveBeenCalled());
      TestBed.inject(ScreenState).switcherOpen.set(false);
    });

    it('deve esquecer todas as URLs pelo botão de Settings', async () => {
      known('Pagamentos');
      const user = userEvent.setup();
      const { container } = await renderAt(`/${TOKEN_ID}`);

      await user.click(screen.getByRole('button', { name: 'Settings' }));
      await user.click(await screen.findByRole('button', { name: 'Forget all URLs' }));

      expect(TestBed.inject(KnownUrls).urls()).toEqual([]);
      expect(localStorage.getItem(KNOWN_URLS_KEY)).toBe('[]');
      expect(
        within(screen.getByRole('dialog', { name: 'Settings' })).getByText(
          'This browser keeps no URL.',
        ),
      ).toBeTruthy();
      await expectNoAxeViolations(container);
    });
  });

  it('deve ir a Checks com G e C, e não Quando os atalhos estão desligados', async () => {
    const user = userEvent.setup();
    const { fixture } = await renderAt(`/${TOKEN_ID}`);
    const router = fixture.debugElement.injector.get(Router);

    await user.keyboard('gc');
    await vi.waitFor(() => expect(router.url).toBe(`/${TOKEN_ID}/checks`));

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(await screen.findByRole('switch', { name: 'Keyboard shortcuts' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('gr');
    await fixture.whenStable();

    expect(router.url).toBe(`/${TOKEN_ID}/checks`);
  });
});
