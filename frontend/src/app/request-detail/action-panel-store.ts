import { Injectable, signal } from '@angular/core';

export const ACTION_TABS = ['replay', 'compare', 'rule', 'explain'] as const;
export type ActionTab = (typeof ACTION_TABS)[number];

export const ACTION_PANEL_KEY = 'anzol.actionPanel';
export const PANEL_MIN_PX = 240;

interface Saved {
  open: boolean;
  tab: ActionTab;
  height: number | null;
}

function readSaved(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(ACTION_PANEL_KEY) ?? 'null') as Partial<Saved>;
    return {
      open: saved?.open === true,
      tab: ACTION_TABS.find((tab) => tab === saved?.tab) ?? 'replay',
      height: typeof saved?.height === 'number' ? saved.height : null,
    };
  } catch {
    return { open: false, tab: 'replay', height: null };
  }
}

/**
 * O painel de ação da requisição aberta. Aberto, a aba e a altura ficam no navegador; o destino
 * digitado no Replay fica ao trocar de requisição.
 */
@Injectable({ providedIn: 'root' })
export class ActionPanelStore {
  private readonly saved = readSaved();

  readonly open = signal(this.saved.open);
  readonly tab = signal<ActionTab>(this.saved.tab);
  /** `null` é o padrão, 40 % da coluna. */
  readonly height = signal<number | null>(this.saved.height);
  readonly expanded = signal(false);
  readonly result = signal('');
  readonly target = signal<string | null>(null);
  /** Só a requisição cuja explicação foi pedida gasta chamada ao modelo; as outras esperam o botão. */
  readonly explainFor = signal<string | null>(null);
  /** No celular, a folha de tela cheia só abre se pedida nesta visita, não pelo que ficou guardado. */
  readonly askedHere = signal(false);
  readonly focusInside = signal(0);
  private opener: HTMLElement | null = null;

  show(tab: ActionTab, opener: HTMLElement | null = null, byKey = false): void {
    if (!this.open()) {
      this.result.set('');
    }
    this.tab.set(tab);
    this.open.set(true);
    this.askedHere.set(true);
    this.opener = opener ?? this.opener;
    if (byKey) {
      this.focusInside.update((n) => n + 1);
    }
    this.save();
  }

  toggle(opener: HTMLElement | null, byKey = true): void {
    if (this.open()) {
      this.close();
    } else {
      this.show(this.tab(), opener, byKey);
    }
  }

  /** Sem botão que abriu, o foco sai já do painel: a próxima tecla cairia num campo que está sumindo. */
  close(): void {
    this.open.set(false);
    this.expanded.set(false);
    this.save();
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) {
      opener.focus();
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  resize(height: number): void {
    this.height.set(Math.max(PANEL_MIN_PX, Math.round(height)));
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(
        ACTION_PANEL_KEY,
        JSON.stringify({ open: this.open(), tab: this.tab(), height: this.height() }),
      );
    } catch {
      // Sem localStorage, o painel vale até fechar a aba.
    }
  }
}
