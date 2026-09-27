import { Component, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { WebhookRequest } from '../requests/webhook-request';
import { Preferences } from './preferences';
import { Redirector } from './redirect';

/**
 * Bloco provisório no cabeçalho da lista da Inbox (item 14, E4): o redirect pelo navegador, até ter
 * lugar em Outbound › Forward (legacy) (E7), que o remove. O CORS já está em Checks › Response.
 * "Format JSON/XML" virou o Pretty do corpo, "Auto Navigate" o Follow new da lista, e
 * "Hide Details" saiu (as abas do detalhe fazem o papel).
 */
@Component({
  selector: 'app-options-bar',
  imports: [MatSlideToggle, MatButton],
  templateUrl: './options-bar.html',
  styleUrl: './options-bar.scss',
})
export class OptionsBar {
  protected readonly preferences = inject(Preferences);
  private readonly redirector = inject(Redirector);
  private readonly dialog = inject(MatDialog);

  readonly request = input<WebhookRequest>();

  protected async openRedirectSettings(): Promise<void> {
    const { RedirectDialog } = await import('./redirect-dialog');
    this.dialog.open(RedirectDialog, { width: '600px' });
  }

  protected redirectNow(): void {
    const request = this.request();
    if (request) {
      void this.redirector.redirect(request);
    }
  }
}
