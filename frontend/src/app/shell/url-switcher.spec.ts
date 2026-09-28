import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../testing/axe';
import { KNOWN_URLS_KEY, KnownUrl } from '../token/known-urls';
import { UrlLock } from '../token/url-lock';
import { UrlMissing } from '../token/url-missing';
import { ScreenState } from './screen-state';
import { UrlSwitcher } from './url-switcher';
import { Viewport, WindowClass } from './viewport';

const A = 'd0620341-1111-4111-8111-111111111111';
const B = 'c4291aaa-2222-4222-8222-222222222222';
const C = '5f61bbbb-3333-4333-8333-333333333333';

const NOW = new Date('2026-09-28T12:00:00Z');
const url = (uuid: string, nickname: string, minutesAgo: number): KnownUrl => ({
  uuid,
  nickname,
  openedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
});

describe('Dado o seletor de URLs do cabeçalho (B1)', () => {
  const windowClass = signal<WindowClass>('large');
  const chosen = vi.fn();
  const events = { newUrl: vi.fn(), rename: vi.fn(), forget: vi.fn() };

  const show = async (urls: KnownUrl[], current = A) => {
    localStorage.setItem(KNOWN_URLS_KEY, JSON.stringify(urls));
    return render(UrlSwitcher, {
      inputs: { current },
      on: { chosen, ...events },
      providers: [{ provide: Viewport, useValue: { windowClass } }],
    });
  };
  const trigger = () => screen.getByRole('button', { name: /Switch URL$/ });
  const items = () =>
    screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('aria-label'));

  beforeEach(() => {
    localStorage.clear();
    windowClass.set('large');
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    vi.clearAllMocks();
  });

  afterEach(() => {
    TestBed.inject(ScreenState).switcherOpen.set(false);
    vi.useRealTimers();
    localStorage.clear();
  });

  it('deve mostrar o apelido no botão, com o nome acessível começando por ele', async () => {
    const { container } = await show([url(A, 'Pagamentos', 0)]);

    expect(trigger().textContent?.trim()).toBe('Pagamentos');
    expect(trigger().getAttribute('aria-label')).toBe('Pagamentos. Switch URL');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('deve mostrar "URL" e os 5 primeiros do UUID Quando não há apelido', async () => {
    await show([url(A, '', 0)]);

    expect(trigger().textContent?.trim()).toBe('URL d0620');
  });

  it('deve listar a aberta primeiro e marcada, e as outras pela última abertura', async () => {
    const { container } = await show([
      url(C, 'GitHub', 120),
      url(A, 'Pagamentos', 30),
      url(B, '', 5),
    ]);

    await userEvent.click(trigger());

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(items()).toEqual([
      'Pagamentos, d0620, open now',
      'URL c4291, c4291, opened 5 minutes ago',
      'GitHub, 5f61b, opened 2 hours ago',
    ]);
    const [aberta, outra] = screen.getAllByRole('menuitemradio');
    expect(aberta.getAttribute('aria-checked')).toBe('true');
    expect(outra.getAttribute('aria-checked')).toBe('false');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      'New URL…N',
      'Rename this URL…',
      'Forget a URL…',
    ]);
    // O rodapé e a busca ficam dentro do menu.
    expect(
      within(screen.getByRole('menu', { name: 'URLs in this browser' })).getByText(
        'Kept only in this browser.',
      ),
    ).toBeTruthy();
    // Sem busca com menos de 8 URLs.
    expect(screen.queryByRole('searchbox')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(aberta));
    await expectNoAxeViolations(container);
  });

  it('deve dizer "locked" e "deleted" no estado da URL', async () => {
    await show([url(A, '', 0), url(B, '', 5), url(C, '', 9)]);
    TestBed.inject(UrlLock).lock(B);
    TestBed.inject(UrlMissing).mark(C);

    await userEvent.click(trigger());

    expect(items()).toEqual([
      'URL d0620, d0620, open now',
      'URL c4291, c4291, locked',
      'URL 5f61b, 5f61b, deleted',
    ]);
  });

  it('deve avisar a URL escolhida, fechar e devolver o foco ao botão', async () => {
    await show([url(A, 'Pagamentos', 0), url(B, 'Retry', 5)]);
    await userEvent.click(trigger());

    await userEvent.click(screen.getByRole('menuitemradio', { name: /^Retry/ }));

    expect(chosen).toHaveBeenCalledWith(B);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('não deve avisar nada Quando a escolhida é a que já está aberta', async () => {
    await show([url(A, 'Pagamentos', 0)]);
    await userEvent.click(trigger());

    await userEvent.click(screen.getByRole('menuitemradio', { name: /^Pagamentos/ }));

    expect(chosen).not.toHaveBeenCalled();
  });

  it('deve andar com as setas, dar a volta, e fechar com Esc devolvendo o foco', async () => {
    await show([url(A, 'Pagamentos', 0), url(B, 'Retry', 5)]);
    await userEvent.click(trigger());
    const radios = screen.getAllByRole('menuitemradio');
    const actions = screen.getAllByRole('menuitem');
    await vi.waitFor(() => expect(document.activeElement).toBe(radios[0]));

    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(radios[1]);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(actions[2]);
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(radios[0]);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(actions[2]);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it.each([
    ['New URL…', 'newUrl'],
    ['Rename this URL…', 'rename'],
    ['Forget a URL…', 'forget'],
  ] as const)('deve pedir "%s" e fechar o menu', async (name, event) => {
    await show([url(A, '', 0)]);
    await userEvent.click(trigger());

    await userEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${name}`) }));

    expect(events[event]).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('deve oferecer a busca com 8 URLs ou mais, por apelido e por início do UUID', async () => {
    const muitas = Array.from({ length: 7 }, (_, n) =>
      url(`${n}0000000-1111-4111-8111-111111111111`, `Loja ${n}`, n + 1),
    );
    await show([url(A, 'Pagamentos', 0), ...muitas]);
    await userEvent.click(trigger());

    // Um campo não cabe num `menu`: com a busca, a caixa é um `dialog` (não modal) com o menu dentro.
    const caixa = screen.getByRole('dialog', { name: 'URLs in this browser' });
    expect(caixa.hasAttribute('aria-modal')).toBe(false);
    expect(within(caixa).getByRole('menu', { name: 'Choose a URL' })).toBeTruthy();
    const busca = within(caixa).getByRole('searchbox', { name: 'Find a URL' });
    await expectNoAxeViolations(document.body);
    await userEvent.type(busca, 'loja 3');
    expect(items()).toEqual(['Loja 3, 30000, opened 4 minutes ago']);

    await userEvent.clear(busca);
    await userEvent.type(busca, 'D06');
    expect(items()).toEqual(['Pagamentos, d0620, open now']);
  });

  it('deve abrir por fora (a tecla U, "Switch to another URL") com o foco no primeiro item', async () => {
    const { fixture } = await show([url(A, 'Pagamentos', 0)]);

    TestBed.inject(ScreenState).switcherOpen.set(true);
    fixture.detectChanges();

    const [aberta] = await screen.findAllByRole('menuitemradio');
    await vi.waitFor(() => expect(document.activeElement).toBe(aberta));
  });

  it('deve mostrar só a URL aberta e dizer que não guarda Quando o navegador não deixa gravar', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('negado');
    });
    await render(UrlSwitcher, {
      inputs: { current: A },
      providers: [{ provide: Viewport, useValue: { windowClass } }],
    });
    vi.restoreAllMocks();

    await userEvent.click(trigger());

    expect(items()).toEqual(['URL d0620, d0620, open now']);
    expect(screen.getByText('This browser does not keep a list of URLs.')).toBeTruthy();
  });

  it('deve abrir como folha modal com "Close" no celular, e o Tab ficar dentro dela', async () => {
    windowClass.set('compact');
    const { container } = await show([url(A, 'Pagamentos', 0)]);

    await userEvent.click(trigger());

    const folha = screen.getByRole('dialog', { name: 'URLs in this browser' });
    expect(folha.getAttribute('aria-modal')).toBe('true');
    // Um só elemento com o nome "URLs in this browser": o menu de dentro tem outro.
    expect(within(folha).getByRole('menu', { name: 'Choose a URL' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'URLs in this browser' })).toBeNull();
    const fechar = within(folha).getByRole('button', { name: 'Close' });
    const ultimo = within(folha).getByRole('menuitem', { name: /^Forget a URL/ });
    ultimo.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(fechar);
    await expectNoAxeViolations(container);

    await userEvent.click(fechar);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
