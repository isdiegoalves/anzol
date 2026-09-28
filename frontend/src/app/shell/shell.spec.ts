import { RulesSeen } from '../rules/rules-seen';
import { HttpTestingController } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
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
import { RequestStore } from '../requests/request-store';
import { Preferences } from '../settings/preferences';
import { KNOWN_URLS_KEY, KnownUrls } from '../token/known-urls';
import { TokenActions } from '../token/token-actions';
import { UrlLock } from '../token/url-lock';
import { UrlMissing } from '../token/url-missing';
import { ScreenState } from './screen-state';
import { Shell } from './shell';

@Component({ template: '<p>página da rota</p>' })
class Page {}

const REQUEST = '0691864a-71ef-4de5-953b-518660fe6287';

describe('Dado o shell (rail, cabeçalho da URL e a página da rota)', () => {
  let createUrl: ReturnType<typeof vi.fn>;

  const renderAt = async (url: string, withToken = true) => {
    createUrl = vi.fn().mockResolvedValue(undefined);
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
        { provide: TokenActions, useValue: { createUrl } },
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

  afterEach(() => {
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

    TestBed.inject(Preferences).unread.set(['a', 'b', 'c']);
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

  it('deve marcar Checks com "needs attention" Quando uma mensagem da lista tem assinatura ou schema inválido (CHECKS-23)', async () => {
    const { container } = await renderAt(`/${TOKEN_ID}`);
    const store = TestBed.inject(RequestStore);
    expect(screen.getByRole('link', { name: 'Checks' })).toBeTruthy();

    store.tokenId.set(TOKEN_ID);
    store.append(
      webhookRequest(1, {
        signature: { provider: 'stripe', valid: false, reason: 'signature mismatch' },
      }),
      1,
    );

    await screen.findByRole('link', { name: 'Checks, needs attention' });
    expect(container.querySelector('.destination .dot')).not.toBeNull();
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
      'Delete URL',
      'Settings',
      'Help',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'New URL', hidden: true }));
    await vi.waitFor(() => expect(createUrl).toHaveBeenCalled());
  });

  it('deve abrir o "Create New URL" Quando o FAB é clicado', async () => {
    await renderAt(`/${TOKEN_ID}/checks`);

    await userEvent.click(screen.getByRole('button', { name: 'New URL' }));

    await vi.waitFor(() => expect(createUrl).toHaveBeenCalledWith());
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
    expect(screen.getByRole('status').textContent).toContain(
      'The language changes when the page reloads.',
    );
    expect(screen.getByRole('button', { name: 'Reload now' })).toBeTruthy();
  });

  it('deve mostrar os atalhos e o About com o GitHub do projeto Quando Help é clicado', async () => {
    const user = userEvent.setup();
    const { container } = await renderAt(`/${TOKEN_ID}`);

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const help = await screen.findByRole('dialog', { name: 'Help' });
    expect(within(help).getByRole('table', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(
      within(help)
        .getAllByRole('link')
        .map((link) => [link.textContent?.trim(), link.getAttribute('href')]),
    ).toEqual([['GitHub', 'https://github.com/isdiegoalves/anzol']]);
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

    it('deve abrir o "Create New URL" só Quando "Create a new URL" é clicado', async () => {
      await gone(`/${TOKEN_ID}`);
      expect(createUrl).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Create a new URL' }));

      await vi.waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
    });

    it('deve oferecer "Switch to another URL" só com outra URL na lista, e abrir o seletor', async () => {
      await gone(`/${TOKEN_ID}`);
      expect(screen.queryByRole('button', { name: 'Switch to another URL' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Remove from this browser' })).toBeNull();

      TestBed.inject(KnownUrls).opened(OTHER);
      TestBed.inject(KnownUrls).opened(TOKEN_ID);
      await userEvent.click(await screen.findByRole('button', { name: 'Switch to another URL' }));

      const menu = await screen.findByRole('menu', { name: 'URLs in this browser' });
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
      TestBed.inject(Preferences).unread.set(['a', 'b', 'c']);
      await fixture.whenStable();

      expect(document.title).toBe('(3) Rules · Pagamentos · Anzol');
    });

    it('deve ser "Locked · Anzol" com a URL trancada', async () => {
      const { fixture } = await renderAt(`/${TOKEN_ID}`);
      TestBed.inject(UrlLock).lock(TOKEN_ID);
      await fixture.whenStable();
      expect(document.title).toBe('Locked · Anzol');
    });

    it('deve ser "Shared request · Anzol" no link só-leitura', async () => {
      await renderAt('/share/abc', false);

      await vi.waitFor(() => expect(document.title).toBe('Shared request · Anzol'));
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
      await user.click(screen.getByRole('menuitemradio', { name: /^Pagamentos/ }));

      await vi.waitFor(() => expect(router.url).toBe(`/${OTHER}/rules`));
      expect(announce).not.toHaveBeenCalled();
      TestBed.inject(Preferences).token.set(token({ uuid: OTHER }));
      await vi.waitFor(() => expect(announce).toHaveBeenCalledWith('Pagamentos opened. Rules.'));
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
      await user.click(screen.getByRole('menuitemradio', { name: /^Pagamentos/ }));
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
        expect(announce).toHaveBeenCalledWith('Pagamentos opened. Inbox, 2 requests.'),
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
