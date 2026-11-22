import { Component, computed, input, output } from '@angular/core';
import { Icon } from '../ui/icon';
import { MethodBadge } from '../ui/method-badge';
import { EventView } from './list-rows';

/**
 * A linha de evento: o corpo abre a tentativa mais nova; o chevron, fora da ordem do Tab, mostra e
 * esconde as tentativas sem abrir nenhuma. Nenhum selo de julgamento: o Anzol relata.
 */
@Component({
  selector: 'app-event-line',
  imports: [Icon, MethodBadge],
  template: `
    @let event = view();
    <button
      type="button"
      class="chevron"
      tabindex="-1"
      [attr.aria-expanded]="event.expanded"
      [attr.aria-label]="chevronLabel()"
      (click)="toggled.emit()"
    >
      <app-icon [name]="event.expanded ? 'up' : 'down'" [size]="20" />
    </button>
    <button
      type="button"
      class="select"
      [attr.data-uuid]="'event:' + event.value"
      [attr.tabindex]="stop() ? 0 : -1"
      (focus)="focused.emit()"
      (keydown)="moved.emit($event)"
      (click)="opened.emit($event)"
    >
      <span class="line">
        <app-method-badge class="tinted" [method]="event.method" />
        <!-- prettier-ignore -->
        <span class="route" [title]="event.route"><span class="head" aria-hidden="true">{{ event.head }}</span><span class="tail" aria-hidden="true">{{ event.tail }}</span><span class="app-spoken">{{ event.route }}</span></span>
        @if (!compact()) {
          <span class="value">{{ event.value }}</span>
        }
        <span class="time" [title]="event.when">{{ event.time }}</span>
      </span>
      @if (compact()) {
        <span class="line meta">
          <span class="value">{{ event.value }}</span>
          <span> · {{ event.count }}</span>
        </span>
      }
      <span class="line meta trail">
        <span class="app-spoken" i18n="the status codes of the attempts, in order"
          >answers {{ event.answers }}</span
        >
        <span class="seals" aria-hidden="true">
          @for (seal of event.trail; track $index) {
            <!-- A marca ✗ e o "×14" ficam no selo; o nome acessível da linha diz os problemas. -->
            <!-- prettier-ignore -->
            <span class="seal" [class.fault]="seal.fault" [class.last]="seal.last" [attr.data-family]="seal.fault ? null : seal.text.charAt(0)">{{ seal.text }}@if (seal.mark) {<span class="mark">✗</span>}@if (seal.count > 1) {<span> ×{{ seal.count }}</span>}</span>
          }
        </span>
        @if (!compact()) {
          <span class="count"> {{ event.count }}</span>
        }
        @for (note of event.notes; track note) {
          <span class="note"> · {{ note }}</span>
        }
      </span>
      <span class="app-spoken" i18n>Open the newest attempt</span>
    </button>
  `,
  styleUrl: './event-line.scss',
  host: {
    '[class.touch]': 'compact()',
    '[class.early]': 'view().early',
    '[style.height.px]': 'height()',
  },
})
export class EventLine {
  readonly view = input.required<EventView>();
  readonly height = input.required<number>();
  readonly compact = input(false);
  readonly stop = input(false);

  readonly opened = output<MouseEvent>();
  readonly toggled = output<void>();
  readonly moved = output<KeyboardEvent>();
  readonly focused = output<void>();

  protected readonly chevronLabel = computed(
    () => $localize`Attempts of ${this.view().value}:value:`,
  );
}
