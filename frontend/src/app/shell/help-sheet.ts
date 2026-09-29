import { Component, ElementRef, afterNextRender, computed, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TokenStore } from '../token/token-store';
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
    { keys: 'J / K', action: $localize`Older / newer request` },
    { keys: '↑ ↓ · Enter', action: $localize`Move in the list without opening · open` },
    { keys: '→ ←', action: $localize`Expand or collapse an event` },
    { keys: 'R · D · E', action: $localize`Replay, compare, explain the open request` },
    { keys: 'P', action: $localize`Open or close the action panel` },
    { keys: '/', action: $localize`Search requests` },
    { keys: '?', action: $localize`This help` },
    { keys: 'Esc', action: $localize`Close this panel` },
  ];
}

/** Help: a folha de atalhos, os roteiros e o About (licença, GitHub, doação, autor). */
@Component({
  selector: 'app-help-sheet',
  imports: [Icon, RouterLink],
  templateUrl: './help-sheet.html',
  styleUrl: './sheet.scss',
})
export class HelpSheet {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly tokens = inject(TokenStore);

  readonly closed = output<void>();

  protected readonly shortcuts = shortcuts();
  protected readonly tokenId = computed(() => this.tokens.token()?.uuid ?? null);

  constructor() {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('h2')?.focus());
  }
}
