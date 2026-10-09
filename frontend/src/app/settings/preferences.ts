import { Injectable, WritableSignal, signal } from '@angular/core';
import { Token } from '../token/token';

/**
 * Preferências da tela, gravadas no localStorage com as mesmas chaves e o mesmo formato (JSON)
 * do app atual (`settings` em `resources/assets/js/app.js`): quem já usa não perde as
 * configurações ao trocar de front. `unread` passou a ser por URL e lê também a lista de antes.
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
  /** Não lidas por URL: `{ [tokenId]: uuid[] }`. */
  readonly unread = this.persisted<UnreadByUrl>(
    'unread',
    {},
    unreadByUrl(readSetting<unknown>('unread', {}), this.token()?.uuid),
  );

  /**
   * Signal que grava na hora (não num `effect`, que roda depois: recarregar logo após mudar
   * perderia a mudança) e, como o `saveSettings` do app atual, grava todas as chaves juntas.
   */
  private persisted<T>(
    key: string,
    fallback: T,
    initial: T = readSetting(key, fallback),
  ): WritableSignal<T> {
    const state = signal(initial);
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

export type UnreadByUrl = Readonly<Record<string, readonly string[]>>;

/**
 * O formato de antes era uma lista só, sem URL, gravada pela tela de uma URL por vez: ela fica com
 * a URL salva, ou se perde sem uma.
 */
function unreadByUrl(stored: unknown, savedTokenId: string | undefined): UnreadByUrl {
  if (Array.isArray(stored)) {
    const ids = stored.filter((id): id is string => typeof id === 'string');
    return savedTokenId && ids.length > 0 ? { [savedTokenId]: ids } : {};
  }
  return stored !== null && typeof stored === 'object' ? (stored as UnreadByUrl) : {};
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
