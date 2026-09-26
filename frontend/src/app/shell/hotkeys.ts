import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';

/** O que o atalho faz; quem registra (o shell) decide cada ação. */
export interface HotkeyActions {
  /** G seguido da tecla do destino (I, R, C, O, N). */
  goTo(key: string): void;
  /** C: copiar a URL. */
  copyUrl(): void;
  /** N: New URL. */
  newUrl(): void;
  /** ?: folha de atalhos. */
  help(): void;
  /** /: foco na busca, se a página tiver. */
  search(): void;
  /** Esc: fecha a folha aberta. */
  close(): void;
  /** Liga/desliga os atalhos de uma tecla (Settings). O Esc vale sempre. */
  enabled(): boolean;
}

/** Tempo para a segunda tecla depois do G. */
export const SEQUENCE_MS = 1500;

/**
 * Atalhos globais da tela (C §3.2). Não valem com o foco num campo, nem com Ctrl, Alt ou Meta
 * (atalhos do navegador); os de uma tecla se desligam em Settings (WCAG 2.1.4).
 */
@Injectable({ providedIn: 'root' })
export class Hotkeys {
  private readonly document = inject(DOCUMENT);
  private goPressedAt = 0;

  register(actions: HotkeyActions, destroyRef: DestroyRef): void {
    const listener = (event: KeyboardEvent) => this.handle(event, actions);
    this.document.addEventListener('keydown', listener);
    destroyRef.onDestroy(() => this.document.removeEventListener('keydown', listener));
  }

  private handle(event: KeyboardEvent, actions: HotkeyActions): void {
    if (event.key === 'Escape') {
      actions.close();
      return;
    }
    if (!actions.enabled() || event.ctrlKey || event.altKey || event.metaKey || typing(event)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (this.goPressedAt && event.timeStamp - this.goPressedAt <= SEQUENCE_MS) {
      this.goPressedAt = 0;
      event.preventDefault();
      actions.goTo(key);
      return;
    }
    this.goPressedAt = 0;
    const single: Record<string, () => void> = {
      g: () => (this.goPressedAt = event.timeStamp || 1),
      c: () => actions.copyUrl(),
      n: () => actions.newUrl(),
      '?': () => actions.help(),
      '/': () => actions.search(),
    };
    const action = single[event.key === '?' || event.key === '/' ? event.key : key];
    if (action) {
      event.preventDefault();
      action();
    }
  }
}

/** Foco num campo de texto, lista de opções ou área editável: a tecla é do usuário. */
function typing(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return false;
  }
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.getAttribute('role') === 'textbox'
  );
}
