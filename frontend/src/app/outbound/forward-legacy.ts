import { Component, Injector, inject, input, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { WebhookRequest } from '../requests/webhook-request';
import { Preferences } from '../settings/preferences';
import { Redirector } from '../settings/redirect';

/**
 * "Forward from this browser (legacy)", recolhido (B): o redirect de hoje, feito por XHR do
 * navegador para o destino do usuário (fora da API de gestão; o item 12 não o afeta), com os nomes
 * de hoje: "Auto redirect" (a Inbox reenvia cada mensagem nova), "Settings..." e "Redirect Now"
 * (reenvia a mensagem escolhida no Replay). As chaves `redirect*` do localStorage continuam.
 */
@Component({
  selector: 'app-forward-legacy',
  imports: [MatButton, MatSlideToggle],
  template: `
    <h2 class="title" id="forward-title">
      <button
        type="button"
        class="disclosure"
        aria-controls="forward-body"
        [attr.aria-expanded]="open()"
        (click)="open.set(!open())"
      >
        <span class="chevron" [class.open]="open()" aria-hidden="true">›</span>
        <ng-container i18n>Forward from this browser (legacy)</ng-container>
      </button>
    </h2>
    <div id="forward-body" class="body">
      @if (open()) {
        <p class="hint" i18n>
          Sends requests to another URL with an XHR from this browser, as the old Redirect did. The
          target must allow the call (CORS). Prefer Replay: the server sends it, with no CORS.
        </p>
        <div class="row">
          <mat-slide-toggle
            title="Redirect incoming requests to another URL via XHR"
            [disabled]="!preferences.redirectUrl()"
            [checked]="preferences.redirectEnable()"
            (change)="preferences.redirectEnable.set($event.checked)"
            i18n
            >Auto redirect</mat-slide-toggle
          >
          <button mat-button type="button" (click)="openSettings()" i18n>Settings...</button>
          <button
            mat-button
            type="button"
            [disabled]="!preferences.redirectUrl() || !request()"
            (click)="redirectNow()"
            i18n
          >
            Redirect Now
          </button>
        </div>
        <p class="hint">
          @if (preferences.redirectUrl(); as url) {
            To {{ url }}. Auto redirect forwards each new request while the Inbox is open.
          } @else {
            <ng-container i18n>Set the target in Settings... first.</ng-container>
          }
        </p>
      }
    </div>
  `,
  styleUrl: './forward-legacy.scss',
  host: { role: 'region', 'aria-labelledby': 'forward-title' },
})
export class ForwardLegacy {
  protected readonly preferences = inject(Preferences);
  private readonly redirector = inject(Redirector);
  private readonly injector = inject(Injector);

  /** A mensagem que "Redirect Now" reenvia (a escolhida no Replay). */
  readonly request = input<WebhookRequest | null>(null);
  protected readonly open = signal(false);

  protected async openSettings(): Promise<void> {
    const { RedirectActions } = await import('../settings/redirect-actions');
    this.injector.get(RedirectActions).openSettings();
  }

  protected redirectNow(): void {
    const request = this.request();
    if (request) {
      void this.redirector.redirect(request);
    }
  }
}
