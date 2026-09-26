import { DOCUMENT } from '@angular/common';
import { Injectable, WritableSignal, effect, inject, signal } from '@angular/core';
import { Language, LANGUAGE_KEY, languageOf } from '../../locale/locale';
import { readSetting } from '../settings/preferences';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Chaves novas do `localStorage` (S14): as de hoje ficam no `Preferences`, com o formato delas. */
export const THEME_KEY = 'theme';
export const SHORTCUTS_KEY = 'shortcuts';

/**
 * Preferências do shell: tema, idioma e atalhos de uma tecla. Cada uma na sua chave, em JSON como
 * as outras. O tema vale na hora (`data-theme` no `<html>`, que fixa o `color-scheme`); o idioma,
 * ao recarregar (a tradução entra antes do bootstrap).
 */
@Injectable({ providedIn: 'root' })
export class ShellSettings {
  private readonly root = inject(DOCUMENT).documentElement;

  readonly theme = this.stored<Theme>(THEME_KEY, (value) =>
    THEMES.includes(value as Theme) ? (value as Theme) : 'system',
  );
  readonly language = this.stored<Language>(LANGUAGE_KEY, (value) =>
    languageOf(value, navigator.languages),
  );
  /** Atalhos de uma tecla (WCAG 2.1.4: dá para desligar). */
  readonly shortcuts = this.stored<boolean>(SHORTCUTS_KEY, (value) => value !== false);

  constructor() {
    effect(() => {
      const theme = this.theme();
      if (theme === 'system') {
        this.root.removeAttribute('data-theme');
      } else {
        this.root.setAttribute('data-theme', theme);
      }
    });
  }

  private stored<T>(key: string, parse: (value: unknown) => T): WritableSignal<T> {
    const state = signal(parse(readSetting<unknown>(key, null)));
    const setState = state.set;
    const set = (value: T) => {
      setState(value);
      localStorage.setItem(key, JSON.stringify(value));
    };
    return Object.assign(state, { set, update: (change: (value: T) => T) => set(change(state())) });
  }
}
