import { Component, ElementRef, afterNextRender, inject, output } from '@angular/core';
import { Icon } from '../ui/icon';

/** Atalhos da tela (C §3.2), como a folha os mostra; as teclas não se traduzem. */
function shortcuts(): readonly { keys: string; action: string }[] {
  return [
    {
      keys: $localize`G then I, R, C, O, N`,
      action: $localize`Go to Inbox, Rules, Checks, Outbound, Insights`,
    },
    { keys: 'C', action: $localize`Copy the webhook URL` },
    { keys: 'N', action: $localize`New URL` },
    { keys: 'U', action: $localize`Switch URL` },
    { keys: 'F', action: $localize`Open or close the filters of the Inbox` },
    { keys: '/', action: $localize`Search requests` },
    { keys: '?', action: $localize`This help` },
    { keys: 'Esc', action: $localize`Close this panel` },
  ];
}

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

  protected readonly shortcuts = shortcuts();

  constructor() {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('h2')?.focus());
  }
}
