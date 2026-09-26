import { Component, ElementRef, afterNextRender, inject, output } from '@angular/core';
import { LANGUAGES, Language } from '../../locale/locale';
import { Icon } from '../ui/icon';
import { ShellSettings, THEMES, Theme } from './shell-settings';

const THEME_LABELS: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', 'pt-BR': 'Português (Brasil)' };

/**
 * Settings (mínimo da E3): tema, idioma e atalhos de uma tecla. Folha lateral não modal, carregada
 * sob demanda; Esc ou "Close" fecham e o foco volta ao botão do rail.
 */
@Component({
  selector: 'app-settings-sheet',
  imports: [Icon],
  templateUrl: './settings-sheet.html',
  styleUrl: './sheet.scss',
})
export class SettingsSheet {
  protected readonly settings = inject(ShellSettings);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly closed = output<void>();

  protected readonly themes = THEMES.map((value) => ({ value, label: THEME_LABELS[value] }));
  protected readonly languages = LANGUAGES.map((value) => ({
    value,
    label: LANGUAGE_LABELS[value],
  }));
  /** O idioma com que a tela abriu; trocar pede recarregar. */
  protected readonly startLanguage = this.settings.language();

  constructor() {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('h2')?.focus());
  }

  protected chooseTheme(theme: Theme): void {
    this.settings.theme.set(theme);
  }

  protected chooseLanguage(language: Language): void {
    this.settings.language.set(language);
  }

  protected toggleShortcuts(event: Event): void {
    this.settings.shortcuts.set((event.target as HTMLInputElement).checked);
  }

  protected reload(): void {
    location.reload();
  }
}
