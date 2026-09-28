import { Component, ElementRef, Injector, computed, inject, input, signal } from '@angular/core';
import { KnownUrls } from '../token/known-urls';
import { MissingUrl } from '../token/url-missing';
import { LiveRegion } from '../ui/live-region';
import { ScreenState } from './screen-state';

/**
 * Página única de URL inexistente (B1, UX-16): a mesma em todo destino, no lugar da página da rota,
 * com o shell em volta. Nenhuma URL é criada sem a pessoa pedir: trocar de URL exige reconfigurar
 * quem manda. Carregada sob demanda.
 */
@Component({
  selector: 'app-url-missing-page',
  imports: [LiveRegion],
  template: `
    <main class="page" id="content" tabindex="-1" aria-labelledby="url-missing-title">
      <h1 id="url-missing-title" i18n>This URL no longer exists</h1>
      @if (missing().reason === 'malformed') {
        <p i18n>This address is not a valid URL id.</p>
      } @else {
        <p i18n>It was deleted, or it expired after 7 days without use.</p>
        <p i18n>Whoever sends to it gets 410 Gone.</p>
      }
      <div class="actions">
        <button type="button" class="primary" (click)="create()" i18n>Create a new URL</button>
        @if (others()) {
          <button type="button" class="tonal" (click)="switchUrl()">
            <span i18n>Switch to another URL</span>
          </button>
        }
        @if (kept()) {
          <button type="button" class="text" (click)="remove()">
            <span i18n>Remove from this browser</span>
          </button>
        }
      </div>
      <app-live-region class="note" [text]="note()" />
    </main>
  `,
  styleUrl: './url-missing-page.scss',
})
export class UrlMissingPage {
  private readonly known = inject(KnownUrls);
  private readonly screen = inject(ScreenState);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly missing = input.required<MissingUrl>();

  /** "Switch to another URL" só aparece com outra URL na lista do navegador. */
  protected readonly others = computed(() =>
    this.known.urls().some((url) => url.uuid !== this.missing().id),
  );
  protected readonly kept = computed(() =>
    this.known.urls().some((url) => url.uuid === this.missing().id),
  );
  protected readonly note = signal('');

  /** A pessoa pediu: cria a URL (com a resposta padrão de sempre) e a abre no lugar desta página. */
  protected async create(): Promise<void> {
    const { TokenActions } = await import('../token/token-actions');
    await this.injector.get(TokenActions).createDefaultUrl();
  }

  protected switchUrl(): void {
    this.screen.switcherOpen.set(true);
  }

  protected remove(): void {
    this.known.forget([this.missing().id]);
    this.note.set($localize`Removed from this browser.`);
    // O botão some com a URL fora da lista: o foco fica na página, não cai no body.
    this.host.querySelector<HTMLElement>('main')?.focus();
  }
}
