import { Component, ElementRef, afterNextRender, inject, output } from '@angular/core';
import { Icon } from '../ui/icon';

/** Atalhos da tela (C §3.2), como a folha os mostra. */
export const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'G then I, R, C, O, N', action: 'Go to Inbox, Rules, Checks, Outbound, Insights' },
  { keys: 'C', action: 'Copy the webhook URL' },
  { keys: 'N', action: 'New URL' },
  { keys: '/', action: 'Search requests' },
  { keys: '?', action: 'This help' },
  { keys: 'Esc', action: 'Close this panel' },
];

/** Help: a folha de atalhos e o About (licença, GitHub, doação, autor). */
@Component({
  selector: 'app-help-sheet',
  imports: [Icon],
  templateUrl: './help-sheet.html',
  styleUrl: './sheet.scss',
})
export class HelpSheet {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly closed = output<void>();

  protected readonly shortcuts = SHORTCUTS;

  constructor() {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('h2')?.focus());
  }
}
