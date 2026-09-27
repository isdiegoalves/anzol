import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { TOKEN_ID } from '../../testing/fixtures';
import { placeOf } from './destinations';
import { HotkeyActions, Hotkeys, SEQUENCE_MS } from './hotkeys';
import { DENSITY_KEY, SHORTCUTS_KEY, ShellSettings, THEME_KEY } from './shell-settings';
import { windowClassOf } from './viewport';

const REQUEST = '0691864a-71ef-4de5-953b-518660fe6287';

describe('Dado a rota aberta (placeOf)', () => {
  it.each([
    ['a URL (Inbox)', [TOKEN_ID], TOKEN_ID, 'Inbox'],
    ['uma mensagem aberta (Inbox)', [TOKEN_ID, REQUEST, '2'], TOKEN_ID, 'Inbox'],
    ['as regras', [TOKEN_ID, 'rules'], TOKEN_ID, 'Rules'],
    ['uma regra', [TOKEN_ID, 'rules', 'new'], TOKEN_ID, 'Rules'],
    ['Checks', [TOKEN_ID, 'checks'], TOKEN_ID, 'Checks'],
    ['Outbound', [TOKEN_ID, 'outbound'], TOKEN_ID, 'Outbound'],
    ['Insights', [TOKEN_ID, 'insights'], TOKEN_ID, 'Insights'],
    ['o Compare (não é destino)', [TOKEN_ID, 'compare', REQUEST, REQUEST], TOKEN_ID, null],
    ['o link só-leitura', ['share', 'abc'], null, null],
    ['a raiz', [], null, null],
  ])('deve achar o token e o destino Quando a rota é %s', (_caso, segments, tokenId, label) => {
    const place = placeOf(segments);

    expect([place.tokenId, place.destination?.label ?? null]).toEqual([tokenId, label]);
  });
});

describe('Dado a largura da janela (windowClassOf)', () => {
  it.each([
    [320, 'compact'],
    [599, 'compact'],
    [600, 'medium'],
    [839, 'medium'],
    [840, 'expanded'],
    [1200, 'large'],
    [1599, 'large'],
    [1600, 'extra-large'],
  ])('deve dar a classe M3 Quando a largura é %i px', (width, expected) => {
    const matches = (query: string) => width >= Number(/min-width: (\d+)px/.exec(query)?.[1]);

    expect(windowClassOf(matches)).toBe(expected);
  });
});

describe('Dado os atalhos globais (Hotkeys)', () => {
  let actions: {
    goTo: Mock<(key: string) => void>;
    copyUrl: Mock<() => void>;
    newUrl: Mock<() => void>;
    help: Mock<() => void>;
    search: Mock<() => void>;
    close: Mock<() => boolean>;
    enabled: Mock<() => boolean>;
  };
  let now = 1000;

  const press = (
    key: string,
    target: EventTarget = document.body,
    init: KeyboardEventInit = {},
  ) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'timeStamp', { value: (now += 100) });
    target.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    actions = {
      goTo: vi.fn(),
      copyUrl: vi.fn(),
      newUrl: vi.fn(),
      help: vi.fn(),
      search: vi.fn(),
      close: vi.fn(() => false),
      enabled: vi.fn(() => true),
    };
    const destroy: (() => void)[] = [];
    const hotkeyActions: HotkeyActions = actions;
    TestBed.inject(Hotkeys).register(hotkeyActions, {
      onDestroy: (fn: () => void) => destroy.push(fn),
    } as unknown as DestroyRef);
    onTestFinished(() => destroy.forEach((fn) => fn()));
  });

  it('deve ir ao destino Quando G e a letra são pressionados em seguida', () => {
    press('g');
    press('r');

    expect(actions.goTo).toHaveBeenCalledWith('r');
    expect(actions.copyUrl).not.toHaveBeenCalled();
  });

  it('deve tratar a letra sozinha Quando passou o tempo depois do G', () => {
    press('g');
    now += SEQUENCE_MS;
    press('c');

    expect(actions.goTo).not.toHaveBeenCalled();
    expect(actions.copyUrl).toHaveBeenCalled();
  });

  it.each([
    ['c', 'copyUrl'],
    ['n', 'newUrl'],
    ['?', 'help'],
    ['/', 'search'],
  ] as const)('deve chamar a ação Quando "%s" é pressionado', (key, action) => {
    press(key);

    expect(actions[action]).toHaveBeenCalled();
  });

  it('deve ignorar as teclas Quando o foco está num campo', () => {
    const input = document.body.appendChild(document.createElement('input'));
    onTestFinished(() => input.remove());

    press('g', input);
    press('c', input);
    press('n', input);

    expect(actions.goTo).not.toHaveBeenCalled();
    expect(actions.copyUrl).not.toHaveBeenCalled();
    expect(actions.newUrl).not.toHaveBeenCalled();
  });

  it('deve ignorar a tecla Quando vem com Ctrl ou Meta (atalho do navegador)', () => {
    press('c', document.body, { metaKey: true });
    press('n', document.body, { ctrlKey: true });

    expect(actions.copyUrl).not.toHaveBeenCalled();
    expect(actions.newUrl).not.toHaveBeenCalled();
  });

  it('deve ignorar os de uma tecla, mas fechar com Esc, Quando os atalhos estão desligados', () => {
    actions.enabled.mockReturnValue(false);

    press('g');
    press('r');
    press('Escape');

    expect(actions.goTo).not.toHaveBeenCalled();
    expect(actions.close).toHaveBeenCalled();
  });

  it('deve marcar o Esc como tratado só Quando ele fechou uma folha (o editor de regra não fecha junto)', () => {
    expect(press('Escape').defaultPrevented).toBe(false);

    actions.close.mockReturnValue(true);

    expect(press('Escape').defaultPrevented).toBe(true);
  });
});

describe('Dado as preferências do shell (ShellSettings)', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('compact');
  });

  it('deve abrir confortável e aplicar a compacta gravada (S17)', () => {
    expect(TestBed.inject(ShellSettings).density()).toBe('comfortable');
    TestBed.resetTestingModule();
    localStorage.setItem(DENSITY_KEY, '"compact"');

    TestBed.inject(ShellSettings);
    TestBed.tick();

    expect(document.documentElement.classList.contains('compact')).toBe(true);
  });

  it('deve seguir o sistema, com os atalhos ligados, Quando nada foi escolhido', () => {
    const settings = TestBed.inject(ShellSettings);
    TestBed.tick();

    expect(settings.theme()).toBe('system');
    expect(settings.shortcuts()).toBe(true);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('deve gravar o tema em JSON e fixá-lo no <html> Quando é escolhido', () => {
    const settings = TestBed.inject(ShellSettings);

    settings.theme.set('dark');
    TestBed.tick();

    expect(localStorage.getItem(THEME_KEY)).toBe('"dark"');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('deve abrir com o que estava gravado e ignorar valor estranho', () => {
    localStorage.setItem(THEME_KEY, '"light"');
    localStorage.setItem(SHORTCUTS_KEY, 'false');

    const settings = TestBed.inject(ShellSettings);
    TestBed.tick();

    expect(settings.theme()).toBe('light');
    expect(settings.shortcuts()).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('deve cair no sistema Quando o tema gravado não existe', () => {
    localStorage.setItem(THEME_KEY, '"sepia"');

    expect(TestBed.inject(ShellSettings).theme()).toBe('system');
  });
});
