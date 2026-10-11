import { TestBed } from '@angular/core/testing';
import { ACTION_PANEL_KEY, ActionPanelStore, PANEL_MIN_PX } from './action-panel-store';

describe('Dado o estado do painel de ação', () => {
  const store = () => TestBed.inject(ActionPanelStore);
  const saved = () => JSON.parse(localStorage.getItem(ACTION_PANEL_KEY) ?? 'null') as unknown;

  afterEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('deve abrir na aba pedida e guardar aberto, a aba e a altura no navegador', () => {
    store().show('compare');

    expect([store().open(), store().tab()]).toEqual([true, 'compare']);
    expect(saved()).toEqual({ open: true, tab: 'compare', height: null });
  });

  it('deve voltar como estava Quando a tela é aberta de novo', () => {
    localStorage.setItem(
      ACTION_PANEL_KEY,
      JSON.stringify({ open: true, tab: 'explain', height: 320 }),
    );

    expect([store().open(), store().tab(), store().height()]).toEqual([true, 'explain', 320]);
  });

  it.each([
    ['uma aba que não existe', JSON.stringify({ open: true, tab: 'history', height: 'x' })],
    ['um JSON quebrado', '{'],
  ])('deve começar fechado, no Replay, Quando o guardado é %s', (_caso, value) => {
    localStorage.setItem(ACTION_PANEL_KEY, value);

    expect([store().tab(), store().height()]).toEqual(['replay', null]);
  });

  it('deve limpar o resultado ao abrir e mantê-lo ao trocar de aba', () => {
    store().result.set('Replay result: 200 OK in 3 ms');

    store().show('replay');
    expect(store().result()).toBe('');
    store().result.set('Replay result: 200 OK in 3 ms');
    store().show('compare');

    expect(store().result()).toBe('Replay result: 200 OK in 3 ms');
  });

  it('deve esquecer o `title` do resultado Quando o resultado muda', () => {
    store().result.set('Replay result: answered 201 in 3 ms');
    store().resultTitle.set('201 Created');
    expect(store().resultTitle()).toBe('201 Created');

    store().result.set('Compared #aaaaa with #bbbbb. 1 change explains the outcome.');

    expect(store().resultTitle()).toBe('');
  });

  it('deve abrir e fechar pela tecla P, na última aba', () => {
    store().show('rule');
    store().close();

    store().toggle(null);
    expect([store().open(), store().tab(), store().focusInside()]).toEqual([true, 'rule', 1]);
    store().toggle(null);
    expect(store().open()).toBe(false);
  });

  it('deve devolver o foco ao botão que abriu Quando fecha', () => {
    const opener = document.body.appendChild(document.createElement('button'));
    const inside = document.body.appendChild(document.createElement('input'));

    store().show('replay', opener);
    inside.focus();
    store().close();

    expect(document.activeElement).toBe(opener);
  });

  it('deve tirar o foco do campo que some Quando fecha sem botão que abriu (teclado)', () => {
    const inside = document.body.appendChild(document.createElement('input'));

    store().show('replay', null, true);
    inside.focus();
    store().close();

    expect(document.activeElement).toBe(document.body);
    expect(store().expanded()).toBe(false);
  });

  it('deve fechar sem tirar o foco de onde a pessoa está Quando outra URL abre', () => {
    const opener = document.body.appendChild(document.createElement('button'));
    const switcher = document.body.appendChild(document.createElement('input'));
    store().show('replay', opener);
    switcher.focus();

    store().dismiss();

    expect(store().open()).toBe(false);
    expect(saved()).toEqual({ open: false, tab: 'replay', height: null });
    expect(document.activeElement).toBe(switcher);
  });

  it('não deve ficar abaixo da altura mínima', () => {
    store().resize(100);
    expect(store().height()).toBe(PANEL_MIN_PX);

    store().resize(333.6);
    expect(store().height()).toBe(334);
  });
});
