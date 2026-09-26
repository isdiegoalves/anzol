import { Component, computed, input } from '@angular/core';

/** Estado do tempo real como a tela mostra; quem conhece o SSE (o shell) traduz o dele. */
export type LiveState = 'live' | 'connecting' | 'reconnecting' | 'offline';

const TEXT: Record<LiveState, string> = {
  live: 'Live',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

const HINT: Record<LiveState, string> = {
  live: 'New requests appear here as they arrive',
  connecting: 'Opening the real-time connection',
  reconnecting: 'The real-time connection dropped; trying again',
  offline: 'Not receiving in real time; reload to try again',
};

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

  protected readonly text = computed(() => TEXT[this.state()]);
  protected readonly hint = computed(() => HINT[this.state()]);
}
