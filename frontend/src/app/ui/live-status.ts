import { Component, computed, input } from '@angular/core';

/** Estado do tempo real como a tela mostra; quem conhece o SSE (o shell) traduz o dele. */
export type LiveState = 'live' | 'connecting' | 'reconnecting' | 'offline';

/** Texto e dica de cada estado; função, porque o `$localize` só vale depois da tradução. */
function textOf(state: LiveState): { text: string; hint: string } {
  switch (state) {
    case 'live':
      return { text: $localize`Live`, hint: $localize`New requests appear here as they arrive` };
    case 'connecting':
      return { text: $localize`Connecting…`, hint: $localize`Opening the real-time connection` };
    case 'reconnecting':
      return {
        text: $localize`Reconnecting…`,
        hint: $localize`The real-time connection dropped; trying again`,
      };
    case 'offline':
      return {
        text: $localize`Offline`,
        hint: $localize`Not receiving in real time; reload to try again`,
      };
  }
}

/**
 * Chip do tempo real no cabeçalho da URL: `role="status"` (a troca é anunciada sem roubar o foco,
 * WCAG 4.1.3), com o ponto e o texto; a cor nunca sozinha.
 */
@Component({
  selector: 'app-live-status',
  template: '<span class="dot" aria-hidden="true"></span>{{ text() }}',
  styleUrl: './live-status.scss',
  host: {
    role: 'status',
    '[class]': 'state()',
    '[attr.title]': 'hint()',
  },
})
export class LiveStatus {
  readonly state = input.required<LiveState>();

  private readonly texts = computed(() => textOf(this.state()));
  protected readonly text = computed(() => this.texts().text);
  protected readonly hint = computed(() => this.texts().hint);
}
