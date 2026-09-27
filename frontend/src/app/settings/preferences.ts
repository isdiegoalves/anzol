import { Injectable, WritableSignal, signal } from '@angular/core';
import { Token } from '../token/token';

/**
 * Preferências da tela, gravadas no localStorage com as mesmas chaves e o mesmo formato (JSON)
 * do app atual (`settings` e `unread` em `resources/assets/js/app.js`): quem já usa não perde
 * as configurações ao trocar de front.
 */
@Injectable({ providedIn: 'root' })
export class Preferences {
  private readonly stored = new Map<string, WritableSignal<unknown>>();

  readonly redirectEnable = this.persisted('redirectEnable', false);
  readonly redirectUrl = this.persisted<string | null>('redirectUrl', null);
  readonly redirectContentType = this.persisted<string | null>('redirectContentType', 'text/plain');
  readonly redirectHeaders = this.persisted<string | null>('redirectHeaders', null);
  readonly redirectMethod = this.persisted<string | null>('redirectMethod', '');
  readonly token = this.persisted<Token | null>('token', null);
  /**
   * "Pretty": ligado no primeiro acesso (INBOX-22, protótipo C); a escolha gravada pelo app atual ou
   * por esta tela continua valendo (trava 9).
   */
  readonly formatJsonEnable = this.persisted('formatJsonEnable', true);
  readonly autoNavEnable = this.persisted('autoNavEnable', false);
  readonly hideTutorial = this.persisted('hideTutorial', false);
  readonly unread = this.persisted<readonly string[]>('unread', []);

  /**
   * Signal que grava na hora (não num `effect`, que roda depois: recarregar logo após mudar
   * perderia a mudança) e, como o `saveSettings` do app atual, grava todas as chaves juntas.
   */
  private persisted<T>(key: string, fallback: T): WritableSignal<T> {
    const state = signal(readSetting(key, fallback));
    this.stored.set(key, state);
    const setState = state.set;
    const set = (value: T) => {
      setState(value);
      this.saveSettings();
    };
    return Object.assign(state, { set, update: (change: (value: T) => T) => set(change(state())) });
  }

  private saveSettings(): void {
    for (const [key, state] of this.stored) {
      localStorage.setItem(key, JSON.stringify(state()));
    }
  }
}

/** Lê como o `getSetting` do app atual: ausente ou "undefined" cai no padrão; o resto é JSON. */
export function readSetting<T>(key: string, fallback: T): T {
  const value = localStorage.getItem(key);
  if (!value || value === 'undefined') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
