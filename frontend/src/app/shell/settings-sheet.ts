import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, ElementRef, afterNextRender, inject, output } from '@angular/core';
import { LANGUAGES, Language } from '../../locale/locale';
import { KnownUrls } from '../token/known-urls';
import { Icon } from '../ui/icon';
import { DENSITIES, Density, ShellSettings, THEMES, Theme } from './shell-settings';

/** O nome de cada idioma na própria língua: quem não lê a tela atual ainda acha o seu. */
const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', 'pt-BR': 'Português (Brasil)' };

/**
 * Settings: tema, densidade, idioma, atalhos de uma tecla e a lista de URLs do navegador. Folha lateral não modal, carregada sob
 * demanda; Esc ou "Close" fecham e o foco volta ao botão do rail.
 */
@Component({
  selector: 'app-settings-sheet',
  imports: [Icon],
  templateUrl: './settings-sheet.html',
  styleUrl: './sheet.scss',
})
export class SettingsSheet {
  protected readonly settings = inject(ShellSettings);
  /** A lista de URLs guarda endereços que são segredo: "Forget all URLs" a esvazia (B1). */
  protected readonly known = inject(KnownUrls);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly closed = output<void>();

  protected readonly noUrl = $localize`This browser keeps no URL.`;

  // Rótulos traduzidos na instância, não no módulo: o `$localize` só vale depois da tradução.
  private readonly themeLabels: Record<Theme, string> = {
    system: $localize`System`,
    light: $localize`Light`,
    dark: $localize`Dark`,
  };
  private readonly densityLabels: Record<Density, string> = {
    comfortable: $localize`Comfortable`,
    compact: $localize`Compact`,
  };

  protected readonly themes = THEMES.map((value) => ({ value, label: this.themeLabels[value] }));
  protected readonly densities = DENSITIES.map((value) => ({
    value,
    label: this.densityLabels[value],
  }));
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

  protected chooseDensity(density: Density): void {
    this.settings.density.set(density);
  }

  protected chooseLanguage(language: Language): void {
    this.settings.language.set(language);
  }

  protected toggleShortcuts(event: Event): void {
    this.settings.shortcuts.set((event.target as HTMLInputElement).checked);
  }

  protected forgetAll(): void {
    this.known.forgetAll();
    void this.announcer.announce(this.noUrl);
  }

  protected reload(): void {
    location.reload();
  }
}
