import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { TOKEN_ID, token } from '../../testing/fixtures';
import {
  checksMatcher,
  compareMatcher,
  inboxMatcher,
  insightsMatcher,
  outboundMatcher,
  rulesMatcher,
} from '../app.routes';
import { Preferences } from '../settings/preferences';
import { TokenActions } from '../token/token-actions';
import { UrlLock } from '../token/url-lock';
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
    ).toEqual([['GitHub', 'https://github.com/isdiegoalves']]);
    await expectNoAxeViolations(container);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
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
